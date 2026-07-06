import { describe, expect, it } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/constants";
import { stableStringify } from "@/query/lib/stableStringify";
import type { TApiSnapshot } from "@/query/types";

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

describe("Snapshoter hydration — refresh-error entries", () => {
    it("round-trips a refresh-error entry: persisted last-known-good data hydrates as refreshing", async () => {
        let call = 0;
        const source = createApi();
        const resource = source.createResource({
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

        // The entry holds last-known-good data but its latest refresh failed.
        expect(entry.peek().state.status).toBe("refresh-error");

        const snapshot = source.getSnapshot();
        expect(Object.values(snapshot.resources["sensor"].entries)[0].status).toBe("refresh-error");

        // Hydrate a fresh API from that snapshot.
        const hydrated = createApi({ initialSnapshot: snapshot });
        const hydratedResource = hydrated.createResource({
            key: "sensor",
            queryFn: async () => ({ reading: 999 }),
        });

        const entries = [...hydratedResource.getEntries()];
        expect(entries).toHaveLength(1);

        // The refresh-error's last-known-good data is revived...
        const state = entries[0].machine$.peek().state;
        expect(state.data).toEqual({ reading: 1 });
        // ...as a stale entry (refreshing), so it shows data immediately and refetches.
        expect(state.status).toBe("refreshing");
    });

    it("forces a refresh-error entry stale regardless of snapshotValidTime", () => {
        const freshTimestamp = Date.now() - 1_000; // 1s ago — well within any valid window
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: freshTimestamp,
            resources: {
                items: {
                    entries: {
                        [stableStringify(undefined)]: {
                            status: "refresh-error",
                            args: undefined,
                            data: "last-known-good",
                            updatedAt: freshTimestamp,
                        },
                    },
                },
            },
        };

        const api = createApi({
            initialSnapshot,
            snapshotValidTime: 3_600_000, // 1h — a plain success entry this fresh would hydrate as "success"
        });

        const resource = api.createResource({
            key: "items",
            queryFn: async () => "fresh-data",
        });

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(1);
        // Despite the fresh timestamp, the failed-refresh entry must refetch.
        expect(entries[0].machine$.peek().state.status).toBe("refreshing");
        expect(entries[0].machine$.peek().state.data).toBe("last-known-good");
    });
});
