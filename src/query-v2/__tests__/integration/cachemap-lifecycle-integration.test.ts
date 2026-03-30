import { vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { _createResourceV2 } from "@/query-v2/api/_createResourceV2";
import { createApi } from "@/query-v2/api/createApi";
import { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import { getSnapshot } from "@/query-v2/core/Snapshot";
import * as stableStringifyModule from "@/query-v2/lib/stableStringify";

type TArgs = { id: number };
type TData = { name: string };

describe("Integration: CacheMap + Lifecycle + Devtools key", () => {
    // ── IT01: Compare-strategy → monotonic devtools key → zero serialization ──
    it("IT01: compare-strategy resource uses monotonic counter argsKey, zero stableStringify calls", async () => {
        const stringifySpy = vi.spyOn(stableStringifyModule, "stableStringify");

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = _createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            compareArg: (a, b) => a.id === b.id,
            cacheLifetime: false as never,
        });

        const args0 = { id: 1 };
        const args1 = { id: 2 };

        // First entry — argsKey should be "0"
        const entry0 = resource.getEntry(args0, true);
        expect(entry0.argsKey).toBe("0");

        // Second entry — argsKey should be "1"
        const entry1 = resource.getEntry(args1, true);
        expect(entry1.argsKey).toBe("1");

        // stableStringify should never be called for compare strategy
        expect(stringifySpy).not.toHaveBeenCalled();

        // Resolve to clean up
        calls[0].resolve({ name: "Alice" });
        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();

        stringifySpy.mockRestore();
    });

    // ── IT02: Serialize-strategy → serialized argsKey → single serialization per entry ──
    it("IT02: serialize-strategy resource uses serialized argsKey, serializeArgs called exactly once per new entry", async () => {
        const serializeSpy = vi.fn((args: TArgs) => JSON.stringify(args));

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = _createResourceV2<TArgs, TData>({
            key: "items",
            queryFn,
            serializeArgs: serializeSpy,
            cacheLifetime: false as never,
        });

        // First entry
        const entry0 = resource.getEntry({ id: 1 }, true);
        expect(entry0.argsKey).toBe('{"id":1}');
        expect(serializeSpy).toHaveBeenCalledTimes(1);

        // Second entry with different args
        const entry1 = resource.getEntry({ id: 2 }, true);
        expect(entry1.argsKey).toBe('{"id":2}');
        expect(serializeSpy).toHaveBeenCalledTimes(2); // one per new entry

        // Cache hit — serializeArgs called once for lookup, factory NOT called
        serializeSpy.mockClear();
        const entry0Again = resource.getEntry({ id: 1 }, true);
        expect(entry0Again).toBe(entry0);
        expect(serializeSpy).toHaveBeenCalledTimes(1); // lookup only

        // Resolve to clean up
        calls[0].resolve({ name: "Item1" });
        calls[1].resolve({ name: "Item2" });
        await flushMicrotasks();
    });

    // ── IT08: Custom devtoolsKey function flows to entry argsKey ──
    it("IT08: custom devtoolsKey function → entry argsKey uses custom value", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = _createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            compareArg: (a, b) => a.id === b.id,
            devtoolsKey: (args) => String(args.id),
            cacheLifetime: false as never,
        });

        const entry = resource.getEntry({ id: 42 }, true);
        expect(entry.argsKey).toBe("42");

        // Resolve to clean up
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
    });

    // ── IT03: Lifecycle hooks fire on entry creation and query fulfillment ──
    it("IT03: onCacheEntryAdded + onQueryStarted both fire with correct tools", async () => {
        const callLog: string[] = [];
        let cacheDataLoadedPromise: Promise<TData> | null = null;
        let cacheEntryRemovedPromise: Promise<void> | null = null;
        let queryFulfilledPromise: Promise<{ data: TData }> | null = null;

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
            onCacheEntryAdded: (args, tools) => {
                callLog.push(`cacheEntryAdded:${args.id}`);
                cacheDataLoadedPromise = tools.$cacheDataLoaded;
                cacheEntryRemovedPromise = tools.$cacheEntryRemoved;
                tools.$cacheDataLoaded.then(() => {
                    callLog.push(`cacheDataLoaded:${args.id}`);
                });
            },
            onQueryStarted: (args, tools) => {
                callLog.push(`queryStarted:${args.id}`);
                queryFulfilledPromise = tools.$queryFulfilled;
                tools.$queryFulfilled.then(() => {
                    callLog.push(`queryFulfilled:${args.id}`);
                });
            },
        });

        // Create entry via query — triggers both hooks
        resource.query({ id: 1 });

        // onCacheEntryAdded fires synchronously during entry creation
        expect(callLog).toContain("cacheEntryAdded:1");
        // onQueryStarted fires during _doFetch
        expect(callLog).toContain("queryStarted:1");

        expect(cacheDataLoadedPromise).not.toBeNull();
        expect(cacheEntryRemovedPromise).not.toBeNull();
        expect(queryFulfilledPromise).not.toBeNull();

        // Resolve the query
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // $queryFulfilled should have resolved
        expect(callLog).toContain("queryFulfilled:1");
        // $cacheDataLoaded should have resolved
        expect(callLog).toContain("cacheDataLoaded:1");
    });

    // ── IT04: resetCache → all lifecycle resolvers settled, cache empty ──
    it("IT04: resetCache settles all lifecycle resolvers and empties cache", async () => {
        const entryRemovedResults: Array<{ id: number; resolved: boolean }> = [];
        const queryFulfilledResults: Array<{ id: number; rejected: boolean }> = [];
        const cacheDataLoadedResults: Array<{ id: number; rejected: boolean }> = [];

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
            onCacheEntryAdded: (args, tools) => {
                tools.$cacheEntryRemoved.then(() => {
                    entryRemovedResults.push({ id: args.id, resolved: true });
                });
                tools.$cacheDataLoaded.catch(() => {
                    cacheDataLoadedResults.push({ id: args.id, rejected: true });
                });
            },
            onQueryStarted: (args, tools) => {
                tools.$queryFulfilled.catch(() => {
                    queryFulfilledResults.push({ id: args.id, rejected: true });
                });
            },
        });

        // Create 3 entries with pending queries
        const args1 = { id: 1 };
        const args2 = { id: 2 };
        const args3 = { id: 3 };

        resource.query(args1);
        resource.query(args2);
        resource.query(args3);

        expect(calls).toHaveLength(3);

        // Resolve one entry to verify mixed states
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // resetCache() — should settle everything
        (resource as unknown as ResourceV2<TArgs, TData>).resetCache();
        await flushMicrotasks();

        // All $cacheEntryRemoved should be resolved
        expect(entryRemovedResults).toHaveLength(3);
        expect(entryRemovedResults.every((r) => r.resolved)).toBe(true);

        // Pending $queryFulfilled should be rejected (entries 2 and 3 had pending queries)
        expect(queryFulfilledResults.length).toBeGreaterThanOrEqual(2);
        expect(queryFulfilledResults.every((r) => r.rejected)).toBe(true);

        // $cacheDataLoaded for entries 2 and 3 (not yet resolved) should be rejected
        expect(cacheDataLoadedResults.length).toBeGreaterThanOrEqual(2);
        expect(cacheDataLoadedResults.every((r) => r.rejected)).toBe(true);

        // Cache should be empty — getEntry returns null
        expect(resource.getEntry(args1)).toBeNull();
        expect(resource.getEntry(args2)).toBeNull();
        expect(resource.getEntry(args3)).toBeNull();
    });

    // ── IT05: Snapshot uses cacheValues() + entry.argsKey (serialize strategy) ──
    it("IT05: serialize-strategy snapshot entries keyed by serialized args via cacheValues + argsKey", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResourceV2<TArgs, TData>({
            key: "items",
            queryFn,
            cacheLifetime: false as never,
        });

        // Create 2 entries and resolve them
        resource.query({ id: 10 });
        resource.query({ id: 20 });

        calls[0].resolve({ name: "Item10" });
        calls[1].resolve({ name: "Item20" });
        await flushMicrotasks();

        // Verify cacheValues + argsKey
        const resourceInternal = resource as unknown as ResourceV2<TArgs, TData>;
        const entries = [...resourceInternal.cacheValues()];
        expect(entries).toHaveLength(2);

        const argsKeys = entries.map((e) => e.argsKey);
        expect(argsKeys).toContain(JSON.stringify({ id: 10 }));
        expect(argsKeys).toContain(JSON.stringify({ id: 20 }));

        // Snapshot should capture entries keyed by serialized args
        const snapshot = api.getSnapshot();
        expect(snapshot.resources["items"]).toBeDefined();

        const snapshotEntries = snapshot.resources["items"].entries;
        expect(snapshotEntries[JSON.stringify({ id: 10 })]).toBeDefined();
        expect(snapshotEntries[JSON.stringify({ id: 20 })]).toBeDefined();
        expect(snapshotEntries[JSON.stringify({ id: 10 })].data).toEqual({ name: "Item10" });
        expect(snapshotEntries[JSON.stringify({ id: 20 })].data).toEqual({ name: "Item20" });
    });

    // ── IT06: createApi path exercises cacheValues() without error ──
    it("IT06: createApi stale check iterates cacheValues without error", async () => {
        const staleTimestamp = Date.now() - 10_000;

        // Build a snapshot with a stale entry
        const snapshot = {
            version: 1 as const,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                users: {
                    entries: {
                        [JSON.stringify({ id: 1 })]: {
                            status: "success" as const,
                            args: { id: 1 },
                            data: { name: "Stale" },
                            updatedAt: staleTimestamp,
                        },
                    },
                },
            },
        };

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();

        // createApi with maxSnapshotDataAge — exercises cacheValues() in stale check path
        const api = createApi({
            initialSnapshot: snapshot,
            maxSnapshotDataAge: 5_000,
        });

        const resource = api.createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
        });

        // Entry should exist and be invalidated (refreshing)
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("refreshing");

        // cacheValues iteration succeeded — no error thrown
        // Resolve to clean up
        calls[0].resolve({ name: "Fresh" });
        await flushMicrotasks();

        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Fresh" });
    });

    // ── IT07: entry.argsKey is accessible and matches devtools key ──
    it("IT07: entry.argsKey is accessible on IResourceV2CacheEntry and matches devtools key", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = _createResourceV2<TArgs, TData>({
            key: "test",
            queryFn,
            cacheLifetime: false as never,
        });

        // Serialize strategy — argsKey should be the serialized args string
        const entry = resource.getEntry({ id: 5 }, true);
        const argsKey: string = entry.argsKey; // type-level check: string
        expect(typeof argsKey).toBe("string");
        expect(argsKey).toBe(stableStringifyModule.stableStringify({ id: 5 }));

        // Resolve to clean up
        calls[0].resolve({ name: "Test" });
        await flushMicrotasks();
    });
});
