import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import type { QueryCacheEntry } from "@/query/core/cache/QueryCacheEntry";
import { ProjectionItemMissingError } from "@/query/core/errors";
import type { TInFlightPolicy, TResourceEntryIdleState, TResourceEntryState } from "@/query/types";

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
    const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
        args.userIds.map((id) => ({ id, name: `user-${id}-${version()}` })),
    );
    const userResource = api.createResource({ queryFn });
    const projection = api.unstable_createProjectionResource({
        resource: userResource,
        key: "users-projection",
        parseData: (data) => data.map((item) => ({ id: item.id, item })),
        makeArgs: (ids) => ({ userIds: ids }),
        retentionTime: false,
    });
    return { api, queryFn, userResource, projection };
}

/** Let every microtask chain in flight run to completion. */
function settle(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A projection over a wrapped resource whose requests the test settles, in
 * any order. Each request answers with the server version current when it
 * was issued (`user-<id>-<version>`), so a stale answer is recognisable.
 */
function setupControlled(options: { invalidateInFlight?: TInFlightPolicy } = {}) {
    const api = createApi();
    const server = { version: "v1" };
    const requests: Array<{
        args: TBatchQueryArgs;
        signal: AbortSignal;
        resolve: () => void;
        reject: (error: unknown) => void;
    }> = [];
    const queryFn = vi.fn((args: TBatchQueryArgs, signal: AbortSignal): Promise<TUser[]> => {
        const issuedVersion = server.version;
        const { promise, resolve, reject } = defer<TUser[]>();
        requests.push({
            args,
            signal,
            resolve: () => resolve(args.userIds.map((id) => ({ id, name: `user-${id}-${issuedVersion}` }))),
            reject,
        });
        return promise;
    });
    const userResource = api.createResource({ queryFn });
    // Counts the id-set entries' runs: an in-place revalidation starts none.
    const runsStarted = vi.fn();
    const projection = api.unstable_createProjectionResource({
        resource: userResource,
        parseData: (data) => data.map((item) => ({ id: item.id, item })),
        makeArgs: (ids) => ({ userIds: ids }),
        retentionTime: false,
        invalidateInFlight: options.invalidateInFlight,
        onQueryStarted: runsStarted,
    });
    const namesOf = (args: number[]) => projection.getState(args).data?.map((user) => user.name);
    const argsOf = (from = 0) => requests.slice(from).map((request) => request.args.userIds);
    /** A held id-set entry, loaded with the current server version. */
    const loaded = async (ids: number[]) => {
        const entry = projection.getEntry(ids, true) as QueryCacheEntry<number[], TUser[]>;
        const release = entry.hold();
        for (const request of requests) request.resolve();
        await settle();
        expect(entry.peek().status).toBe("success");
        return { entry, release };
    };
    return { api, server, requests, queryFn, userResource, projection, namesOf, argsOf, loaded, runsStarted };
}

describe("ProjectionResource", () => {
    // ==================== Basic fetching ====================

    describe("basic fetching", () => {
        it("fetches all ids on the first request and returns items in requested order", async () => {
            const { projection, queryFn } = setup();

            const data = await projection.fetch([1, 2, 3]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(queryFn.mock.calls[0][0]).toEqual({ userIds: [1, 2, 3] });
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("serves a subset entirely from the item cache without a request", async () => {
            const { projection, queryFn } = setup();

            const first = await projection.fetch([1, 2, 3]);
            const second = await projection.fetch([1, 2]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(second.map((user) => user.id)).toEqual([1, 2]);
            // Same item instances are shared between id-set entries.
            expect(second[0]).toBe(first[0]);
            expect(second[1]).toBe(first[1]);
        });

        it("fetches only the ids missing from the item cache", async () => {
            const { projection, queryFn } = setup();

            await projection.fetch([1, 2, 3]);
            const data = await projection.fetch([1, 2, 4]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [4] });
            expect(data.map((user) => user.id)).toEqual([1, 2, 4]);
        });

        it("does not re-request an already cached id-set", async () => {
            const { projection, queryFn } = setup();

            await projection.fetch([1, 2, 3]);
            const data = await projection.ensure([1, 2, 3]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("deduplicates ids within a single request but keeps requested positions", async () => {
            const { projection, queryFn } = setup();

            const data = await projection.fetch([1, 1, 2]);

            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(queryFn.mock.calls[0][0]).toEqual({ userIds: [1, 2] });
            expect(data.map((user) => user.id)).toEqual([1, 1, 2]);
            expect(data[0]).toBe(data[1]);
        });

        it("resolves an empty id list without any request", async () => {
            const { projection, queryFn } = setup();

            const data = await projection.fetch([]);

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
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const firstPromise = projection.fetch([1, 2]);
            const secondPromise = projection.fetch([2, 3]);

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
        it("fails the id-set entry with ProjectionItemMissingError when the response misses a requested id", async () => {
            const api = createApi();
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.filter((id) => id < 100).map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const error = await projection.fetch([1, 999]).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(ProjectionItemMissingError);
            expect((error as ProjectionItemMissingError).ids).toEqual([999]);
            expect(projection.getState([1, 999]).status).toBe("error");
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
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const error = await projection.fetch([1, 2]).catch((caught: unknown) => caught);

            // A single mapError pass: the batch entry surfaces MappedError(Error),
            // not MappedError(MappedError(Error)).
            expect(error).toBeInstanceOf(MappedError);
            expect((error as MappedError).original).toBeInstanceOf(Error);
            expect(((error as MappedError).original as Error).message).toBe("boom");

            // The entry state holds the same single-mapped instance.
            const state = projection.getState([1, 2]);
            expect(state.status).toBe("error");
            expect(state.error).toBe(error);
        });

        it("maps a ProjectionItemMissingError through the api mapError once", async () => {
            class MappedError extends Error {
                constructor(readonly original: unknown) {
                    super("mapped");
                }
            }
            const api = createApi({ mapError: (error) => new MappedError(error) });
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.filter((id) => id < 100).map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const error = await projection.fetch([1, 999]).catch((caught: unknown) => caught);

            expect(error).toBeInstanceOf(MappedError);
            expect((error as MappedError).original).toBeInstanceOf(ProjectionItemMissingError);
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
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            await projection.fetch([1, 2]);
            await expect(projection.fetch([1, 4])).rejects.toThrow("network down");
            expect(projection.getState([1, 4]).status).toBe("error");

            shouldFail = false;
            // ensure() retries a failed entry; ids 1 and 2 are still cached.
            const data = await projection.ensure([1, 4]);

            expect(data.map((user) => user.id)).toEqual([1, 4]);
            expect(queryFn.mock.calls.map((call) => call[0])).toEqual([
                { userIds: [1, 2] },
                { userIds: [4] },
                { userIds: [4] },
            ]);
        });
    });

    // ==================== Invalidate ====================

    describe("invalidate", () => {
        it("refetches every id of the entry on invalidate, bypassing the item cache", async () => {
            const { projection, queryFn } = setup();

            await projection.fetch([1, 2, 3]);
            projection.invalidate([1, 2, 3]);
            const data = await projection.fetch([1, 2, 3]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [1, 2, 3] });
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("fails an invalidation with ProjectionItemMissingError when the response no longer covers an id", async () => {
            const api = createApi();
            let deletedId: number | null = null;
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.filter((id) => id !== deletedId).map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            await projection.fetch([1, 2, 3]);

            // Item 3 is deleted server-side; the invalidation response covers only {1, 2}.
            deletedId = 3;
            const error = await projection.fetch([1, 2, 3]).catch((caught: unknown) => caught);

            // The stale cached box of item 3 must not mask the missing id.
            expect(error).toBeInstanceOf(ProjectionItemMissingError);
            expect((error as ProjectionItemMissingError).ids).toEqual([3]);

            // A failed invalidation keeps the entry's own data (matrix row 9).
            const state = projection.getState([1, 2, 3]);
            expect(state.status).toBe("error");
            expect(state.dataSource).toBe("current");
            expect(state.data?.map((user) => user.id)).toEqual([1, 2, 3]);
        });

        it("an invalidation does not join an in-flight request started before it", async () => {
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
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            // E1 = [1, 2] loads; E2 = [2] is served from the item cache.
            const initial = projection.fetch([1, 2]);
            deferred[0].resolve([]);
            await initial;
            await projection.fetch([2]);
            expect(queryFn).toHaveBeenCalledTimes(1);

            // E1 invalidates — sids {1, 2} go in flight with pre-mutation data.
            const firstInvalidate = projection.fetch([1, 2]);
            expect(queryFn).toHaveBeenCalledTimes(2);

            // The server-side item 2 is mutated after E1's request was issued.
            version = "v2";

            // E2.invalidate() must issue a fresh request for id 2, not join E1's
            // pre-mutation in-flight projection.
            const secondInvalidate = projection.fetch([2]);
            expect(queryFn).toHaveBeenCalledTimes(3);
            expect(queryFn.mock.calls[2][0]).toEqual({ userIds: [2] });

            deferred[1].resolve([]);
            deferred[2].resolve([]);
            await firstInvalidate;
            const data = await secondInvalidate;

            expect(data.map((user) => user.name)).toEqual(["user-2-v2"]);
            expect(projection.getState([2]).data?.map((user) => user.name)).toEqual(["user-2-v2"]);
        });

        it("invalidate on a pending id-set (cancel) issues a fresh request instead of joining the cancelled load's batch", async () => {
            const api = createApi();
            let version = "v1";
            const deferred: Array<{ args: TBatchQueryArgs; resolve: () => void }> = [];
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
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            // E1 = [1] loads; E2 = [1, 2] joins that batch for id 1 and
            // requests id 2 on its own. Both are in flight; E2 is held.
            projection.getEntry([1], true);
            const entry = projection.getEntry([1, 2], true);
            entry.hold();
            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [2] });

            // The server-side items are mutated after those requests went out.
            version = "v2";

            // `cancel` restarts E2's run from `pending`. The restarted run is an
            // invalidation run all the same: it must not join the batches begun
            // before the invalidation (their abort is ignored by design), which
            // would settle the entry with pre-invalidation items.
            projection.invalidate([1, 2]);
            expect(queryFn).toHaveBeenCalledTimes(3);
            expect(queryFn.mock.calls[2][0]).toEqual({ userIds: [1, 2] });
            expect(entry.state$.peek().status).toBe("pending");

            deferred[0].resolve();
            deferred[1].resolve();
            await flushMicrotasks();
            await flushMicrotasks();
            // The earlier responses fill the item cache but do not settle E2:
            // its run waits for its own batch.
            expect(entry.state$.peek().status).toBe("pending");

            deferred[2].resolve();
            const data = await projection.fetch([1, 2], { inFlight: "join" });
            expect(queryFn).toHaveBeenCalledTimes(3);
            expect(data.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
        });

        it("invalidate on a pending id-set issues a genuinely new request for the same id set", async () => {
            const { server, requests, projection, namesOf } = setupControlled();

            // The cold load of [1, 2] is in flight; the entry is held.
            const entry = projection.getEntry([1, 2], true);
            entry.hold();
            expect(requests.map((request) => request.args)).toEqual([{ userIds: [1, 2] }]);

            server.version = "v2";

            // The invalidation run asks the wrapped resource for the very
            // same id set: it must not be served the load begun before it.
            projection.invalidate([1, 2]);
            expect(requests.map((request) => request.args)).toEqual([{ userIds: [1, 2] }, { userIds: [1, 2] }]);
            expect(requests[0]!.signal.aborted).toBe(true);

            // Out of order: the fresh answer first, the stale one after it.
            requests[1]!.resolve();
            await settle();
            expect(entry.state$.peek().status).toBe("success");
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);

            requests[0]!.resolve();
            await settle();
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            expect(requests).toHaveLength(2);
        });

        it("a second invalidation of the same id set does not join the first one's request", async () => {
            const { server, requests, projection, namesOf } = setupControlled();

            const entry = projection.getEntry([1, 2], true);
            entry.hold();
            requests[0]!.resolve();
            await settle();
            expect(namesOf([1, 2])).toEqual(["user-1-v1", "user-2-v1"]);

            // The first invalidation's request goes out before the mutation.
            projection.invalidate([1, 2]);
            expect(requests).toHaveLength(2);
            server.version = "v2";

            // The second one, after the mutation, must reach the server again.
            projection.invalidate([1, 2]);
            expect(requests).toHaveLength(3);
            expect(requests[2]!.args).toEqual({ userIds: [1, 2] });

            requests[1]!.resolve();
            requests[2]!.resolve();
            const data = await projection.fetch([1, 2], { inFlight: "join" });
            expect(data.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
            expect(requests).toHaveLength(3);
        });

        it("a batch superseded by an invalidation's request does not overwrite its items when it resolves later", async () => {
            const { server, requests, projection, namesOf } = setupControlled();

            // E1 = [1] loads; E2 = [1, 2] joins that batch for id 1 and
            // requests id 2 on its own. E2 is held.
            projection.getEntry([1], true);
            const entry = projection.getEntry([1, 2], true);
            entry.hold();
            expect(requests.map((request) => request.args)).toEqual([{ userIds: [1] }, { userIds: [2] }]);

            server.version = "v2";

            // The invalidation run requests every id of E2 afresh.
            projection.invalidate([1, 2]);
            expect(requests).toHaveLength(3);
            expect(requests[2]!.args).toEqual({ userIds: [1, 2] });

            // The fresh batch lands first...
            requests[2]!.resolve();
            await settle();
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);

            // ...the batches issued before the invalidation land after it:
            // their pre-invalidation items must not replace the fresh ones.
            requests[0]!.resolve();
            requests[1]!.resolve();
            await settle();
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            // E1's own load settles over the item cache, which holds the
            // fresher item.
            expect(projection.getState([1]).status).toBe("success");
            expect(namesOf([1])).toEqual(["user-1-v2"]);
            expect(requests).toHaveLength(3);
        });

        it("a batch issued before an invalidation still fills the cache when it resolves first", async () => {
            const { server, requests, projection, namesOf } = setupControlled();

            projection.getEntry([1], true);
            const entry = projection.getEntry([1, 2], true);
            entry.hold();
            server.version = "v2";
            projection.invalidate([1, 2]);
            expect(requests).toHaveLength(3);

            // In order: the older batch serves E1 with what it has...
            requests[0]!.resolve();
            requests[1]!.resolve();
            await settle();
            expect(namesOf([1])).toEqual(["user-1-v1"]);
            expect(entry.state$.peek().status).toBe("pending");

            // ...and the fresh batch then replaces it everywhere.
            requests[2]!.resolve();
            await settle();
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            expect(namesOf([1])).toEqual(["user-1-v2"]);
        });

        it("invalidate({ inFlight: 'join' }) on a pending id-set takes its cold load as the answer", async () => {
            const { server, requests, projection, namesOf, runsStarted } = setupControlled();

            const entry = projection.getEntry([1, 2], true) as QueryCacheEntry<number[], TUser[]>;
            entry.hold();
            expect(requests).toHaveLength(1);
            server.version = "v2";

            projection.invalidate([1, 2], { inFlight: "join" });

            // The cold load in flight answers the invalidation: nothing is
            // aborted, requested or marked, and the run is not restarted.
            expect(requests).toHaveLength(1);
            expect(requests[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);
            expect(runsStarted).toHaveBeenCalledTimes(1);

            requests[0]!.resolve();
            await settle();
            expect(requests).toHaveLength(1);
            expect(entry.peek().status).toBe("success");
            expect(namesOf([1, 2])).toEqual(["user-1-v1", "user-2-v1"]);
        });

        it("invalidate({ inFlight: 'join' }) on a loaded id-set with nothing in flight requests it anew", async () => {
            const { server, requests, projection, namesOf, loaded } = setupControlled();
            const { entry } = await loaded([1, 2]);
            server.version = "v2";

            projection.invalidate([1, 2], { inFlight: "join" });

            // No request of the wrapped resource is in flight for these ids —
            // there is nothing to join, so the ids are requested.
            expect(requests).toHaveLength(2);
            expect(requests[1]!.args).toEqual({ userIds: [1, 2] });
            expect(entry.peek().status).toBe("invalidating");

            requests[1]!.resolve();
            await settle();
            expect(entry.peek().status).toBe("success");
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
        });

        it("invalidate on an id-set nobody holds only marks it; the first hold issues the refetch", async () => {
            let currentVersion = "v1";
            const { projection, queryFn } = setup({ version: () => currentVersion });

            await projection.fetch([1, 2, 3]);
            expect(queryFn).toHaveBeenCalledTimes(1);

            currentVersion = "v2";
            projection.invalidate([1, 2, 3]);

            const entry = projection.getEntry([1, 2, 3])!;
            expect(entry.isInvalidated).toBe(true);
            expect(queryFn).toHaveBeenCalledTimes(1);
            expect(projection.getState([1, 2, 3]).data?.map((user) => user.name)).toEqual([
                "user-1-v1",
                "user-2-v1",
                "user-3-v1",
            ]);

            // The first hold starts the invalidation run: every id is refetched.
            entry.hold();
            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [1, 2, 3] });
            expect(projection.getState([1, 2, 3]).isInvalidating).toBe(true);

            // `fetch` joins the run in flight rather than starting another.
            await projection.fetch([1, 2, 3], { inFlight: "join" });
            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(projection.getState([1, 2, 3]).data?.map((user) => user.name)).toEqual([
                "user-1-v2",
                "user-2-v2",
                "user-3-v2",
            ]);
        });

        it("propagates invalidated items into overlapping success entries", async () => {
            let currentVersion = "v1";
            const { projection } = setup({ version: () => currentVersion });

            await projection.fetch([1, 2, 3]);
            await projection.fetch([1, 2, 4]);

            currentVersion = "v2";
            projection.invalidate([1, 2, 3]);
            await projection.fetch([1, 2, 3]);

            const overlapping = projection.getState([1, 2, 4]);
            expect(overlapping.status).toBe("success");
            expect(overlapping.data?.map((user) => user.name)).toEqual([
                "user-1-v2",
                "user-2-v2",
                // Id 4 was not part of the invalidated batch — untouched.
                "user-4-v1",
            ]);
        });
    });

    // ==================== In-flight policy ====================

    /**
     * Invalidating an id-set never restarts its run (the live projection of
     * the item cache): the run reloads its ids through the wrapped resource
     * under the in-flight policy, and re-emits once the reload lands.
     */
    describe("invalidateInFlight", () => {
        it("a held id-set revalidates in place: its run is not restarted, and it settles fresh", async () => {
            const { server, requests, projection, namesOf, loaded, runsStarted } = setupControlled();
            const { entry } = await loaded([1, 2]);
            server.version = "v2";

            projection.invalidate([1, 2]);

            expect(runsStarted).toHaveBeenCalledTimes(1);
            expect(requests.map((request) => request.args)).toEqual([{ userIds: [1, 2] }, { userIds: [1, 2] }]);
            expect(entry.isInvalidated).toBe(false);
            const pendingState = projection.getState([1, 2]);
            expect(pendingState.isInvalidating).toBe(true);
            expect(pendingState.data?.map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);

            requests[1]!.resolve();
            await settle();
            expect(entry.peek().status).toBe("success");
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            expect(runsStarted).toHaveBeenCalledTimes(1);
        });

        it("takes the resource's invalidateInFlight as the default and a per-call inFlight over it", async () => {
            const { requests, projection, loaded, argsOf } = setupControlled({ invalidateInFlight: "join" });
            await loaded([1, 2]);
            // Served from the item cache: no request.
            await loaded([2]);
            expect(requests).toHaveLength(1);

            // [2]'s cancelling reload puts id 2 in flight.
            projection.invalidate([2], { inFlight: "cancel" });
            expect(argsOf(1)).toEqual([[2]]);

            // The default `join` takes it for id 2 and requests only id 1.
            projection.invalidate([1, 2]);
            expect(argsOf(2)).toEqual([[1]]);

            // A per-call `cancel` requests every id afresh.
            projection.invalidate([1, 2], { inFlight: "cancel" });
            expect(argsOf(3)).toEqual([[1, 2]]);
            expect(requests).toHaveLength(4);
        });

        it("settles even when the reload changes no item", async () => {
            const api = createApi();
            const users: Record<number, TUser> = { 1: { id: 1, name: "one" }, 2: { id: 2, name: "two" } };
            // The server hands out the very same instances every time.
            const queryFn = vi.fn(async (args: TBatchQueryArgs) => args.userIds.map((id) => users[id]!));
            const projection = api.unstable_createProjectionResource({
                resource: api.createResource({ queryFn }),
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });
            const entry = projection.getEntry([1, 2], true);
            entry.hold();
            await settle();
            const before = projection.getState([1, 2]).data;

            projection.invalidate([1, 2]);
            expect(entry.peek().status).toBe("invalidating");
            await settle();

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(entry.peek().status).toBe("success");
            expect(projection.getState([1, 2]).data).toEqual(before);
        });

        describe("cancel", () => {
            it("requests every id afresh at once, not joining a request begun before it for part of them", async () => {
                const { server, requests, projection, namesOf, loaded, argsOf } = setupControlled();
                await loaded([1, 2]);
                await loaded([2, 3]);

                // [2, 3]'s reload is in flight for ids 2 and 3.
                projection.invalidate([2, 3]);
                expect(argsOf(2)).toEqual([[2, 3]]);
                server.version = "v2";

                projection.invalidate([1, 2]);

                // One fresh batch for the whole set; the other one is not
                // aborted — [2, 3] still awaits it.
                expect(argsOf(3)).toEqual([[1, 2]]);
                expect(requests[2]!.signal.aborted).toBe(false);

                // Out of order: the fresh batch lands first, the earlier one after.
                requests[3]!.resolve();
                await settle();
                expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
                requests[2]!.resolve();
                await settle();

                // The earlier batch settles [2, 3], but cannot overwrite item 2.
                expect(projection.getState([2, 3]).status).toBe("success");
                expect(namesOf([2, 3])).toEqual(["user-2-v2", "user-3-v1"]);
                expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            });

            it("aborts and reissues the wrapped request for exactly the same ids", async () => {
                const { server, requests, projection, namesOf, loaded } = setupControlled();
                const { entry } = await loaded([1, 2]);

                projection.invalidate([1, 2]);
                expect(requests).toHaveLength(2);
                server.version = "v2";

                projection.invalidate([1, 2]);

                // The wrapped entry for `{ userIds: [1, 2] }` restarts its run.
                expect(requests[1]!.signal.aborted).toBe(true);
                expect(requests).toHaveLength(3);

                requests[2]!.resolve();
                await settle();
                expect(entry.peek().status).toBe("success");
                expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            });
        });

        describe("trail", () => {
            it("lets the requests in flight for its ids settle, then requests every id afresh", async () => {
                const { server, requests, projection, namesOf, loaded, argsOf } = setupControlled();
                const { entry } = await loaded([1, 2]);
                await loaded([2]);
                projection.invalidate([2]);
                expect(argsOf(1)).toEqual([[2]]);
                server.version = "v2";

                projection.invalidate([1, 2], { inFlight: "trail" });

                // Nothing goes out while id 2 is in flight; nothing is aborted.
                expect(requests).toHaveLength(2);
                expect(requests[1]!.signal.aborted).toBe(false);
                expect(entry.peek().status).toBe("invalidating");
                expect(entry.isInvalidated).toBe(false);

                requests[1]!.resolve();
                await settle();
                // The trailed request settles [2] (issued before v2) — [1, 2]
                // stays invalidating until its own fresh batch lands.
                expect(argsOf(2)).toEqual([[1, 2]]);
                expect(entry.peek().status).toBe("invalidating");

                requests[2]!.resolve();
                await settle();
                expect(entry.peek().status).toBe("success");
                expect(entry.isInvalidated).toBe(false);
                expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            });

            it("on a pending id-set: the cold load settles first, then a fresh batch answers the invalidation", async () => {
                const { server, requests, projection, namesOf } = setupControlled();
                const entry = projection.getEntry([1, 2], true);
                entry.hold();
                server.version = "v2";

                projection.invalidate([1, 2], { inFlight: "trail" });
                expect(requests).toHaveLength(1);
                expect(requests[0]!.signal.aborted).toBe(false);

                requests[0]!.resolve();
                await settle();
                expect(requests).toHaveLength(2);
                // The cold load's pre-invalidation items do not settle the entry.
                expect(entry.peek().status).toBe("pending");

                requests[1]!.resolve();
                await settle();
                expect(entry.peek().status).toBe("success");
                expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
            });

            it("with nothing in flight requests at once, and leaves no mark behind", async () => {
                const { requests, projection, loaded } = setupControlled({ invalidateInFlight: "trail" });
                const { entry } = await loaded([1, 2]);

                projection.invalidate([1, 2]);

                expect(requests).toHaveLength(2);
                expect(entry.isInvalidated).toBe(false);
                requests[1]!.resolve();
                await settle();
                expect(entry.peek().status).toBe("success");
                expect(entry.isInvalidated).toBe(false);
            });
        });

        describe("join", () => {
            it("takes the requests in flight as the answer for their ids and requests only the rest", async () => {
                const { server, requests, projection, namesOf, loaded, argsOf } = setupControlled();
                const { entry } = await loaded([1, 2, 3]);
                await loaded([2]);
                // Id 2 goes in flight before the mutation.
                projection.invalidate([2]);
                server.version = "v2";

                projection.invalidate([1, 2, 3], { inFlight: "join" });

                expect(argsOf(2)).toEqual([[1, 3]]);
                expect(requests[1]!.signal.aborted).toBe(false);

                requests[2]!.resolve();
                await settle();
                // Still waiting for the joined request.
                expect(entry.peek().status).toBe("invalidating");

                requests[1]!.resolve();
                await settle();
                expect(entry.peek().status).toBe("success");
                // Id 2 is the joined request's answer, issued before the mutation.
                expect(namesOf([1, 2, 3])).toEqual(["user-1-v2", "user-2-v1", "user-3-v2"]);
                expect(requests).toHaveLength(3);
            });

            it("a second join of the same id-set joins the first one's request", async () => {
                const { requests, projection, loaded } = setupControlled({ invalidateInFlight: "join" });
                const { entry } = await loaded([1, 2]);

                projection.invalidate([1, 2]);
                projection.invalidate([1, 2]);

                expect(requests).toHaveLength(2);
                requests[1]!.resolve();
                await settle();
                expect(entry.peek().status).toBe("success");
            });

            it("fails the revalidation when the joined request fails", async () => {
                const { requests, projection, loaded } = setupControlled();
                const { entry } = await loaded([1, 2]);
                await loaded([2]);
                projection.invalidate([2]);

                projection.invalidate([1, 2], { inFlight: "join" });
                expect(requests).toHaveLength(3);
                requests[2]!.resolve();
                requests[1]!.reject(new Error("boom"));
                await settle();

                const state = projection.getState([1, 2]);
                expect(entry.peek().status).toBe("invalidate-error");
                expect(state.error).toEqual(new Error("boom"));
                expect(state.data?.map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);
            });
        });

        describe("unheld id-set", () => {
            it.each(["cancel", "trail", "join"] as const)(
                "%s: only marks it — no request, the run kept — and the first hold reloads",
                async (inFlight) => {
                    const { server, requests, projection, namesOf, loaded, runsStarted } = setupControlled();
                    const { entry, release } = await loaded([1, 2]);
                    release();
                    expect(entry.isMelting).toBe(true);
                    server.version = "v2";

                    projection.invalidate([1, 2], { inFlight });

                    expect(requests).toHaveLength(1);
                    expect(entry.isInvalidated).toBe(true);
                    expect(entry.peek().status).toBe("success");

                    entry.hold();

                    expect(requests).toHaveLength(2);
                    expect(entry.isInvalidated).toBe(false);
                    expect(entry.peek().status).toBe("invalidating");
                    requests[1]!.resolve();
                    await settle();
                    expect(entry.peek().status).toBe("success");
                    expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
                    expect(runsStarted).toHaveBeenCalledTimes(1);
                },
            );

            it("keeps receiving items from overlapping sets while marked", async () => {
                const { server, requests, projection, namesOf, loaded } = setupControlled();
                const { entry, release } = await loaded([1, 2]);
                release();
                await loaded([2]);
                server.version = "v2";

                projection.invalidate([1, 2]);
                projection.invalidate([2]);
                expect(requests).toHaveLength(2);
                requests[1]!.resolve();
                await settle();

                // The run is still live: item 2 reaches the marked set.
                expect(namesOf([1, 2])).toEqual(["user-1-v1", "user-2-v2"]);
                expect(entry.isInvalidated).toBe(true);
            });

            it("the strongest policy of the calls since the mark wins on the hold", async () => {
                const { projection, loaded, argsOf } = setupControlled();
                const { entry, release } = await loaded([1, 2]);
                release();
                await loaded([2]);
                projection.invalidate([2]);
                expect(argsOf(1)).toEqual([[2]]);

                projection.invalidate([1, 2], { inFlight: "join" });
                projection.invalidate([1, 2], { inFlight: "cancel" });
                entry.hold();

                // `cancel`: every id afresh, id 2's request in flight not joined.
                expect(argsOf(2)).toEqual([[1, 2]]);
            });

            it("fetch reloads it afresh and resolves with the fresh items", async () => {
                const { server, requests, projection, loaded } = setupControlled({ invalidateInFlight: "join" });
                const { entry, release } = await loaded([1, 2]);
                release();
                server.version = "v2";
                projection.invalidate([1, 2]);

                const fetched = projection.fetch([1, 2]);
                expect(requests).toHaveLength(2);
                requests[1]!.resolve();

                expect((await fetched).map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
                expect(entry.isInvalidated).toBe(false);
            });

            it("ensure resolves with the marked data and reloads behind it", async () => {
                const { server, requests, projection, loaded } = setupControlled();
                const { entry, release } = await loaded([1, 2]);
                release();
                server.version = "v2";
                projection.invalidate([1, 2]);

                const data = await projection.ensure([1, 2]);

                expect(data.map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);
                expect(requests).toHaveLength(2);
                expect(entry.isInvalidated).toBe(false);
            });
        });

        describe("fetch inFlight", () => {
            it("cancel (default) on a pending id-set reloads every id afresh and resolves with them", async () => {
                const { server, requests, projection, argsOf } = setupControlled({ invalidateInFlight: "join" });
                projection.getEntry([1, 2], true).hold();
                server.version = "v2";

                const fetched = projection.fetch([1, 2]);

                expect(argsOf(1)).toEqual([[1, 2]]);
                // The cold load's request for the same ids is reissued.
                expect(requests[0]!.signal.aborted).toBe(true);
                requests[1]!.resolve();
                expect((await fetched).map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
            });

            it("join on a pending id-set resolves with its cold load", async () => {
                const { server, requests, projection } = setupControlled();
                projection.getEntry([1, 2], true).hold();
                server.version = "v2";

                const fetched = projection.fetch([1, 2], { inFlight: "join" });

                expect(requests).toHaveLength(1);
                requests[0]!.resolve();
                expect((await fetched).map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);
                expect(requests).toHaveLength(1);
            });

            it("trail on a reloading id-set lets its requests settle, then resolves with a fresh reload", async () => {
                const { server, requests, projection, loaded, argsOf } = setupControlled();
                await loaded([1, 2]);
                projection.invalidate([1, 2]);
                expect(requests).toHaveLength(2);
                server.version = "v2";
                let settledWith: string[] | null = null;

                const fetched = projection.fetch([1, 2], { inFlight: "trail" });
                void fetched.then((data) => (settledWith = data.map((user) => user.name)));

                expect(requests).toHaveLength(2);
                expect(requests[1]!.signal.aborted).toBe(false);
                requests[1]!.resolve();
                await settle();
                expect(settledWith).toBeNull();
                expect(argsOf(2)).toEqual([[1, 2]]);

                requests[2]!.resolve();
                expect((await fetched).map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
            });

            it("join on a loaded id-set reloads it under join: requests in flight answer for their ids", async () => {
                const { requests, projection, loaded, argsOf } = setupControlled();
                await loaded([1, 2]);
                await loaded([2]);
                projection.invalidate([2]);
                expect(argsOf(1)).toEqual([[2]]);

                const fetched = projection.fetch([1, 2], { inFlight: "join" });

                expect(argsOf(2)).toEqual([[1]]);
                requests[1]!.resolve();
                requests[2]!.resolve();
                expect((await fetched).map((user) => user.id)).toEqual([1, 2]);
                expect(requests).toHaveLength(3);
            });

            it("prefetch({ force: true, inFlight }) forwards the policy", async () => {
                const { requests, projection, loaded } = setupControlled();
                await loaded([1, 2]);
                await loaded([2]);
                projection.invalidate([2]);

                void projection.prefetch([1, 2], { force: true, inFlight: "join" });

                expect(requests.map((request) => request.args.userIds)).toEqual([[1, 2], [2], [1]]);
            });
        });

        it("fetch on a held, loaded id-set reloads every id afresh", async () => {
            const { server, requests, projection, loaded, runsStarted } = setupControlled({
                invalidateInFlight: "join",
            });
            await loaded([1, 2]);
            server.version = "v2";

            const fetched = projection.fetch([1, 2]);
            expect(requests).toHaveLength(2);
            requests[1]!.resolve();

            expect((await fetched).map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
            expect(runsStarted).toHaveBeenCalledTimes(1);
        });

        it("a failed reload lands in invalidate-error; retry reloads every id afresh", async () => {
            const { server, requests, projection, namesOf, loaded, argsOf, runsStarted } = setupControlled();
            const { entry } = await loaded([1, 2]);
            await loaded([3]);

            projection.invalidate([1, 2]);
            requests[2]!.reject(new Error("boom"));
            await settle();
            expect(entry.peek().status).toBe("invalidate-error");
            expect(namesOf([1, 2])).toEqual(["user-1-v1", "user-2-v1"]);
            server.version = "v2";

            entry.retry();

            // A new run, answering the invalidation still: the cached items
            // are not trusted.
            expect(runsStarted).toHaveBeenCalledTimes(3);
            expect(argsOf(3)).toEqual([[1, 2]]);
            requests[3]!.resolve();
            await settle();
            expect(entry.peek().status).toBe("success");
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
        });

        it("a patch consistency violation reloads in place under the resource's policy", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const { requests, projection, loaded, runsStarted } = setupControlled({ invalidateInFlight: "join" });
                const { entry } = await loaded([1, 2]);

                // Patch 2 depends on the item patch 1 adds; aborting patch 1
                // makes patch 2's replay fail — a consistency violation.
                const h1 = entry.createPatch((draft) => {
                    draft.push({ id: 3, name: "added" });
                })!;
                entry.createPatch((draft) => {
                    draft[2]!.name = "renamed";
                });
                h1.abort();

                // `join` with nothing in flight: the ids are requested, the run kept.
                expect(entry.peek().status).toBe("invalidating");
                expect(requests).toHaveLength(2);
                expect(runsStarted).toHaveBeenCalledTimes(1);

                requests[1]!.resolve();
                await settle();
                const state = entry.peek();
                expect(state.status).toBe("success");
                expect(state.status === "success" && state.patchState).toBeNull();
                expect(state.data?.map((user) => user.id)).toEqual([1, 2]);
            } finally {
                warnSpy.mockRestore();
            }
        });

        it("an id-set invalidated while its reload is in flight settles with the latest reload only", async () => {
            const { server, requests, projection, namesOf, loaded } = setupControlled();
            const { entry } = await loaded([1, 2]);
            await loaded([2]);

            projection.invalidate([1, 2]);
            server.version = "v2";
            projection.invalidate([2]);
            projection.invalidate([1, 2], { inFlight: "trail" });
            expect(requests).toHaveLength(3);

            // The first reload's batch lands: the entry waits for the latest,
            // which trails [2]'s batch too.
            requests[1]!.resolve();
            await settle();
            expect(entry.peek().status).toBe("invalidating");
            expect(requests).toHaveLength(3);

            requests[2]!.resolve();
            await settle();
            expect(requests).toHaveLength(4);
            expect(entry.peek().status).toBe("invalidating");

            requests[3]!.resolve();
            await settle();
            expect(entry.peek().status).toBe("success");
            expect(namesOf([1, 2])).toEqual(["user-1-v2", "user-2-v2"]);
        });
    });

    // ==================== Reactive propagation ====================

    describe("reactive propagation", () => {
        it("an overlapping entry with an active patch receives invalidated items with the patch rebased", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                let currentVersion = "v1";
                const { projection } = setup({ version: () => currentVersion });

                await projection.fetch([1, 2, 3]);
                await projection.fetch([1, 2, 4]);

                const patched = projection.getEntry([1, 2, 4])!;
                patched.createPatch((data) => {
                    data[0].name = "patched";
                });

                currentVersion = "v2";
                projection.invalidate([1, 2, 3]);
                await projection.fetch([1, 2, 3]);

                const state = projection.getState([1, 2, 4]);
                expect(state.status).toBe("success");
                // Fresh items came through the live projection; the pending
                // patch was replayed on top (Immer replace at [0].name wins).
                expect(state.data?.map((user) => user.name)).toEqual(["patched", "user-2-v2", "user-4-v1"]);
                const patchedState = patched.state$.peek();
                expect(patchedState.status === "success" && patchedState.patchState).not.toBeNull();
            } finally {
                warnSpy.mockRestore();
            }
        });

        it("an invalidation run does not emit stale cached items before the refetch lands", async () => {
            const api = createApi();
            const deferred: Array<{ args: TBatchQueryArgs; resolve: (users: TUser[]) => void }> = [];
            const queryFn = vi.fn((args: TBatchQueryArgs): Promise<TUser[]> => {
                const { promise, resolve } = defer<TUser[]>();
                deferred.push({ args, resolve });
                return promise;
            });
            const userResource = api.createResource({ queryFn });
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            const initial = projection.fetch([1, 2]);
            deferred[0].resolve([
                { id: 1, name: "user-1-v1" },
                { id: 2, name: "user-2-v1" },
            ]);
            await initial;

            // Held: an active entry re-runs at once on invalidate.
            projection.getEntry([1, 2])!.hold();
            projection.invalidate([1, 2]);
            await flushMicrotasks();

            // The stale items are still cached, but the invalidation run is gated
            // behind its refetch — the entry must not settle prematurely.
            expect(projection.getState([1, 2]).isInvalidating).toBe(true);
            expect(projection.getState([1, 2]).data?.map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);

            deferred[1].resolve([
                { id: 1, name: "user-1-v2" },
                { id: 2, name: "user-2-v2" },
            ]);
            const data = await projection.fetch([1, 2], { inFlight: "join" });
            expect(data.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2"]);
        });

        it("one batch response produces a single emission on an overlapping entry", async () => {
            let currentVersion = "v1";
            const { projection } = setup({ version: () => currentVersion });

            await projection.fetch([1, 2, 3]);
            await projection.fetch([1, 2, 4]);

            const overlapping = projection.getEntry([1, 2, 4])!;
            let transitions = 0;
            const sub = overlapping.state$.obs.subscribe(() => {
                transitions += 1;
            });
            const baseline = transitions;

            currentVersion = "v2";
            projection.invalidate([1, 2, 3]);
            await projection.fetch([1, 2, 3]);
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
            const { api, projection, queryFn } = setup();

            await projection.fetch([1, 2]);
            api.resetAll();

            // The eviction is synchronous with the reset — a fetch issued in the
            // same tick must already miss the item cache.
            const data = await projection.fetch([1, 2]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ userIds: [1, 2] });
            expect(data.map((user) => user.id)).toEqual([1, 2]);
        });
    });

    // ==================== Lifecycle hooks ====================

    describe("lifecycle hooks", () => {
        it("fires user onCacheEntryAdded per id-set entry and keeps item eviction intact", async () => {
            const api = createApi();
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });

            const addedArgs: number[][] = [];
            const removals: Promise<void>[] = [];
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
                onCacheEntryAdded: (args, ctx) => {
                    addedArgs.push(args);
                    removals.push(ctx.$cacheEntryRemoved);
                },
            });

            await projection.fetch([1, 2]);
            await projection.fetch([1, 3]);

            expect(addedArgs).toEqual([
                [1, 2],
                [1, 3],
            ]);

            // The runtime's refcounting hook still runs alongside the user hook:
            // a reset must evict the items and force a refetch.
            api.resetAll();
            await Promise.all(removals);
            await projection.fetch([1, 2]);

            expect(queryFn.mock.calls.map((call) => call[0])).toEqual([
                { userIds: [1, 2] },
                { userIds: [3] },
                { userIds: [1, 2] },
            ]);
        });

        it("fires user onQueryStarted per run, including cache-only runs", async () => {
            const api = createApi();
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });

            const runs: Array<{ args: number[]; data: TUser[] }> = [];
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
                onQueryStarted: async (args, ctx) => {
                    const { data } = await ctx.$queryFulfilled;
                    runs.push({ args, data });
                },
            });

            await projection.fetch([1, 2]);
            // Served entirely from the item cache — no network, but still a run.
            await projection.fetch([1]);
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
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
                onCacheEntryAdded: () => {
                    throw new Error("consumer hook failure");
                },
            });

            await projection.fetch([1, 2]);
            const data = await projection.fetch([1, 2, 3]);

            // Refcounting survived the throwing hook: only id 3 was fetched.
            expect(queryFn.mock.calls.map((call) => call[0])).toEqual([{ userIds: [1, 2] }, { userIds: [3] }]);
            expect(data.map((user) => user.id)).toEqual([1, 2, 3]);
        });
    });

    // ==================== Snapshots ====================

    describe("snapshots", () => {
        it("excludes id-set entries from getSnapshot — the wrapped resource owns the data", async () => {
            const api = createApi();
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ key: "users", queryFn });
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                key: "users-projection",
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: false,
            });

            await projection.fetch([1, 2]);
            const snapshot = api.getSnapshot();

            expect(snapshot.resources["users-projection"]).toBeUndefined();
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
        it("applies a set-local patch and warns exactly once per projection resource", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
            try {
                const { projection } = setup();

                await projection.fetch([1, 2]);
                await projection.fetch([2, 3]);

                const firstEntry = projection.getEntry([1, 2])!;
                // Patch the shared item (id 2) to probe cross-set isolation.
                const handle = firstEntry.createPatch((data) => {
                    data[1].name = "patched";
                });

                expect(handle).not.toBeNull();
                // The patch is applied to this entry's projection...
                expect(projection.getState([1, 2]).data?.[1].name).toBe("patched");
                // ...but is set-local: the overlapping entry keeps the base item 2.
                expect(projection.getState([2, 3]).data?.[0].name).not.toBe("patched");

                expect(warnSpy).toHaveBeenCalledTimes(1);
                expect(warnSpy.mock.calls[0][0]).toContain("set-local");

                // Further patches (same or another entry) do not warn again.
                projection.getEntry([2, 3])!.createPatch((data) => {
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
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                parseArgs: (args: { ids: number[]; tag?: string }) => args.ids,
                retentionTime: false,
            });

            await projection.fetch({ ids: [1, 2] });
            const data = await projection.fetch({ ids: [2, 3], tag: "x" });

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
            const projection = api.unstable_createProjectionResource({
                resource: itemResource,
                parseData: (data) => data.map((item) => ({ id: item.key, item })),
                makeArgs: (ids) => ({ keys: ids }),
                retentionTime: false,
            });

            await projection.fetch([{ tenant: "a", id: 1 }]);
            // The same id spelled with a different property order must hit the
            // item cache — only the second id is requested.
            await projection.fetch([
                { id: 1, tenant: "a" },
                { tenant: "a", id: 2 },
            ]);

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(queryFn.mock.calls[1][0]).toEqual({ keys: [{ tenant: "a", id: 2 }] });
        });
    });

    // ==================== Retention time as a function ====================

    describe("retentionTime as a function", () => {
        /**
         * The `state` the option receives: the id-set entry's row — over the
         * projection resource's own args and its assembled `TItem[]`, not the
         * wrapped resource's args or response.
         */
        type TProjectionRetentionState = Exclude<TResourceEntryState<number[], TUser[]>, TResourceEntryIdleState>;

        it("receives the projection resource's own args and the id-set entry state", async () => {
            const api = createApi();
            const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> =>
                args.userIds.map((id) => ({ id, name: `user-${id}` })),
            );
            const userResource = api.createResource({ queryFn });

            const seen: { args: number[]; state: TProjectionRetentionState }[] = [];
            const projection = api.unstable_createProjectionResource({
                resource: userResource,
                parseData: (data) => data.map((item) => ({ id: item.id, item })),
                makeArgs: (ids) => ({ userIds: ids }),
                retentionTime: (args: number[], state: TProjectionRetentionState) => {
                    seen.push({ args, state });
                    return false;
                },
            });

            // `fetch` holds the id-set entry alive until it settles; dropping
            // that subscription is the `active → retention` transition.
            await projection.fetch([1, 2]);
            await flushMicrotasks();

            expect(seen.map((call) => call.args)).toEqual([[1, 2]]);

            const { state } = seen[0]!;
            expect(state).toMatchObject({
                status: "success",
                dataSource: "current",
                hasData: true,
                hasError: false,
                args: [1, 2],
            });
            expect(state.data).toEqual([
                { id: 1, name: "user-1" },
                { id: 2, name: "user-2" },
            ]);
        });
    });
});
