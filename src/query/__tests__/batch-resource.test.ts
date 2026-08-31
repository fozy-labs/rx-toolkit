import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { BatchItemMissingError } from "@/query/core/errors";

type TUser = { id: number; name: string };

type TBatchQueryArgs = { userIds: number[] };

/** A deferred promise with external resolve/reject controls. */
function defer<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function setup(options?: { version?: () => string }) {
    const api = createApi();
    const version = options?.version ?? (() => "v1");
    const queryFn = vi.fn(
        async (args: TBatchQueryArgs): Promise<TUser[]> =>
            args.userIds.map((id) => ({ id, name: `user-${id}-${version()}` })),
    );
    const userResource = api.createResource({ queryFn });
    const batch = api.createBatchResource({
        resource: userResource,
        key: "users-batch",
        parseData: (data) => data.map((item) => ({ id: item.id, item })),
        makeArgs: (ids) => ({ userIds: ids }),
        retentionTime: false,
    });
    return { api, queryFn, userResource, batch };
}

describe("BatchResource", () => {
    // ==================== Basic fetching ====================

    describe("basic fetching", () => {
        it("fetches all ids on the first request and returns items in requested order", async () => {
            const { batch, queryFn } = setup();

            const data = await batch.fetch([1, 2, 3]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(queryFn.mock.calls[0][0]).toEqual({ userIds: [1, 2, 3] });
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("serves a subset entirely from the item cache without a request", async () => {
            const { batch, queryFn } = setup();

            const first = await batch.fetch([1, 2, 3]);
            const second = await batch.fetch([1, 2]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(second.map((user) => user.id)).toEqual([1, 2]);
            // Same item instances are shared between id-set entries.
            expect(second[0]).toBe(first[0]);
            expect(second[1]).toBe(first[1]);
        });

        it("fetches only the ids missing from the item cache", async () => {
            const { batch, queryFn } = setup();

            await batch.fetch([1, 2, 3]);
            const data = await batch.fetch([1, 2, 4]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [4] });
            expect(data.map((user) => user.id)).toEqual([1, 2, 4]);
        });

        it("does not re-request an already cached id-set", async () => {
            const { batch, queryFn } = setup();

            await batch.fetch([1, 2, 3]);
            const data = await batch.ensure([1, 2, 3]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("deduplicates ids within a single request but keeps requested positions", async () => {
            const { batch, queryFn } = setup();

            const data = await batch.fetch([1, 1, 2]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(queryFn.mock.calls[0][0]).toEqual({ userIds: [1, 2] });
            expect(data.map((user) => user.id)).toEqual([1, 1, 2]);
            expect(data[0]).toBe(data[1]);
        });

        it("resolves an empty id list without any request", async () => {
            const { batch, queryFn } = setup();

            const data = await batch.fetch([]);

            expect(queryFn).not.toHaveBeenCalled();
            expect(data).toEqual([]);
        });
    });

    // ==================== In-flight deduplication ====================

    describe("in-flight deduplication", () => {
        it("joins an in-flight batch instead of re-requesting overlapping ids", async () => {
            const api = createApi();
            const deferred: Array<{ args: TBatchQueryArgs; resolve: (users: TUser[]) => void }> = [];
            const queryFn = vi.fn((args: TBatchQueryArgs): Promise<TUser[]> => {
                const { promise, resolve } = defer<TUser[]>();
                deferred.push({ args, resolve });
                return promise;
            });
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const firstPromise = batch.fetch([1, 2]);
            const secondPromise = batch.fetch([2, 3]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[0][0]).toEqual({ userIds: [1, 2] });
            // Id 2 is covered by the in-flight batch — only 3 is requested.
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [3] });

            for (const { args, resolve } of deferred) {
                resolve(args.userIds.map((id) => ({ id, name: `user-${id}` })));
            }

            const [first, second] = await Promise.all([firstPromise, secondPromise]);
            expect(first.map((user) => user.id)).toEqual([1, 2]);
            expect(second.map((user) => user.id)).toEqual([2, 3]);
            // Id 2 came from the first batch and is shared.
            expect(second[0]).toBe(first[1]);
        });
    });

    // ==================== Errors ====================

    describe("errors", () => {
        it("fails the id-set entry with BatchItemMissingError when the response misses a requested id", async () => {
            const api = createApi();
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.filter((id) => id < 100).map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const error = await batch.fetch([1, 999]).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(BatchItemMissingError);
            expect((error as BatchItemMissingError).ids).toEqual([999]);
            expect(batch.getState([1, 999]).status).toBe("error");
        });

        it("maps a wrapped resource's failure through the api mapError exactly once", async () => {
            class MappedError extends Error {
                constructor(readonly original: unknown) {
                    super("mapped");
                }
            }
            const api = createApi({ mapError: (error) => new MappedError(error) });
            const queryFn = vi.fn(async (_args: TBatchQueryArgs): Promise<TUser[]> => {
                throw new Error("boom");
            });
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const error = await batch.fetch([1, 2]).catch((caught: unknown) => caught);

            // A single mapError pass: the batch entry surfaces MappedError(Error),
            // not MappedError(MappedError(Error)).
            expect(error).toBeInstanceOf(MappedError);
            expect((error as MappedError).original).toBeInstanceOf(Error);
            expect(((error as MappedError).original as Error).message).toBe("boom");

            // The entry state holds the same single-mapped instance.
            const state = batch.getState([1, 2]);
            expect(state.status).toBe("error");
            expect(state.error).toBe(error);
        });

        it("maps a BatchItemMissingError through the api mapError once", async () => {
            class MappedError extends Error {
                constructor(readonly original: unknown) {
                    super("mapped");
                }
            }
            const api = createApi({ mapError: (error) => new MappedError(error) });
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.filter((id) => id < 100).map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const error = await batch.fetch([1, 999]).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(MappedError);
            expect((error as MappedError).original).toBeInstanceOf(BatchItemMissingError);
        });

        it("propagates the wrapped resource's failure and retries only the missing ids", async () => {
            const api = createApi();
            let shouldFail = true;
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> => {
                if (shouldFail && args.userIds.includes(4)) {
                    throw new Error("network down");
                }
                return args.userIds.map((id) => ({ id, name: `user-${id}` }));
            });
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            await batch.fetch([1, 2]);
            await expect(batch.fetch([1, 4])).rejects.toThrow("network down");
            expect(batch.getState([1, 4]).status).toBe("error");

            shouldFail = false;
            // ensure() retries a failed entry; ids 1 and 2 are still cached.
            const data = await batch.ensure([1, 4]);

            expect(data.map((user) => user.id)).toEqual([1, 4]);
            expect(queryFn.mock.calls.map((call) => call[0])).toEqual([
                { userIds: [1, 2] },
                { userIds: [4] },
                { userIds: [4] },
            ]);
        });
    });

    // ==================== Refresh ====================

    describe("refresh", () => {
        it("refetches every id of the entry on refresh, bypassing the item cache", async () => {
            const { batch, queryFn } = setup();

            await batch.fetch([1, 2, 3]);
            batch.refresh([1, 2, 3]);
            const data = await batch.fetch([1, 2, 3]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [1, 2, 3] });
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("fails a refresh with BatchItemMissingError when the response no longer covers an id", async () => {
            const api = createApi();
            let deletedId: number | null = null;
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.filter((id) => id !== deletedId).map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            await batch.fetch([1, 2, 3]);

            // Item 3 is deleted server-side; the refresh response covers only {1, 2}.
            deletedId = 3;
            const error = await batch.fetch([1, 2, 3]).catch((caught: unknown) => caught);

            // The stale cached box of item 3 must not mask the missing id.
            expect(error).toBeInstanceOf(BatchItemMissingError);
            expect((error as BatchItemMissingError).ids).toEqual([3]);

            // A failed refresh keeps the stale data (regular refresh-error semantics).
            const state = batch.getState([1, 2, 3]);
            expect(state.status).toBe("refresh-error");
            expect(state.data?.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("a refresh does not join an in-flight request started before it", async () => {
            const api = createApi();
            let version = "v1";
            const deferred: Array<{ args: TBatchQueryArgs; resolve: (users: TUser[]) => void }> = [];
            const queryFn = vi.fn((args: TBatchQueryArgs): Promise<TUser[]> => {
                const capturedVersion = version;
                const { promise, resolve } = defer<TUser[]>();
                deferred.push({
                    args,
                    resolve: () => resolve(args.userIds.map((id) => ({ id, name: `user-${id}-${capturedVersion}` }))),
                });
                return promise;
            });
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            // E1 = [1, 2] loads; E2 = [2] is served from the item cache.
            const initial = batch.fetch([1, 2]);
            deferred[0].resolve([]);
            await initial;
            await batch.fetch([2]);
            expect(queryFn).toHaveBeenCalledTimes(1);

            // E1 refreshes — sids {1, 2} go in flight with pre-mutation data.
            const firstRefresh = batch.fetch([1, 2]);
            expect(queryFn).toHaveBeenCalledTimes(2);

            // The server-side item 2 is mutated after E1's request was issued.
            version = "v2";

            // E2.refresh() must issue a fresh request for id 2, not join E1's
            // pre-mutation in-flight batch.
            const secondRefresh = batch.fetch([2]);
            expect(queryFn).toHaveBeenCalledTimes(3);
            expect(queryFn.mock.calls[2][0]).toEqual({ userIds: [2] });

            deferred[1].resolve([]);
            deferred[2].resolve([]);
            await firstRefresh;
            const data = await secondRefresh;

            expect(data.map((user) => user.name)).toEqual(["user-2-v2"]);
            expect(batch.getState([2]).data?.map((user) => user.name)).toEqual(["user-2-v2"]);
        });

        it("propagates refreshed items into overlapping success entries", async () => {
            let currentVersion = "v1";
            const { batch } = setup({ version: () => currentVersion });

            await batch.fetch([1, 2, 3]);
            await batch.fetch([1, 2, 4]);

            currentVersion = "v2";
            batch.refresh([1, 2, 3]);
            await batch.fetch([1, 2, 3]);

            const overlapping = batch.getState([1, 2, 4]);
            expect(overlapping.status).toBe("success");
            expect(overlapping.data?.map((user) => user.name)).toEqual([
                "user-1-v2",
                "user-2-v2",
                // Id 4 was not part of the refreshed batch — untouched.
                "user-4-v1",
            ]);
        });
    });

    // ==================== Reactive propagation ====================

    describe("reactive propagation", () => {
        it("an overlapping entry with an active patch receives refreshed items with the patch rebased", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                let currentVersion = "v1";
                const { batch } = setup({ version: () => currentVersion });

                await batch.fetch([1, 2, 3]);
                await batch.fetch([1, 2, 4]);

                const patched = batch.getEntry([1, 2, 4])!;
                patched.createPatch((data) => {
                    data[0].name = "patched";
                });

                currentVersion = "v2";
                batch.refresh([1, 2, 3]);
                await batch.fetch([1, 2, 3]);

                const state = batch.getState([1, 2, 4]);
                expect(state.status).toBe("success");
                // Fresh items came through the live projection; the pending
                // patch was replayed on top (Immer replace at [0].name wins).
                expect(state.data?.map((user) => user.name)).toEqual(["patched", "user-2-v2", "user-4-v1"]);
                const machine = patched.machine$.peek();
                expect(machine.status === "success" && machine.state.patchState).not.toBeNull();
            } finally {
                warnSpy.mockRestore();
            }
        });

        it("a refresh run does not emit stale cached items before the refetch lands", async () => {
            const api = createApi();
            const deferred: Array<{ args: TBatchQueryArgs; resolve: (users: TUser[]) => void }> = [];
            const queryFn = vi.fn((args: TBatchQueryArgs): Promise<TUser[]> => {
                const { promise, resolve } = defer<TUser[]>();
                deferred.push({ args, resolve });
                return promise;
            });
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const initial = batch.fetch([1, 2]);
            deferred[0].resolve([
                { id: 1, name: "user-1-v1" },
                { id: 2, name: "user-2-v1" },
            ]);
            await initial;

            batch.refresh([1, 2]);
            await flushMicrotasks();

            // The stale items are still cached, but the refresh run is gated
            // behind its refetch — the entry must not settle prematurely.
            expect(batch.getState([1, 2]).status).toBe("refreshing");
            expect(batch.getState([1, 2]).data?.map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);

            deferred[1].resolve([
                { id: 1, name: "user-1-v2" },
                { id: 2, name: "user-2-v2" },
            ]);
            const data = await batch.fetch([1, 2]);
            expect(data.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
        });

        it("one batch response produces a single emission on an overlapping entry", async () => {
            let currentVersion = "v1";
            const { batch } = setup({ version: () => currentVersion });

            await batch.fetch([1, 2, 3]);
            await batch.fetch([1, 2, 4]);

            const overlapping = batch.getEntry([1, 2, 4])!;
            let transitions = 0;
            const sub = overlapping.machine$.obs.subscribe(() => {
                transitions += 1;
            });
            const baseline = transitions;

            currentVersion = "v2";
            batch.refresh([1, 2, 3]);
            await batch.fetch([1, 2, 3]);
            await flushMicrotasks();

            // Items 1 and 2 changed in one distributed response — the
            // projection coalesces them into one stream emission.
            expect(transitions - baseline).toBe(1);
            sub.unsubscribe();
        });
    });

    // ==================== Item eviction ====================

    describe("item eviction", () => {
        it("evicts items once the referencing entries are removed (resetAll)", async () => {
            const { api, batch, queryFn } = setup();

            await batch.fetch([1, 2]);
            api.resetAll();

            // The eviction is synchronous with the reset — a fetch issued in the
            // same tick must already miss the item cache.
            const data = await batch.fetch([1, 2]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [1, 2] });
            expect(data.map((user) => user.id)).toEqual([1, 2]);
        });
    });

    // ==================== Lifecycle hooks ====================

    describe("lifecycle hooks", () => {
        it("fires user onCacheEntryAdded per id-set entry and keeps item eviction intact", async () => {
            const api = createApi();
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });

            const addedArgs: number[][] = [];
            const removals: Promise<void>[] = [];
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
                onCacheEntryAdded: (args, ctx) => {
                    addedArgs.push(args);
                    removals.push(ctx.$cacheEntryRemoved);
                },
            });

            await batch.fetch([1, 2]);
            await batch.fetch([1, 3]);

            expect(addedArgs).toEqual([
                [1, 2],
                [1, 3],
            ]);

            // The runtime's refcounting hook still runs alongside the user hook:
            // a reset must evict the items and force a refetch.
            api.resetAll();
            await Promise.all(removals);
            await batch.fetch([1, 2]);

            expect(queryFn.mock.calls.map((call) => call[0])).toEqual([
                { userIds: [1, 2] },
                { userIds: [3] },
                { userIds: [1, 2] },
            ]);
        });

        it("fires user onQueryStarted per run, including cache-only runs", async () => {
            const api = createApi();
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });

            const runs: Array<{ args: number[]; data: TUser[] }> = [];
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
                onQueryStarted: async (args, ctx) => {
                    const { data } = await ctx.$queryFulfilled;
                    runs.push({ args, data });
                },
            });

            await batch.fetch([1, 2]);
            // Served entirely from the item cache — no network, but still a run.
            await batch.fetch([1]);
            // The async hook lands its push one microtask after fetch resolves.
            await flushMicrotasks();

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(runs).toEqual([
                { args: [1, 2], data: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })] },
                { args: [1], data: [expect.objectContaining({ id: 1 })] },
            ]);
        });

        it("a throwing user hook does not break the runtime bookkeeping", async () => {
            const api = createApi();
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
                onCacheEntryAdded: () => {
                    throw new Error("consumer hook failure");
                },
            });

            await batch.fetch([1, 2]);
            const data = await batch.fetch([1, 2, 3]);

            // Refcounting survived the throwing hook: only id 3 was fetched.
            expect(queryFn.mock.calls.map((call) => call[0])).toEqual([{ userIds: [1, 2] }, { userIds: [3] }]);
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });
    });

    // ==================== Snapshots ====================

    describe("snapshots", () => {
        it("excludes id-set entries from getSnapshot — the wrapped resource owns the data", async () => {
            const api = createApi();
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ key: "users", queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                key: "users-batch",
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            await batch.fetch([1, 2]);
            const snapshot = api.getSnapshot();

            expect(snapshot.resources["users-batch"]).toBeUndefined();
            expect(snapshot.resources["users"]).toBeDefined();
        });

        it("a snapshotable: false resource does not hydrate from initialSnapshot", async () => {
            const sourceApi = createApi();
            const source = sourceApi.createResource({
                key: "r",
                queryFn: async (n: number) => `d-${n}`,
            });
            await source.fetch(1);
            const snapshot = sourceApi.getSnapshot();

            const api = createApi({ initialSnapshot: snapshot });
            const hydrated = api.createResource({
                key: "r",
                queryFn: async (n: number) => `fresh-${n}`,
                snapshotable: false,
            });

            expect(hydrated.getEntry(1)).toBeNull();
        });
    });

    // ==================== Patches ====================

    describe("patches", () => {
        it("applies a set-local patch and warns exactly once per batch resource", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const { batch } = setup();

                await batch.fetch([1, 2]);
                await batch.fetch([2, 3]);

                const firstEntry = batch.getEntry([1, 2])!;
                // Patch the shared item (id 2) to probe cross-set isolation.
                const handle = firstEntry.createPatch((data) => {
                    data[1].name = "patched";
                });

                expect(handle).not.toBeNull();
                // The patch is applied to this entry's projection...
                expect(batch.getState([1, 2]).data?.[1].name).toBe("patched");
                // ...but is set-local: the overlapping entry keeps the base item 2.
                expect(batch.getState([2, 3]).data?.[0].name).not.toBe("patched");

                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][0]).toContain("set-local");

                // Further patches (same or another entry) do not warn again.
                batch.getEntry([2, 3])!.createPatch((data) => {
                    data[0].name = "patched-2";
                });
                expect(warnSpy).toHaveBeenCalledTimes(1);
            } finally {
                warnSpy.mockRestore();
            }
        });
    });

    // ==================== Custom args & ids ====================

    describe("custom args and ids", () => {
        it("supports custom args via parseArgs", async () => {
            const api = createApi();
            const queryFn = vi.fn(
                async (args: TBatchQueryArgs): Promise<TUser[]> =>
                    args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                parseArgs: (args: { ids: number[]; tag?: string }) => args.ids,
                retentionTime: false,
            });

            await batch.fetch({ ids: [1, 2] });
            const data = await batch.fetch({ ids: [2, 3], tag: "x" });

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[0][0]).toEqual({ userIds: [1, 2] });
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [3] });
            expect(data.map((user) => user.id)).toEqual([2, 3]);
        });

        it("keys object ids structurally via the default serializeId", async () => {
            const api = createApi();
            type TKey = { tenant: string; id: number };
            const queryFn = vi.fn(async (args: { keys: TKey[] }) =>
                args.keys.map((key) => ({ key, name: `user-${key.tenant}-${key.id}` })),
            );
            const itemResource = api.createResource({ queryFn });
            const batch = api.createBatchResource({
                resource: itemResource,
                parseData: (data) => data.map((item) => ({ id: item.key, item })),
                makeArgs: (ids) => ({ keys: ids }),
                retentionTime: false,
            });

            await batch.fetch([{ tenant: "a", id: 1 }]);
            // The same id spelled with a different property order must hit the
            // item cache — only the second id is requested.
            await batch.fetch([
                { id: 1, tenant: "a" },
                { tenant: "a", id: 2 },
            ]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ keys: [{ tenant: "a", id: 2 }] });
        });
    });
});
