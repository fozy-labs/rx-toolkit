import { act, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createApi } from "@/query/api/createApi";
import { SKIP } from "@/query/constants";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TInfiniteResourceState } from "@/query/types";

const h = React.createElement;

// ==================== Helpers ====================

type TUser = { id: number; name: string };
type TBatchQueryArgs = { userIds: number[] };

function createBatchSetup(options?: { version?: () => string; failOn?: (ids: number[]) => boolean }) {
    const api = createApi({ plugins: [reactHooksPlugin()] });
    const version = options?.version ?? (() => "v1");
    const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> => {
        if (options?.failOn?.(args.userIds)) {
            throw new Error("network down");
        }
        return args.userIds.map((id) => ({ id, name: `user-${id}-${version()}` }));
    });
    const userResource = api.createResource({ queryFn });
    const batch = api.createBatchResource({
        resource: userResource,
        key: "users-batch",
        parseData: (data) => data.map((item) => ({ id: item.id, item })),
        makeArgs: (ids) => ({ userIds: ids }),
        retentionTime: false,
    });
    return { api, queryFn, batch };
}

interface Captured {
    state: TInfiniteResourceState<number[], TUser[], unknown>;
    rerender: (args: number[] | typeof SKIP) => void;
}

/** Render a probe component around useInfiniteResource and expose the live state. */
function setup(
    useInfiniteResource: (initialArgs: number[] | typeof SKIP) => TInfiniteResourceState<number[], TUser[], unknown>,
    initialArgs: number[] | typeof SKIP,
): Captured {
    const captured = {} as Captured;

    function Probe({ args }: { args: number[] | typeof SKIP }) {
        captured.state = useInfiniteResource(args);
        return null;
    }

    const view = render(h(Probe, { args: initialArgs }));
    captured.rerender = (args) => view.rerender(h(Probe, { args }));
    return captured;
}

async function settle(): Promise<void> {
    await act(async () => {
        await flushMicrotasks();
        await flushMicrotasks();
    });
}

// ==================== Tests ====================

describe("useInfiniteResource", () => {
    it("loads the initial page and exposes its items as data", async () => {
        const { batch } = createBatchSetup();

        const c = setup(batch.useInfiniteResource, [1, 2]);
        expect(c.state.isInitialLoading).toBe(true);
        expect(c.state.data).toBeNull();
        expect(c.state.pages).toHaveLength(1);

        await settle();

        expect(c.state.isInitialLoading).toBe(false);
        expect(c.state.isLoading).toBe(false);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);
    });

    it("fetchNext appends a page and flattens data in page order", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const deferred: Array<{ args: TBatchQueryArgs; resolve: (users: TUser[]) => void }> = [];
        const queryFn = vi.fn(
            (args: TBatchQueryArgs) =>
                new Promise<TUser[]>((resolve) => {
                    deferred.push({ args, resolve });
                }),
        );
        const userResource = api.createResource({ queryFn });
        const batch = api.createBatchResource({
            resource: userResource,
            parseData: (data) => data.map((item) => ({ id: item.id, item })),
            makeArgs: (ids) => ({ userIds: ids }),
            retentionTime: false,
        });

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await act(async () => {
            deferred[0].resolve([1, 2].map((id) => ({ id, name: `user-${id}` })));
            await flushMicrotasks();
        });
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);

        await act(async () => {
            c.state.fetchNext([3, 4]);
            await flushMicrotasks();
        });
        expect(c.state.pages).toHaveLength(2);
        expect(c.state.isFetchingNext).toBe(true);
        // Loaded data stays visible while the tail loads.
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);

        await act(async () => {
            deferred[1].resolve([3, 4].map((id) => ({ id, name: `user-${id}` })));
            await flushMicrotasks();
        });

        expect(c.state.isFetchingNext).toBe(false);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2, 3, 4]);
        expect(queryFn.mock.calls.map((call) => call[0])).toEqual([{ userIds: [1, 2] }, { userIds: [3, 4] }]);
    });

    it("pages share the batch item cache — only missing ids reach the network", async () => {
        const { batch, queryFn } = createBatchSetup();

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await settle();

        act(() => c.state.fetchNext([2, 3]));
        await settle();

        // Id 2 came from the item cache; the same instance is shared.
        expect(queryFn.mock.calls.map((call) => call[0])).toEqual([{ userIds: [1, 2] }, { userIds: [3] }]);
        expect(c.state.data?.[1]).toBe(c.state.data?.[2]);
    });

    it("fetchNext with the args of an existing page is a no-op", async () => {
        const { batch, queryFn } = createBatchSetup();

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await settle();

        act(() => c.state.fetchNext([1, 2]));
        await settle();

        expect(c.state.pages).toHaveLength(1);
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("a failed next page surfaces the error, keeps loaded data, and fetchNext retries it", async () => {
        let shouldFail = true;
        const { batch } = createBatchSetup({ failOn: (ids) => shouldFail && ids.includes(3) });

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await settle();

        act(() => c.state.fetchNext([3]));
        await settle();

        expect(c.state.isError).toBe(true);
        expect(c.state.error).toBeInstanceOf(Error);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);

        shouldFail = false;
        act(() => c.state.fetchNext([3]));
        await settle();

        expect(c.state.isError).toBe(false);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2, 3]);
        expect(c.state.pages).toHaveLength(2);
    });

    it("reset() drops every page after the first", async () => {
        const { batch } = createBatchSetup();

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await settle();
        act(() => c.state.fetchNext([3, 4]));
        await settle();

        act(() => c.state.reset());
        await settle();

        expect(c.state.pages).toHaveLength(1);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);
    });

    it("refresh() re-validates every loaded page", async () => {
        let currentVersion = "v1";
        const { batch, queryFn } = createBatchSetup({ version: () => currentVersion });

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await settle();
        act(() => c.state.fetchNext([3]));
        await settle();

        currentVersion = "v2";
        act(() => c.state.refresh());
        await settle();

        expect(c.state.data?.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2", "user-3-v2"]);
        expect(queryFn.mock.calls.map((call) => call[0])).toEqual([
            { userIds: [1, 2] },
            { userIds: [3] },
            { userIds: [1, 2] },
            { userIds: [3] },
        ]);
    });

    it("SKIP keeps the feed idle; fetchNext is ignored until args arrive", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { batch, queryFn } = createBatchSetup();

            const c = setup(batch.useInfiniteResource, SKIP);
            expect(c.state.isIdle).toBe(true);
            expect(c.state.pages).toHaveLength(0);

            act(() => c.state.fetchNext([1]));
            expect(c.state.pages).toHaveLength(0);
            expect(queryFn).not.toHaveBeenCalled();
            expect(warnSpy).toHaveBeenCalledTimes(1);

            c.rerender([1, 2]);
            await settle();

            expect(c.state.isIdle).toBe(false);
            expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("changing initialArgs resets the feed to the new first page", async () => {
        const { batch } = createBatchSetup();

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await settle();
        act(() => c.state.fetchNext([3]));
        await settle();
        expect(c.state.pages).toHaveLength(2);

        c.rerender([10, 11]);
        await settle();

        expect(c.state.pages).toHaveLength(1);
        expect(c.state.data?.map((user) => user.id)).toEqual([10, 11]);
    });

    it("item updates from an overlapping set propagate into loaded pages", async () => {
        let currentVersion = "v1";
        const { batch } = createBatchSetup({ version: () => currentVersion });

        const c = setup(batch.useInfiniteResource, [1, 2]);
        await settle();
        expect(c.state.data?.map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);

        // A separate id-set overlapping the page refreshes outside the hook.
        await act(async () => {
            await batch.fetch([1, 50]);
        });
        currentVersion = "v2";
        await act(async () => {
            batch.refresh([1, 50]);
            await batch.fetch([1, 50]);
        });
        await settle();

        // The page re-emitted through the batch's live projection.
        expect(c.state.data?.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v1"]);
    });
});
