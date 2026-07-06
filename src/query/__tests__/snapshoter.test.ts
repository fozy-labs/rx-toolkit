import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/constants";

describe("Snapshoter.getSnapshot", () => {
    it("returns empty resources map when API has no entries", () => {
        const api = createApi();
        const snapshot = api.getSnapshot();

        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBeNull();
        expect(snapshot.resources).toEqual({});
        expect(typeof snapshot.timestamp).toBe("number");
    });

    it("includes resource with success entries", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "users",
            queryFn: async () => ({ name: "Alice" }),
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();

        expect(snapshot.resources).toHaveProperty("users");
        const entries = snapshot.resources["users"].entries;
        const keys = Object.keys(entries);
        expect(keys.length).toBe(1);
        expect(entries[keys[0]].status).toBe("success");
        expect(entries[keys[0]].data).toEqual({ name: "Alice" });
        expect(typeof entries[keys[0]].updatedAt).toBe("number");
    });

    it("excludes resource entries that are pending (no data)", async () => {
        let resolveQuery!: (val: string) => void;
        const api = createApi();
        const resource = api.createResource({
            key: "slow",
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        // Entry is still pending — snapshot should exclude it
        const snapshot = api.getSnapshot();
        expect(snapshot.resources).toEqual({});

        // Resolve and verify it appears
        resolveQuery("done");
        await flushMicrotasks();

        const snapshot2 = api.getSnapshot();
        expect(snapshot2.resources).toHaveProperty("slow");

        const entries = snapshot2.resources["slow"].entries;
        expect(Object.values(entries)[0].data).toBe("done");
    });

    it("excludes resource entries in error state", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "failing",
            queryFn: async () => {
                throw new Error("fail");
            },
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();
        expect(snapshot.resources).toEqual({});
    });

    it("strips keyPrefix from snapshot resource keys", async () => {
        const api = createApi({ keyPrefix: "app" });
        const resource = api.createResource({
            key: "items",
            queryFn: async () => [1, 2, 3],
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();

        // Key in snapshot should be "items", not "app/items"
        expect(snapshot.resources).toHaveProperty("items");
        expect(snapshot.resources).not.toHaveProperty("app/items");
        expect(snapshot.keyPrefix).toBe("app");
    });

    it("stores timestamp as a recent Date.now() value", async () => {
        const before = Date.now();
        const api = createApi();
        api.createResource({ key: "t", queryFn: async () => 1 }).trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();
        const after = Date.now();

        expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
        expect(snapshot.timestamp).toBeLessThanOrEqual(after);
    });

    it("includes multiple resources in snapshot", async () => {
        const api = createApi();
        const r1 = api.createResource({ key: "a", queryFn: async () => "alpha" });
        const r2 = api.createResource({ key: "b", queryFn: async () => "beta" });

        r1.trigger(undefined as void);
        r2.trigger(undefined as void);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();

        expect(Object.keys(snapshot.resources)).toHaveLength(2);
        expect(snapshot.resources).toHaveProperty("a");
        expect(snapshot.resources).toHaveProperty("b");
    });

    it("includes only success entries when resource has mixed states", async () => {
        let callCount = 0;
        let resolveSecond!: (val: string) => void;

        const api = createApi();
        const resource = api.createResource<string, string>({
            key: "mixed",
            queryFn: async (arg) => {
                callCount++;
                if (arg === "ok") return "good";
                // Second call stays pending
                return new Promise<string>((r) => {
                    resolveSecond = r;
                });
            },
        });

        resource.trigger("ok");
        await flushMicrotasks();

        resource.trigger("pending-arg");
        await flushMicrotasks();

        const snapshot = api.getSnapshot();

        expect(snapshot.resources).toHaveProperty("mixed");
        const entries = snapshot.resources["mixed"].entries;

        // Only the "ok" entry should be present (success), "pending-arg" is still pending
        const values = Object.values(entries);
        expect(values).toHaveLength(1);
        expect(values[0].data).toBe("good");
        expect(values[0].status).toBe("success");

        // Cleanup
        resolveSecond("resolved");
        await flushMicrotasks();
    });
});

describe("Snapshoter.getSnapshot with optimistic patches", () => {
    it("snapshots confirmed base data, not unconfirmed optimistic data, while a patch is pending", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "profile",
            queryFn: async () => ({ name: "Alice", age: 30 }),
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void)!;
        const handle = entry.createPatch((draft) => {
            draft.name = "Bob";
        });
        expect(handle).not.toBeNull();

        // Live state reflects the optimistic patch...
        expect((entry.peek().state.data as { name: string }).name).toBe("Bob");

        // ...but the snapshot must persist the confirmed base data, since the
        // patch is unconfirmed and could still roll back.
        const snapshot = api.getSnapshot();
        const value = Object.values(snapshot.resources["profile"].entries)[0];
        expect(value.status).toBe("success");
        expect(value.data).toEqual({ name: "Alice", age: 30 });
    });

    it("snapshots patched data once the patch is committed", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "profile",
            queryFn: async () => ({ name: "Alice", age: 30 }),
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void)!;
        const handle = entry.createPatch((draft) => {
            draft.name = "Bob";
        });
        handle!.commit();

        const snapshot = api.getSnapshot();
        const value = Object.values(snapshot.resources["profile"].entries)[0];
        expect(value.data).toEqual({ name: "Bob", age: 30 });
    });

    it("snapshots base data after the patch is aborted", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "profile",
            queryFn: async () => ({ name: "Alice", age: 30 }),
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void)!;
        const handle = entry.createPatch((draft) => {
            draft.name = "Bob";
        });
        handle!.abort();

        const snapshot = api.getSnapshot();
        const value = Object.values(snapshot.resources["profile"].entries)[0];
        expect(value.data).toEqual({ name: "Alice", age: 30 });
    });

    it("folds a committed patch but excludes a following pending patch", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "profile",
            queryFn: async () => ({ name: "Alice", age: 30 }),
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void)!;
        const handleA = entry.createPatch((draft) => {
            draft.name = "Bob";
        });
        const handleB = entry.createPatch((draft) => {
            draft.age = 99;
        });

        // Commit A, leave B pending.
        handleA!.commit();
        void handleB;

        const snapshot = api.getSnapshot();
        const value = Object.values(snapshot.resources["profile"].entries)[0];
        // A's committed change is folded into the base; B's pending change is not.
        expect(value.data).toEqual({ name: "Bob", age: 30 });
    });

    it("snapshots confirmed base data for a refresh-error entry with a pending patch", async () => {
        let call = 0;
        const api = createApi();
        const resource = api.createResource({
            key: "sensor",
            queryFn: async () => {
                call++;
                if (call === 1) return { reading: 1 };
                throw new Error("refresh failed");
            },
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void)!;
        entry.refresh();
        await flushMicrotasks();

        expect(entry.peek().state.status).toBe("refresh-error");

        const handle = entry.createPatch((draft) => {
            draft.reading = 999;
        });
        expect(handle).not.toBeNull();

        const snapshot = api.getSnapshot();
        const value = Object.values(snapshot.resources["sensor"].entries)[0];
        expect(value.status).toBe("refresh-error");
        expect(value.data).toEqual({ reading: 1 });
    });
});
