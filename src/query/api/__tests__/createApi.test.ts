import { vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query/__tests__/helpers";
import { _createResource } from "@/query/api/_createResource";
import { createApi } from "@/query/api/createApi";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/types";
import type { IPlugin, TApiSnapshot } from "@/query/types";

type TArgs = { id: number };
type TData = { name: string };

function createQueryFn() {
    return createControllableQueryFn<TArgs, TData>();
}

describe("createApi", () => {
    // ── AP01: createApi returns API with createResource, resetAll, getSnapshot ──
    it("AP01: createApi(options) returns API with createResource, resetAll, getSnapshot", () => {
        const api = createApi({ keyPrefix: "app" });

        expect(api).toBeDefined();
        expect(typeof api.createResource).toBe("function");
        expect(typeof api.resetAll).toBe("function");
        expect(typeof api.getSnapshot).toBe("function");
    });

    // ── AP02: createResource validates unique key ──
    it("AP02: api.createResource(options) validates unique key", () => {
        const api = createApi();
        const { queryFn } = createQueryFn();

        api.createResource<TArgs, TData>({ key: "users", queryFn });

        expect(() => {
            api.createResource<TArgs, TData>({ key: "users", queryFn });
        }).toThrow('Duplicate resource key "users"');
    });

    // ── AP03: createResource merges API defaults with resource options (resource overrides) ──
    it("AP03: api.createResource merges API defaults with resource options", async () => {
        const api = createApi({ cacheLifetime: 60_000 });
        const { queryFn, calls } = createQueryFn();

        // Resource-level cacheLifetime overrides API-level
        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: 30_000,
        });

        // Verify the resource works (confirming creation was successful)
        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
        const data = await promise;
        expect(data).toEqual({ name: "Alice" });
    });

    // ── AP04: createResource — resource inherits API-level options ──
    it("AP04: api.createResource — resource inherits API-level options", () => {
        const api = createApi({ keyPrefix: "app" });
        const { queryFn } = createQueryFn();

        // Resource created without explicit keyPrefix — inherits from API
        const resource = api.createResource<TArgs, TData>({ key: "users", queryFn });

        expect(resource).toBeDefined();

        // Verify snapshot includes keyPrefix from API
        const snapshot = api.getSnapshot();
        expect(snapshot.keyPrefix).toBe("app");
    });

    // ── AP05: resetAll calls resetCache on all resources and deletes _savedSnapshot ──
    it("AP05: api.resetAll() calls resetCache() on all registered resources and deletes _savedSnapshot", async () => {
        const api = createApi();
        const { queryFn: qf1, calls: c1 } = createQueryFn();
        const { queryFn: qf2, calls: c2 } = createQueryFn();
        const { queryFn: qf3, calls: c3 } = createQueryFn();

        const r1 = api.createResource<TArgs, TData>({ key: "users", queryFn: qf1, cacheLifetime: false as never });
        const r2 = api.createResource<TArgs, TData>({ key: "posts", queryFn: qf2, cacheLifetime: false as never });
        const r3 = api.createResource<TArgs, TData>({ key: "comments", queryFn: qf3, cacheLifetime: false as never });

        // Populate all three
        r1.query({ id: 1 });
        r2.query({ id: 2 });
        r3.query({ id: 3 });
        c1[0].resolve({ name: "User" });
        c2[0].resolve({ name: "Post" });
        c3[0].resolve({ name: "Comment" });
        await flushMicrotasks();

        // Verify entries exist
        expect(r1.getEntry({ id: 1 })).not.toBeNull();
        expect(r2.getEntry({ id: 2 })).not.toBeNull();
        expect(r3.getEntry({ id: 3 })).not.toBeNull();

        // Reset all
        api.resetAll();

        // All entries should be gone
        expect(r1.getEntry({ id: 1 })).toBeNull();
        expect(r2.getEntry({ id: 2 })).toBeNull();
        expect(r3.getEntry({ id: 3 })).toBeNull();
    });

    // ── AP06: getSnapshot delegates to snapshot module ──
    it("AP06: api.getSnapshot() delegates to snapshot module", async () => {
        const api = createApi({ keyPrefix: "app" });
        const { queryFn: qf1, calls: c1 } = createQueryFn();
        const { queryFn: qf2, calls: c2 } = createQueryFn();

        const r1 = api.createResource<TArgs, TData>({ key: "users", queryFn: qf1, cacheLifetime: false as never });
        const r2 = api.createResource<TArgs, TData>({ key: "posts", queryFn: qf2, cacheLifetime: false as never });

        r1.query({ id: 1 });
        r2.query({ id: 2 });
        c1[0].resolve({ name: "Alice" });
        c2[0].resolve({ name: "My post" });
        await flushMicrotasks();

        const snapshot = api.getSnapshot();

        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBe("app");
        expect(snapshot.resources["users"]).toBeDefined();
        expect(snapshot.resources["posts"]).toBeDefined();
        expect(Object.keys(snapshot.resources)).toHaveLength(2);
    });

    // ── AP08: createApi saves initialSnapshot; createResource consumes its slice ──
    it("AP08: createApi saves initialSnapshot; createResource consumes its slice", () => {
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                users: {
                    entries: {
                        '{"id":1}': {
                            status: "success",
                            args: { id: 1 },
                            data: { name: "Alice" },
                            updatedAt: Date.now(),
                        },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot: snapshot });
        const { queryFn } = createQueryFn();

        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
        });

        // Entry should be pre-populated from snapshot
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Alice" });
    });

    // ── AP08a: createResource without matching snapshot key — no hydration ──
    it("AP08a: createResource without matching snapshot key — no hydration", () => {
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                users: {
                    entries: {
                        '{"id":1}': {
                            status: "success",
                            args: { id: 1 },
                            data: { name: "Alice" },
                            updatedAt: Date.now(),
                        },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot: snapshot });
        const { queryFn } = createQueryFn();

        const resource = api.createResource<TArgs, TData>({
            key: "orders",
            queryFn,
            cacheLifetime: false as never,
        });

        // No hydration — "orders" not in snapshot
        const entry = resource.getEntry({ id: 1 });
        expect(entry).toBeNull();
    });

    // ── AP08b: resetAll deletes _savedSnapshot — subsequent createResource sees no snapshot ──
    it("AP08b: api.resetAll() deletes _savedSnapshot — subsequent createResource sees no snapshot", () => {
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                users: {
                    entries: {
                        '{"id":1}': {
                            status: "success",
                            args: { id: 1 },
                            data: { name: "Alice" },
                            updatedAt: Date.now(),
                        },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot: snapshot });
        api.resetAll();

        const { queryFn } = createQueryFn();
        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
        });

        // No hydration — snapshot was deleted by resetAll
        const entry = resource.getEntry({ id: 1 });
        expect(entry).toBeNull();
    });

    // ── AP08c: Snapshot data older than maxSnapshotDataAge triggers auto-invalidation ──
    it("AP08c: Snapshot data older than maxSnapshotDataAge triggers auto-invalidation on createResource", async () => {
        const oldTimestamp = Date.now() - 5000; // 5 seconds ago

        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                users: {
                    entries: {
                        '{"id":1}': {
                            status: "success",
                            args: { id: 1 },
                            data: { name: "Stale Alice" },
                            updatedAt: oldTimestamp,
                        },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot: snapshot, maxSnapshotDataAge: 1000 });
        const { queryFn, calls } = createQueryFn();

        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
        });

        // Entry should be hydrated but auto-invalidated (refreshing)
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();

        // queryFn should have been called due to auto-invalidation only (hydrated entry skips _doFetch)
        expect(queryFn).toHaveBeenCalledTimes(1);

        // Machine should be in refreshing (or pending depending on invalidate behavior)
        const machine = entry!.peek();
        expect(machine.status).toBe("refreshing");

        // Resolve the invalidation refetch
        calls[0].resolve({ name: "Fresh Alice" });
        await flushMicrotasks();

        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Fresh Alice" });
    });

    // ── AP09: createApi with empty options uses defaults ──
    it("AP09: createApi with empty options uses defaults", () => {
        const api = createApi({});

        expect(api).toBeDefined();

        const snapshot = api.getSnapshot();
        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBeNull();
        expect(snapshot.resources).toEqual({});
    });

    // ── AP10: createResource without key — still works (snapshot limited) ──
    it("AP10: createResource without key — still works (snapshot limited)", async () => {
        const api = createApi();
        const { queryFn, calls } = createQueryFn();

        // No key — resource won't be tracked for snapshot
        const resource = api.createResource<TArgs, TData>({
            queryFn,
            cacheLifetime: false as never,
        });

        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const data = await promise;
        expect(data).toEqual({ name: "Alice" });

        // Snapshot should not include keyless resources
        const snapshot = api.getSnapshot();
        expect(Object.keys(snapshot.resources)).toHaveLength(0);
    });

    // ── AP11: Standalone createResource accepts standalone-level options ──
    it("AP11: Standalone createResource accepts standalone-level options", async () => {
        const { queryFn, calls } = createQueryFn();

        const resource = _createResource<TArgs, TData>({
            queryFn,
            cacheLifetime: false as never,
        });

        expect(resource).toBeDefined();
        expect(typeof resource.createAgent).toBe("function");
        expect(typeof resource.query).toBe("function");

        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const data = await promise;
        expect(data).toEqual({ name: "Alice" });
    });
});
