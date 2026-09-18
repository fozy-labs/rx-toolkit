import { act, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { outsideAct, sleep, withSlowSiblings } from "@/__tests__/helpers/concurrent-react";
import { createApi } from "@/query/api/createApi";
import { SKIP } from "@/query/constants";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import { useInfiniteResource } from "@/query/react/useInfiniteResource";
import type { TInfiniteResourceState } from "@/query/types";

const h = React.createElement;

// ==================== Helpers ====================

type TUser = { id: number; name: string };
type TBatchQueryArgs = { userIds: number[] };

function createProjectionSetup(options?: {
    version?: () => string;
    failOn?: (ids: number[]) => boolean;
    errorFor?: (ids: number[]) => Error | null;
}) {
    const api = createApi({ plugins: [reactHooksPlugin()] });
    const version = options?.version ?? (() => "v1");
    const queryFn = vi.fn(async (args: TBatchQueryArgs): Promise<TUser[]> => {
        const error = options?.errorFor?.(args.userIds) ?? null;
        if (error !== null) {
            throw error;
        }
        if (options?.failOn?.(args.userIds)) {
            throw new Error("network down");
        }
        return args.userIds.map((id) => ({ id, name: `user-${id}-${version()}` }));
    });
    const userResource = api.createResource({ queryFn });
    const projection = api.unstable_createProjectionResource({
        resource: userResource,
        key: "users-projection",
        parseData: (data) => data.map((item) => ({ id: item.id, item })),
        makeArgs: (ids) => ({ userIds: ids }),
        retentionTime: false,
    });
    return { api, queryFn, projection };
}

interface DeferredCall {
    args: TBatchQueryArgs;
    resolve: (users: TUser[]) => void;
    reject: (error: unknown) => void;
}

/** The same projection, but every batch query hangs until the test settles it. */
function createDeferredSetup() {
    const api = createApi({ plugins: [reactHooksPlugin()] });
    const calls: DeferredCall[] = [];
    const queryFn = vi.fn(
        (args: TBatchQueryArgs) =>
            new Promise<TUser[]>((resolve, reject) => {
                calls.push({ args, resolve, reject });
            }),
    );
    const userResource = api.createResource({ queryFn });
    const projection = api.unstable_createProjectionResource({
        resource: userResource,
        parseData: (data) => data.map((item) => ({ id: item.id, item })),
        makeArgs: (ids) => ({ userIds: ids }),
        retentionTime: false,
    });
    return { api, queryFn, projection, calls };
}

function users(ids: number[], suffix = ""): TUser[] {
    return ids.map((id) => ({ id, name: `user-${id}${suffix}` }));
}

interface Captured {
    state: TInfiniteResourceState<number[], TUser[], unknown>;
    rerender: (args: number[] | typeof SKIP) => void;
}

/** Render a probe component around useInfiniteResource and expose the live state. */
function setup(
    useInfiniteResourceHook: (
        initialArgs: number[] | typeof SKIP,
    ) => TInfiniteResourceState<number[], TUser[], unknown>,
    initialArgs: number[] | typeof SKIP,
): Captured {
    const captured = {} as Captured;

    function Probe({ args }: { args: number[] | typeof SKIP }) {
        captured.state = useInfiniteResourceHook(args);
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

/** Resolve / reject a hanging batch query and flush everything it wakes up. */
async function settleCall(call: DeferredCall, outcome: TUser[] | Error): Promise<void> {
    await act(async () => {
        if (outcome instanceof Error) {
            call.reject(outcome);
        } else {
            call.resolve(outcome);
        }
        await flushMicrotasks();
        await flushMicrotasks();
    });
}

// ==================== Tests ====================

describe("useInfiniteResource", () => {
    it("loads the initial page and exposes its items as data", async () => {
        const { projection } = createProjectionSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        expect(c.state.isInitialLoading).toBe(true);
        expect(c.state.data).toBeNull();
        expect(c.state.pages).toHaveLength(1);

        await settle();

        expect(c.state.isInitialLoading).toBe(false);
        expect(c.state.isPending).toBe(false);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);
    });

    it("fetchNext appends a page and flattens data in page order", async () => {
        const { projection, queryFn, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settleCall(calls[0], users([1, 2]));
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);

        await act(async () => {
            c.state.fetchNext([3, 4]);
            await flushMicrotasks();
        });
        expect(c.state.pages).toHaveLength(2);
        expect(c.state.isLoadingNext).toBe(true);
        // Loaded data stays visible while the tail loads.
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);

        await settleCall(calls[1], users([3, 4]));

        expect(c.state.isLoadingNext).toBe(false);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2, 3, 4]);
        expect(queryFn.mock.calls.map((call) => call[0])).toEqual([{ userIds: [1, 2] }, { userIds: [3, 4] }]);
    });

    it("pages share the projection item cache — only missing ids reach the network", async () => {
        const { projection, queryFn } = createProjectionSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();

        act(() => c.state.fetchNext([2, 3]));
        await settle();

        // Id 2 came from the item cache; the same instance is shared.
        expect(queryFn.mock.calls.map((call) => call[0])).toEqual([{ userIds: [1, 2] }, { userIds: [3] }]);
        expect(c.state.data?.[1]).toBe(c.state.data?.[2]);
    });

    it("fetchNext with the args of an existing page is a no-op", async () => {
        const { projection, queryFn } = createProjectionSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();

        act(() => c.state.fetchNext([1, 2]));
        await settle();

        expect(c.state.pages).toHaveLength(1);
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("a failed next page surfaces the error, keeps loaded data, and fetchNext retries it", async () => {
        let shouldFail = true;
        const { projection } = createProjectionSetup({ failOn: (ids) => shouldFail && ids.includes(3) });

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();

        act(() => c.state.fetchNext([3]));
        await settle();

        expect(c.state.hasError).toBe(true);
        expect(c.state.error).toBeInstanceOf(Error);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);

        shouldFail = false;
        act(() => c.state.fetchNext([3]));
        await settle();

        expect(c.state.hasError).toBe(false);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2, 3]);
        expect(c.state.pages).toHaveLength(2);
    });

    it("reset() drops every page after the first", async () => {
        const { projection } = createProjectionSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();
        act(() => c.state.fetchNext([3, 4]));
        await settle();

        act(() => c.state.reset());
        await settle();

        expect(c.state.pages).toHaveLength(1);
        expect(c.state.data?.map((user) => user.id)).toEqual([1, 2]);
    });

    it("invalidate() re-validates every loaded page", async () => {
        let currentVersion = "v1";
        const { projection, queryFn } = createProjectionSetup({ version: () => currentVersion });

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();
        act(() => c.state.fetchNext([3]));
        await settle();

        currentVersion = "v2";
        act(() => c.state.invalidate());
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
            const { projection, queryFn } = createProjectionSetup();

            const c = setup(projection.useInfiniteResource, SKIP);
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
        const { projection } = createProjectionSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();
        act(() => c.state.fetchNext([3]));
        await settle();
        expect(c.state.pages).toHaveLength(2);

        c.rerender([10, 11]);
        await settle();

        expect(c.state.pages).toHaveLength(1);
        expect(c.state.data?.map((user) => user.id)).toEqual([10, 11]);
    });

    it("keeps the data array identity across a success -> invalidating flip (page data refs unchanged)", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settleCall(calls[0], users([1, 2]));
        act(() => c.state.fetchNext([3, 4]));
        await settleCall(calls[1], users([3, 4]));

        const dataBefore = c.state.data;
        const pagesBefore = c.state.pages;
        expect(dataBefore?.map((user) => user.id)).toEqual([1, 2, 3, 4]);

        // Kick off an invalidation; the queries stay in flight (deferred), so every
        // page flips success -> pending while reusing its data by reference.
        await act(async () => {
            c.state.invalidate();
            await flushMicrotasks();
        });

        expect(c.state.pages).not.toBe(pagesBefore); // a new emission happened
        expect(c.state.pages.map((page) => page.status)).toEqual(["pending", "pending"]);
        expect(c.state.pages.map((page) => page.dataSource)).toEqual(["current", "current"]);
        expect(c.state.isInvalidating).toBe(true);
        // Pure status flip, no data change — the flattened array keeps identity.
        expect(c.state.data).toBe(dataBefore);

        await act(async () => {
            calls[2].resolve(users([1, 2], "-v2"));
            calls[3].resolve(users([3, 4], "-v2"));
            await flushMicrotasks();
        });

        // Data actually changed — the identity must change too.
        expect(c.state.data).not.toBe(dataBefore);
        expect(c.state.data?.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2", "user-3-v2", "user-4-v2"]);
    });

    it("changes the data array identity when any page's data changes", async () => {
        let currentVersion = "v1";
        const { projection } = createProjectionSetup({ version: () => currentVersion });

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();
        act(() => c.state.fetchNext([3]));
        await settle();

        const dataBefore = c.state.data;
        expect(dataBefore?.map((user) => user.id)).toEqual([1, 2, 3]);

        currentVersion = "v2";
        act(() => c.state.invalidate());
        await settle();

        expect(c.state.data).not.toBe(dataBefore);
        expect(c.state.data?.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v2", "user-3-v2"]);
    });

    it("item updates from an overlapping set propagate into loaded pages", async () => {
        let currentVersion = "v1";
        const { projection } = createProjectionSetup({ version: () => currentVersion });

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settle();
        expect(c.state.data?.map((user) => user.name)).toEqual(["user-1-v1", "user-2-v1"]);

        // A separate id-set overlapping the page is invalidated outside the hook.
        await act(async () => {
            await projection.fetch([1, 50]);
        });
        currentVersion = "v2";
        await act(async () => {
            projection.invalidate([1, 50]);
            await projection.fetch([1, 50]);
        });
        await settle();

        // The page re-emitted through the projection's live stream.
        expect(c.state.data?.map((user) => user.name)).toEqual(["user-1-v2", "user-2-v1"]);
    });

    it("settles an initial-args change made inside startTransition without a render loop", async () => {
        const { projection } = createProjectionSetup();

        let setIds!: (ids: number[]) => void;
        let renders = 0;

        function View({ ids }: { ids: number[] }) {
            renders++;
            const state = projection.useInfiniteResource(ids);
            return h("span", { "data-testid": "first" }, String(state.pages[0]?.args?.[0] ?? "none"));
        }

        function App() {
            const [ids, set] = React.useState([1, 2]);
            setIds = set;
            return withSlowSiblings(h(View, { ids }), ids);
        }

        render(h(App));
        await settle();
        expect(screen.getByTestId("first").textContent).toBe("1");

        await outsideAct(async () => {
            renders = 0;
            React.startTransition(() => setIds([3, 4]));
            await sleep(300);
        });

        expect(screen.getByTestId("first").textContent).toBe("3");
        // A render-phase rebuild of a shared page list makes this ping-pong between
        // the transition lane and the committed tree instead.
        expect(renders).toBeLessThanOrEqual(4);

        await act(async () => {});
    });
});

// ==================== Aggregate flags ====================

describe("useInfiniteResource — flags", () => {
    it("isIdle: true only while there is no page at all", async () => {
        const { projection } = createProjectionSetup();

        const c = setup(projection.useInfiniteResource, SKIP);
        expect(c.state.isIdle).toBe(true);
        expect(c.state.isInitialLoading).toBe(false);
        expect(c.state.isPending).toBe(false);
        expect(c.state.isLoadingNext).toBe(false);
        expect(c.state.isInvalidating).toBe(false);
        expect(c.state.hasData).toBe(false);
        expect(c.state.hasError).toBe(false);
        expect(c.state.error).toBeNull();

        c.rerender([1, 2]);
        expect(c.state.isIdle).toBe(false);
        await settle();
        expect(c.state.isIdle).toBe(false);
    });

    it("isInitialLoading: follows the first page only", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        expect(c.state.isInitialLoading).toBe(true);
        expect(c.state.pages[0].isInitialLoading).toBe(true);

        await settleCall(calls[0], users([1, 2]));
        expect(c.state.isInitialLoading).toBe(false);

        // A second page loading does not make the feed "initially loading".
        await act(async () => {
            c.state.fetchNext([3]);
            await flushMicrotasks();
        });
        expect(c.state.pages[1].isInitialLoading).toBe(true);
        expect(c.state.isInitialLoading).toBe(false);
    });

    it("isPending: true while any page has a query in flight", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        expect(c.state.isPending).toBe(true);

        await settleCall(calls[0], users([1, 2]));
        expect(c.state.isPending).toBe(false);

        await act(async () => {
            c.state.fetchNext([3]);
            await flushMicrotasks();
        });
        // Only the tail page is in flight — the aggregate is still pending.
        expect(c.state.pages.map((page) => page.isPending)).toEqual([false, true]);
        expect(c.state.isPending).toBe(true);

        await settleCall(calls[1], users([3]));
        expect(c.state.isPending).toBe(false);
    });

    it("isLoadingNext: only pages beyond the first count", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        // The first page's initial load is not "loading next".
        expect(c.state.isLoadingNext).toBe(false);

        await settleCall(calls[0], users([1, 2]));
        await act(async () => {
            c.state.fetchNext([3]);
            await flushMicrotasks();
        });
        expect(c.state.isLoadingNext).toBe(true);

        await settleCall(calls[1], users([3]));
        expect(c.state.isLoadingNext).toBe(false);
    });

    it("isInvalidating: true while a page is re-queried behind its own data", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        expect(c.state.isInvalidating).toBe(false); // the initial load is not an invalidation

        await settleCall(calls[0], users([1, 2]));
        expect(c.state.isInvalidating).toBe(false);

        await act(async () => {
            c.state.invalidate();
            await flushMicrotasks();
        });
        expect(c.state.isInvalidating).toBe(true);
        expect(c.state.isPending).toBe(true);
        expect(c.state.isLoadingNext).toBe(false);
        expect(c.state.isInitialLoading).toBe(false);

        await settleCall(calls[1], users([1, 2], "-v2"));
        expect(c.state.isInvalidating).toBe(false);
    });

    it("hasData: mirrors data !== null", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        expect(c.state.data).toBeNull();
        expect(c.state.hasData).toBe(false);

        await settleCall(calls[0], users([1, 2]));
        expect(c.state.data).not.toBeNull();
        expect(c.state.hasData).toBe(true);
    });

    it("error: the first error in page order, hasError mirrors it, and it survives a retry", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1]);
        expect(c.state.hasError).toBe(false);
        expect(c.state.error).toBeNull();

        await settleCall(calls[0], new Error("first page down"));
        expect(c.state.hasError).toBe(true);
        expect((c.state.error as Error).message).toBe("first page down");

        // A second, also failing page must not displace the first error.
        await act(async () => {
            c.state.fetchNext([2]);
            await flushMicrotasks();
        });
        await settleCall(calls[1], new Error("second page down"));
        expect((c.state.error as Error).message).toBe("first page down");

        // The retry of the first page is in flight — the error stays readable.
        await act(async () => {
            c.state.fetchNext([1]);
            await flushMicrotasks();
        });
        expect(c.state.isPending).toBe(true);
        expect(c.state.hasError).toBe(true);
        expect((c.state.error as Error).message).toBe("first page down");

        await settleCall(calls[2], users([1]));
        expect((c.state.error as Error).message).toBe("second page down");
    });

    it("isInvalidating and isLoadingNext are both true after invalidating a feed whose last page failed", async () => {
        const { projection, calls } = createDeferredSetup();

        const c = setup(projection.useInfiniteResource, [1, 2]);
        await settleCall(calls[0], users([1, 2]));
        await act(async () => {
            c.state.fetchNext([3]);
            await flushMicrotasks();
        });
        await settleCall(calls[1], new Error("tail down"));

        expect(c.state.pages.map((page) => page.status)).toEqual(["success", "error"]);

        await act(async () => {
            c.state.invalidate();
            await flushMicrotasks();
        });

        // Page 0 re-queries behind its data, page 1 retries with nothing to show:
        // the three loading flags are not a partition of isPending.
        expect(c.state.isPending).toBe(true);
        expect(c.state.isInvalidating).toBe(true);
        expect(c.state.isLoadingNext).toBe(true);
        expect(c.state.isInitialLoading).toBe(false);
    });
});

// ==================== Per-page dispatch and invariants ====================

describe("useInfiniteResource — per-page dispatch", () => {
    it("invalidate() invalidates pages with data, retries failed ones and skips in-flight ones", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { projection, queryFn, calls } = createDeferredSetup();

            const c = setup(projection.useInfiniteResource, [1]);
            await settleCall(calls[0], users([1]));

            // Page 1 fails; page 2 stays in flight.
            await act(async () => {
                c.state.fetchNext([2]);
                await flushMicrotasks();
            });
            await settleCall(calls[1], new Error("page 2 down"));
            await act(async () => {
                c.state.fetchNext([3]);
                await flushMicrotasks();
            });

            expect(c.state.pages.map((page) => page.status)).toEqual(["success", "error", "pending"]);
            expect(queryFn).toHaveBeenCalledTimes(3);

            await act(async () => {
                c.state.invalidate();
                await flushMicrotasks();
            });

            // Page 0 → invalidate(), page 1 → retry(), page 2 → skipped.
            expect(queryFn.mock.calls.map((call) => call[0])).toEqual([
                { userIds: [1] },
                { userIds: [2] },
                { userIds: [3] },
                { userIds: [1] },
                { userIds: [2] },
            ]);
            // Nothing was dispatched along an undrawn edge.
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("invalidate() on an idle feed does nothing and does not warn", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { projection, queryFn } = createProjectionSetup();

            const c = setup(projection.useInfiniteResource, SKIP);
            act(() => c.state.invalidate());

            expect(queryFn).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("fetchNext() on a known page retries it after a failure and is a no-op otherwise", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { projection, queryFn, calls } = createDeferredSetup();

            const c = setup(projection.useInfiniteResource, [1]);
            await settleCall(calls[0], users([1]));

            await act(async () => {
                c.state.fetchNext([2]);
                await flushMicrotasks();
            });
            await settleCall(calls[1], new Error("down"));
            expect(c.state.pages[1].status).toBe("error");

            // Known page, failed → retried, no new page.
            await act(async () => {
                c.state.fetchNext([2]);
                await flushMicrotasks();
            });
            expect(c.state.pages).toHaveLength(2);
            expect(c.state.pages[1].status).toBe("pending");
            expect(queryFn).toHaveBeenCalledTimes(3);

            // Known page, already in flight → no-op.
            await act(async () => {
                c.state.fetchNext([2]);
                await flushMicrotasks();
            });
            expect(queryFn).toHaveBeenCalledTimes(3);
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("fetchNext() also retries a page whose re-query failed behind its data (row 9)", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
            const { projection, queryFn, calls } = createDeferredSetup();

            const c = setup(projection.useInfiniteResource, [1]);
            await settleCall(calls[0], users([1]));

            await act(async () => {
                c.state.fetchNext([2]);
                await flushMicrotasks();
            });
            await settleCall(calls[1], users([2]));

            // Fail an invalidation of the second page: it keeps its data, so the
            // page sits in row 9 — `status: "error"` with `dataSource: "current"`.
            await act(async () => {
                c.state.invalidate();
                await flushMicrotasks();
            });
            await settleCall(calls[2], new Error("down"));
            await settleCall(calls[3], new Error("down"));

            expect(c.state.pages[1].status).toBe("error");
            expect(c.state.pages[1].dataSource).toBe("current");
            expect(c.state.pages[1].hasData).toBe(true);

            const before = queryFn.mock.calls.length;

            await act(async () => {
                c.state.fetchNext([2]);
                await flushMicrotasks();
            });

            // Retried, not ignored, and no page was appended.
            expect(c.state.pages).toHaveLength(2);
            expect(c.state.pages[1].isPending).toBe(true);
            expect(queryFn.mock.calls.length).toBe(before + 1);
            expect(warnSpy).not.toHaveBeenCalled();
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("page invariants: dataSource stays none | current and isSwitching is always false", async () => {
        const { projection, calls } = createDeferredSetup();
        const seen: string[] = [];

        const c = setup(projection.useInfiniteResource, [1, 2]);

        const record = () => {
            for (const page of c.state.pages) {
                seen.push(page.dataSource);
                expect(page.isSwitching).toBe(false);
                expect(["none", "current"]).toContain(page.dataSource);
            }
        };

        record(); // initial load
        await settleCall(calls[0], users([1, 2]));
        record(); // success

        await act(async () => {
            c.state.fetchNext([3]);
            await flushMicrotasks();
        });
        record(); // tail loading
        await settleCall(calls[1], new Error("down"));
        record(); // tail failed

        await act(async () => {
            c.state.invalidate();
            await flushMicrotasks();
        });
        record(); // head invalidating, tail retrying

        expect(seen).toContain("none");
        expect(seen).toContain("current");
    });

    it("data only takes pages holding data of their own args — a placeholder never reaches the feed", async () => {
        // The hook accepts any resource; a plain one with `placeholderData`
        // produces the `dataSource: "placeholder"` page the projection resource
        // cannot (see the page invariants above), which is exactly the case the
        // `current`-only filter in `_flattenData` guards against.
        const api = createApi();
        const calls: Array<{ resolve: (users: TUser[]) => void }> = [];
        const resource = api.createResource<{ page: number }, TUser[]>({
            queryFn: () =>
                new Promise<TUser[]>((resolve) => {
                    calls.push({ resolve });
                }),
            placeholderData: ({ page }) => ({ data: [{ id: 900 + page, name: "ghost" }] }),
        });

        let state!: TInfiniteResourceState<{ page: number }, TUser[], unknown>;
        function Probe() {
            state = useInfiniteResource(resource, { page: 1 });
            return null;
        }
        render(h(Probe));

        // The page itself has something to show, the feed does not: those items
        // belong to no page of the feed.
        expect(state.pages[0].dataSource).toBe("placeholder");
        expect(state.pages[0].hasData).toBe(true);
        expect(state.data).toBeNull();
        expect(state.hasData).toBe(false);

        await act(async () => {
            calls[0].resolve([{ id: 1, name: "real" }]);
            await flushMicrotasks();
            await flushMicrotasks();
        });

        expect(state.pages[0].dataSource).toBe("current");
        expect(state.data?.map((user) => user.name)).toEqual(["real"]);
        expect(state.hasData).toBe(true);
    });
});

// ==================== Deprecated aliases ====================

describe("useInfiniteResource — deprecated aliases", () => {
    it("refresh() forwards to invalidate()", async () => {
        let currentVersion = "v1";
        const { projection, queryFn } = createProjectionSetup({ version: () => currentVersion });

        const c = setup(projection.useInfiniteResource, [1, 2]);
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
});
