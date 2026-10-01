import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/constants";
import type { QueryCacheEntry } from "@/query/core/cache/QueryCacheEntry";
import { stableStringify } from "@/query/lib/stableStringify";
import type { TApiSnapshot, TResourceSnapshotEntry } from "@/query/types";

describe("Snapshotter.getSnapshot", () => {
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

        resource.getEntry(undefined as void, true);
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

        resource.getEntry(undefined as void, true);
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

        resource.getEntry(undefined as void, true);
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

        resource.getEntry(undefined as void, true);
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
        api.createResource({ key: "t", queryFn: async () => 1 }).getEntry(undefined as void, true);
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

        r1.getEntry(undefined as void, true);
        r2.getEntry(undefined as void, true);
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

        resource.getEntry("ok", true);
        await flushMicrotasks();

        resource.getEntry("pending-arg", true);
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

describe("Snapshotter.getSnapshot with optimistic patches", () => {
    it("snapshots confirmed base data, not unconfirmed optimistic data, while a patch is pending", async () => {
        const api = createApi();
        const resource = api.createResource({
            key: "profile",
            queryFn: async () => ({ name: "Alice", age: 30 }),
        });

        resource.getEntry(undefined as void, true);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void)!;
        const handle = entry.createPatch((draft) => {
            draft.name = "Bob";
        });
        expect(handle).not.toBeNull();

        // Live state reflects the optimistic patch...
        expect((entry.peek().data as { name: string }).name).toBe("Bob");

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

        resource.getEntry(undefined as void, true);
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

        resource.getEntry(undefined as void, true);
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

        resource.getEntry(undefined as void, true);
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

    it("snapshots confirmed base data for an invalidate-error entry with a pending patch", async () => {
        let call = 0;
        const api = createApi();
        const resource = api.createResource({
            key: "sensor",
            queryFn: async () => {
                call++;
                if (call === 1) return { reading: 1 };
                throw new Error("invalidate failed");
            },
        });

        resource.getEntry(undefined as void, true);
        await flushMicrotasks();

        // Only an active entry re-runs at once: hold it for the failing run.
        const entry = resource.getEntry(undefined as void)!;
        const release = entry.hold();
        entry.invalidate();
        await flushMicrotasks();
        release();

        expect(entry.peek().status).toBe("invalidate-error");

        const handle = entry.createPatch((draft) => {
            draft.reading = 999;
        });
        expect(handle).not.toBeNull();

        const snapshot = api.getSnapshot();
        const value = Object.values(snapshot.resources["sensor"].entries)[0];
        expect(value.status).toBe("invalidate-error");
        expect(value.data).toEqual({ reading: 1 });
    });

    it("writes isStale: false for a settled entry and isStale: true for one marked for revalidation", async () => {
        const api = createApi();
        const resource = api.createResource<number, string>({
            key: "items",
            queryFn: async (id) => `item-${id}`,
        });

        resource.getEntry(1, true);
        resource.getEntry(2, true);
        await flushMicrotasks();

        // Entry 2 is melting: invalidate() only marks it, its data stays.
        resource.invalidate(2);
        expect(resource.getEntry(2)!.isInvalidated).toBe(true);

        const entries = api.getSnapshot().resources["items"].entries;
        expect(entries[stableStringify(1)]).toMatchObject({ status: "success", data: "item-1", isStale: false });
        expect(entries[stableStringify(2)]).toMatchObject({ status: "success", data: "item-2", isStale: true });
    });

    it("snapshots an entry left `invalidating` with nothing in flight as a stale success with its last good data", async () => {
        const api = createApi();
        let calls = 0;
        const resource = api.createResource<number, string>({
            key: "items",
            // The first run loads; every later run hangs until aborted.
            queryFn: (id) => (++calls === 1 ? Promise.resolve(`item-${id}`) : new Promise<string>(() => {})),
        });

        await resource.ensure(1);
        const entry = resource.getEntry(1)! as QueryCacheEntry<number, string>;

        // Held: invalidate() re-queries at once.
        const release = entry.hold();
        resource.invalidate(1);
        expect(entry.peek().status).toBe("invalidating");
        expect(entry._isInFlight).toBe(true);
        release();

        // Melting: the default `cancel` aborts that run and only marks the
        // entry, which stays `invalidating` until its next hold.
        resource.invalidate(1);
        expect(entry._isInFlight).toBe(false);
        expect(entry.peek().status).toBe("invalidating");
        expect(entry.isInvalidated).toBe(true);

        const entries = api.getSnapshot().resources["items"]?.entries;
        expect(entries?.[stableStringify(1)]).toEqual({
            status: "success",
            args: 1,
            data: "item-1",
            updatedAt: entry.peek().updatedAt,
            isStale: true,
        });
    });

    it("snapshots the confirmed base of an idle `invalidating` entry with a pending patch, and hydrates it marked", async () => {
        const api = createApi();
        let calls = 0;
        const resource = api.createResource<number, { v: number }>({
            key: "items",
            queryFn: () => (++calls === 1 ? Promise.resolve({ v: 1 }) : new Promise<{ v: number }>(() => {})),
        });

        await resource.ensure(1);
        const entry = resource.getEntry(1)!;
        const release = entry.hold();
        resource.invalidate(1);
        release();
        resource.invalidate(1);
        expect(entry.createPatch((draft) => void (draft.v = 99))).not.toBeNull();
        expect(entry.peek().data).toEqual({ v: 99 });

        const snapshot = api.getSnapshot();
        expect(snapshot.resources["items"]?.entries[stableStringify(1)]).toMatchObject({
            status: "success",
            data: { v: 1 },
            isStale: true,
        });

        const hydratedApi = createApi({ initialSnapshot: snapshot, snapshotValidTime: 3_600_000 });
        const hydrated = hydratedApi.createResource<number, { v: number }>({
            key: "items",
            queryFn: async () => ({ v: 2 }),
        });
        const hydratedEntry = hydrated.getEntry(1)!;
        expect(hydratedEntry.peek()).toMatchObject({ status: "success", data: { v: 1 } });
        expect(hydratedEntry.isInvalidated).toBe(true);
    });

    it("skips an entry whose patches hit a consistency violation until a server answer lands", async () => {
        type Items = { items: { id: number; name: string }[] };
        const api = createApi();
        let calls = 0;
        const resource = api.createResource<void, Items>({
            key: "items",
            queryFn: async () => ({ items: [{ id: 1, name: calls++ === 0 ? "first" : "fresh" }] }),
        });
        await resource.ensure();
        const entry = resource.getEntry()!;

        const pushed = entry.createPatch((draft) => void draft.items.push({ id: 2, name: "added" }))!;
        const renamed = entry.createPatch((draft) => void (draft.items[1]!.name = "modified"))!;
        // The rename cannot replay without the pushed item: the data shown is
        // no server answer any more, so there is no confirmed data to persist.
        pushed.abort();
        expect(entry.peek().data!.items).toHaveLength(2);
        expect(api.getSnapshot().resources["items"]).toBeUndefined();

        renamed.abort();
        expect(api.getSnapshot().resources["items"]).toBeUndefined();

        // The first hold brings the re-query; its answer is persisted again.
        entry.hold();
        await flushMicrotasks();
        expect(api.getSnapshot().resources["items"]?.entries[stableStringify(undefined)]).toMatchObject({
            status: "success",
            data: { items: [{ id: 1, name: "fresh" }] },
        });
    });

    it("still skips an entry that is `invalidating` with its run in flight", async () => {
        const api = createApi();
        let calls = 0;
        const resource = api.createResource<number, string>({
            key: "items",
            queryFn: (id) => (++calls === 1 ? Promise.resolve(`item-${id}`) : new Promise<string>(() => {})),
        });

        await resource.ensure(1);
        // The core entry, for its in-flight state.
        const entry = resource.getEntry(1)! as QueryCacheEntry<number, string>;
        const release = entry.hold();
        resource.invalidate(1);
        expect(entry._isInFlight).toBe(true);

        expect(api.getSnapshot().resources["items"]).toBeUndefined();
        release();
    });

    it("a persisted isStale: true hydrates marked and is snapshotted as stale again", () => {
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                items: {
                    entries: {
                        [stableStringify(1)]: {
                            status: "success",
                            args: 1,
                            data: "item-1",
                            updatedAt: Date.now(),
                            isStale: true,
                        },
                    },
                },
            },
        };
        const api = createApi({ initialSnapshot, snapshotValidTime: 3_600_000 });
        const resource = api.createResource<number, string>({ key: "items", queryFn: async (id) => `fresh-${id}` });

        // Fresh by `updatedAt`, yet the writing side no longer vouched for it.
        expect(resource.getEntry(1)!.isInvalidated).toBe(true);

        const entries = api.getSnapshot().resources["items"].entries;
        expect(entries[stableStringify(1)]).toMatchObject({ status: "success", data: "item-1", isStale: true });
    });
});

describe("Snapshotter hydration — invalidate-error entries", () => {
    it("round-trips an invalidate-error entry: persisted last-known-good data hydrates marked for revalidation", async () => {
        let call = 0;
        const source = createApi();
        const resource = source.createResource({
            key: "sensor",
            queryFn: async () => {
                call++;
                if (call === 1) return { reading: 1 };
                throw new Error("invalidate failed");
            },
        });

        resource.getEntry(undefined as void, true);
        await flushMicrotasks();

        // Only an active entry re-runs at once: hold it for the failing run.
        const entry = resource.getEntry(undefined as void)!;
        const release = entry.hold();
        entry.invalidate();
        await flushMicrotasks();
        release();

        // The entry holds last-known-good data but its latest invalidate failed.
        expect(entry.peek().status).toBe("invalidate-error");

        const snapshot = source.getSnapshot();
        expect(Object.values(snapshot.resources["sensor"].entries)[0].status).toBe("invalidate-error");

        // Hydrate a fresh API from that snapshot.
        const hydratedQueryFn = vi.fn(async () => ({ reading: 999 }));
        const hydrated = createApi({ initialSnapshot: snapshot });
        const hydratedResource = hydrated.createResource({
            key: "sensor",
            queryFn: hydratedQueryFn,
        });

        const entries = [...hydratedResource.getEntries()];
        expect(entries).toHaveLength(1);

        // The invalidate-error's last-known-good data is revived as settled
        // data marked for revalidation: shown at once, re-queried on the first hold.
        const state = entries[0].state$.peek();
        expect(state.data).toEqual({ reading: 1 });
        expect(state.status).toBe("success");
        expect(entries[0].isInvalidated).toBe(true);
        expect(hydratedQueryFn).not.toHaveBeenCalled();

        entries[0].hold();
        expect(hydratedQueryFn).toHaveBeenCalledTimes(1);
        expect(entries[0].peek().status).toBe("invalidating");
    });

    it("forces an invalidate-error entry stale regardless of snapshotValidTime", () => {
        const freshTimestamp = Date.now() - 1_000; // 1s ago — well within any valid window
        const initialSnapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: freshTimestamp,
            resources: {
                items: {
                    entries: {
                        [stableStringify(undefined)]: {
                            status: "invalidate-error",
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
        // Despite the fresh timestamp, the failed-invalidate entry is marked to refetch.
        expect(entries[0].isInvalidated).toBe(true);
        expect(entries[0].state$.peek().status).toBe("success");
        expect(entries[0].state$.peek().data).toBe("last-known-good");
    });
});

describe("Snapshotter hydration — snapshot version migration", () => {
    // Fresh enough that a plain "success" entry hydrates as "success" under the
    // snapshotValidTime used below.
    const UPDATED_AT = Date.now() - 1_000;

    function makeSnapshot(version: number, entries: Record<string, TResourceSnapshotEntry>): TApiSnapshot {
        return {
            version,
            keyPrefix: null,
            timestamp: UPDATED_AT,
            resources: { items: { entries } },
        };
    }

    function hydrate(initialSnapshot: TApiSnapshot) {
        const api = createApi({ initialSnapshot, snapshotValidTime: 3_600_000 });
        const resource = api.createResource<string, string>({
            key: "items",
            queryFn: async () => "fresh-data",
        });

        return [...resource.getEntries()].map((entry) => ({
            key: entry.keyedArgs.key,
            state: entry.state$.peek(),
            isInvalidated: entry.isInvalidated,
        }));
    }

    it("reads a v1 `refresh-error` entry as `invalidate-error` and hydrates it as stale", () => {
        const hydrated = hydrate(
            makeSnapshot(1, {
                [stableStringify("a")]: {
                    status: "refresh-error",
                    args: "a",
                    data: "last-known-good",
                    updatedAt: UPDATED_AT,
                },
            }),
        );

        expect(hydrated).toHaveLength(1);
        expect(hydrated[0].key).toBe(stableStringify("a"));
        expect(hydrated[0].state.data).toBe("last-known-good");
        // invalidate-error hydrates as a stale success: data shows now, refetch on the first hold.
        expect(hydrated[0].state.status).toBe("success");
        expect(hydrated[0].isInvalidated).toBe(true);
    });

    it("reads a v1 `refreshing` entry as `invalidating`, which does not hydrate, and keeps its `success` sibling", () => {
        const hydrated = hydrate(
            makeSnapshot(1, {
                [stableStringify("a")]: {
                    status: "refreshing",
                    args: "a",
                    data: "in-flight",
                    updatedAt: UPDATED_AT,
                },
                [stableStringify("b")]: {
                    status: "success",
                    args: "b",
                    data: "b-data",
                    updatedAt: UPDATED_AT,
                },
            }),
        );

        expect(hydrated).toHaveLength(1);
        expect(hydrated[0].key).toBe(stableStringify("b"));
        expect(hydrated[0].state.data).toBe("b-data");
        expect(hydrated[0].state.status).toBe("success");
    });

    it("hydrates a v2 `invalidate-error` entry as stale and skips a v2 `invalidating` entry", () => {
        const hydrated = hydrate(
            makeSnapshot(CURRENT_SNAPSHOT_VERSION, {
                [stableStringify("a")]: {
                    status: "invalidate-error",
                    args: "a",
                    data: "last-known-good",
                    updatedAt: UPDATED_AT,
                },
                [stableStringify("b")]: {
                    status: "invalidating",
                    args: "b",
                    data: "in-flight",
                    updatedAt: UPDATED_AT,
                },
            }),
        );

        expect(hydrated).toHaveLength(1);
        expect(hydrated[0].key).toBe(stableStringify("a"));
        expect(hydrated[0].state.data).toBe("last-known-good");
        expect(hydrated[0].state.status).toBe("success");
        expect(hydrated[0].isInvalidated).toBe(true);
    });

    it("does not apply the legacy status map to a current-version snapshot", () => {
        const hydrated = hydrate(
            makeSnapshot(CURRENT_SNAPSHOT_VERSION, {
                // A literal v1 spelling inside a v2 snapshot is an unknown status,
                // not an invalidate-error: it must be skipped, not translated.
                [stableStringify("a")]: {
                    status: "refresh-error",
                    args: "a",
                    data: "last-known-good",
                    updatedAt: UPDATED_AT,
                },
                [stableStringify("b")]: {
                    status: "success",
                    args: "b",
                    data: "b-data",
                    updatedAt: UPDATED_AT,
                },
            }),
        );

        expect(hydrated).toHaveLength(1);
        expect(hydrated[0].key).toBe(stableStringify("b"));
        expect(hydrated[0].state.status).toBe("success");
    });

    it("getSnapshot writes version 2 and the current status strings", async () => {
        let sensorCall = 0;
        const api = createApi();
        const resource = api.createResource<string, string>({
            key: "sensor",
            queryFn: async (arg) => {
                if (arg === "stable") return "stable-data";
                sensorCall++;
                if (sensorCall === 1) return "last-known-good";
                throw new Error("invalidation failed");
            },
        });

        resource.getEntry("stable", true);
        resource.getEntry("flaky", true);
        await flushMicrotasks();

        // Only an active entry re-runs at once: hold it for the failing run.
        const flaky = resource.getEntry("flaky")!;
        const release = flaky.hold();
        flaky.invalidate();
        await flushMicrotasks();
        release();
        expect(flaky.peek().status).toBe("invalidate-error");

        const snapshot = api.getSnapshot();

        expect(CURRENT_SNAPSHOT_VERSION).toBe(2);
        expect(snapshot.version).toBe(2);

        const statuses = Object.values(snapshot.resources["sensor"].entries)
            .map((entry) => entry.status)
            .sort();
        expect(statuses).toEqual(["invalidate-error", "success"]);
    });
});

describe("Snapshotter hydration — consume and resetAll", () => {
    const now = Date.now();

    function profileSnapshot(): TApiSnapshot {
        return {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: now,
            resources: {
                profile: {
                    entries: {
                        [stableStringify({ id: 1 })]: {
                            status: "success",
                            args: { id: 1 },
                            data: { name: "ssr" },
                            updatedAt: now,
                        },
                    },
                },
            },
        };
    }

    const createProfile = (api: ReturnType<typeof createApi>) =>
        api.createResource<{ id: number }, { name: string }>({
            key: "profile",
            queryFn: async () => ({ name: "fresh" }),
        });

    it("a hydrated slice is consumed: a second resource with the same key starts empty", () => {
        const api = createApi({ initialSnapshot: profileSnapshot() });

        expect(createProfile(api).getState({ id: 1 }).data).toEqual({ name: "ssr" });
        expect(createProfile(api).getState({ id: 1 }).status).toBe("idle");
    });

    it("consuming a slice leaves the caller's snapshot object intact", () => {
        const snapshot = profileSnapshot();
        const api = createApi({ initialSnapshot: snapshot });

        createProfile(api);

        expect(snapshot).toEqual(profileSnapshot());
        expect(createProfile(createApi({ initialSnapshot: snapshot })).getState({ id: 1 }).status).toBe("success");
    });

    it("resetAll() clears the stored snapshot: a resource created afterwards is not hydrated", () => {
        const api = createApi({ initialSnapshot: profileSnapshot() });

        api.resetAll();

        expect(createProfile(api).getState({ id: 1 }).status).toBe("idle");
    });
});

describe("Snapshotter hydration — the stored snapshot is a deep clone", () => {
    const now = Date.now();

    function profileSnapshot(): TApiSnapshot {
        return {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: now,
            resources: {
                profile: {
                    entries: {
                        [stableStringify({ id: 1 })]: {
                            status: "success",
                            args: { id: 1 },
                            data: { name: "ssr", tags: ["a"] },
                            updatedAt: now,
                        },
                    },
                },
            },
        };
    }

    const createProfile = (api: ReturnType<typeof createApi>) =>
        api.createResource<{ id: number }, { name: string; tags: string[] }>({
            key: "profile",
            queryFn: async () => ({ name: "fresh", tags: [] }),
        });

    it("mutating the caller's snapshot after createApi does not reach hydrated entries", () => {
        const snapshot = profileSnapshot();
        const api = createApi({ initialSnapshot: snapshot });

        // The caller reuses / mutates its object after handing it over.
        const entry = snapshot.resources.profile.entries[stableStringify({ id: 1 })];
        (entry.data as { name: string }).name = "mutated";
        (entry.args as { id: number }).id = 999;

        const state = createProfile(api).getState({ id: 1 });
        expect(state.status).toBe("success");
        expect(state.data).toEqual({ name: "ssr", tags: ["a"] });
        expect(state.args).toEqual({ id: 1 });
    });

    it("mutating the caller's snapshot after hydration does not reach the cache entry", () => {
        const snapshot = profileSnapshot();
        const api = createApi({ initialSnapshot: snapshot });
        const resource = createProfile(api);

        const entry = snapshot.resources.profile.entries[stableStringify({ id: 1 })];
        (entry.data as { tags: string[] }).tags.push("mutated");

        expect(resource.getState({ id: 1 }).data).toEqual({ name: "ssr", tags: ["a"] });
    });

    it("the clone keeps values JSON would not: bigint, NaN, Infinity, undefined in an array", () => {
        const args = { id: 1n };
        const data = { n: 1n, x: NaN, y: Infinity, list: [undefined] };
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: now,
            resources: {
                profile: {
                    entries: {
                        [stableStringify(args)]: { status: "success", args, data, updatedAt: now },
                    },
                },
            },
        };
        const api = createApi({ initialSnapshot: snapshot });
        const resource = api.createResource<typeof args, typeof data>({
            key: "profile",
            queryFn: async () => data,
        });

        const state = resource.getState({ id: 1n });
        expect(state.status).toBe("success");
        expect(state.data).toEqual({ n: 1n, x: NaN, y: Infinity, list: [undefined] });
    });
});

describe("Snapshotter.getSnapshot — reference semantics (documented: no clone)", () => {
    // docs/query/usage/snapshot.md documents getSnapshot() as handing the raw
    // values out for serialization ("не приводит args и data к JSON"): the
    // caller JSON.stringifies and transfers it, never mutates it. Unlike
    // createApi({ initialSnapshot }), no deep-clone is promised here — this
    // pins that decision.
    it("returns the cache's own data by reference", async () => {
        const payload = { name: "Alice" };
        const api = createApi();
        const resource = api.createResource({ key: "users", queryFn: async () => payload });
        resource.getEntry(undefined as void, true);
        await flushMicrotasks();

        const snapshot = api.getSnapshot();

        const entries = snapshot.resources["users"].entries;
        expect(entries[Object.keys(entries)[0]].data).toBe(payload);
    });
});
