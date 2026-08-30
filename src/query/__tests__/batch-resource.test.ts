import { describe, expect, it, vi } from "vitest";

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
