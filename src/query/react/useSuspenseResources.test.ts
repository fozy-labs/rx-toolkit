import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { outsideAct, sleep } from "@/__tests__/helpers/concurrent-react";
import { createApi } from "@/query/api/createApi";
import { SKIP } from "@/query/constants";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import { useResource, useSuspenseResource } from "@/react";

import { flushMicrotasks } from "../../__tests__/helpers/async-helpers";

import { useSuspenseResources } from "./useSuspenseResources";

// ==================== Helpers ====================

interface Deferred<T> {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (error: unknown) => void;
}

function defer<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

const h = React.createElement;

type TUser = { id: number; name: string };
type TStats = { posts: number };

function controlled<TData>(api: ReturnType<typeof createApi>) {
    const calls: { id: number; deferred: Deferred<TData> }[] = [];
    const resource = api.createResource<{ id: number }, TData>({
        queryFn: ({ id }) => {
            const deferred = defer<TData>();
            calls.push({ id, deferred });
            return deferred.promise;
        },
    });
    const last = (id: number) => [...calls].reverse().find((call) => call.id === id)!.deferred;
    return { resource, calls, last };
}

function setup() {
    const api = createApi({ plugins: [reactHooksPlugin()] });
    return { api, users: controlled<TUser>(api), stats: controlled<TStats>(api) };
}

/** Let the queries a suspended render starts in a microtask begin, settle, and re-render. */
async function flush(fn?: () => void): Promise<void> {
    await act(async () => {
        await flushMicrotasks();
        fn?.();
        await flushMicrotasks();
        await flushMicrotasks();
    });
}

class ErrorBoundary extends React.Component<
    { fallback: React.ReactNode; children?: React.ReactNode },
    { error: unknown }
> {
    state: { error: unknown } = { error: null };

    static getDerivedStateFromError(error: unknown) {
        return { error };
    }

    render() {
        return this.state.error != null ? this.props.fallback : this.props.children;
    }
}

function shell(children: React.ReactNode) {
    return h(
        ErrorBoundary,
        { fallback: h("span", { "data-testid": "boundary" }, "boom") },
        h(React.Suspense, { fallback: h("span", { "data-testid": "fallback" }, "loading") }, children),
    );
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ==================== Tests ====================

describe("useSuspenseResources", () => {
    it("starts every slot in the same suspended render, then renders all data", async () => {
        const { users, stats } = setup();
        function Card() {
            const { data } = useSuspenseResources({
                user: users.resource.bind({ id: 1 }),
                stats: stats.resource.bind({ id: 1 }),
            });
            return h("span", { "data-testid": "card" }, `${data.user.name}:${data.stats.posts}`);
        }

        render(shell(h(Card)));
        await flush();

        expect(screen.getByTestId("fallback")).toBeTruthy();
        expect(users.calls).toHaveLength(1);
        expect(stats.calls).toHaveLength(1);

        await flush(() => users.last(1).resolve({ id: 1, name: "Ada" }));
        expect(screen.getByTestId("fallback")).toBeTruthy();

        await flush(() => stats.last(1).resolve({ posts: 3 }));
        expect(screen.getByTestId("card").textContent).toBe("Ada:3");
    });

    it("unlike sequential useSuspenseResource calls, which waterfall", async () => {
        const { users, stats } = setup();
        function Card() {
            useSuspenseResource(users.resource, { id: 1 });
            useSuspenseResource(stats.resource, { id: 1 });
            return h("span", { "data-testid": "card" }, "ok");
        }

        render(shell(h(Card)));
        await flush();

        expect(users.calls).toHaveLength(1);
        expect(stats.calls).toHaveLength(0);
    });

    it("maps an array in order", async () => {
        const { users } = setup();
        function Rows() {
            const { data } = useSuspenseResources([1, 2].map((id) => users.resource.bind({ id })));
            return h("span", { "data-testid": "rows" }, data.map((user) => user.name).join(","));
        }

        render(shell(h(Rows)));
        await flush();
        expect(users.calls).toHaveLength(2);

        await flush(() => {
            users.last(2).resolve({ id: 2, name: "b" });
            users.last(1).resolve({ id: 1, name: "a" });
        });
        expect(screen.getByTestId("rows").textContent).toBe("a,b");
    });

    it("renders an empty input at once", () => {
        function Empty() {
            const state = useSuspenseResources([]);
            return h("span", { "data-testid": "empty" }, `${state.status}:${state.data.length}`);
        }

        render(shell(h(Empty)));

        expect(screen.getByTestId("empty").textContent).toBe("success:0");
    });

    it("throws the first failure in slot order to the Error Boundary, without waiting for the rest", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { users, stats } = setup();
        const thrown: unknown[] = [];
        class Catch extends ErrorBoundary {
            static getDerivedStateFromError(error: unknown) {
                thrown.push(error);
                return { error };
            }
        }
        function Card() {
            useSuspenseResources({ user: users.resource.bind({ id: 1 }), stats: stats.resource.bind({ id: 1 }) });
            return h("span", { "data-testid": "card" }, "ok");
        }

        render(
            h(
                Catch,
                { fallback: h("span", { "data-testid": "boundary" }, "boom") },
                h(React.Suspense, { fallback: h("span", { "data-testid": "fallback" }, "loading") }, h(Card)),
            ),
        );
        await flush();

        const failure = new Error("stats down");
        await flush(() => stats.last(1).reject(failure));

        expect(screen.getByTestId("boundary")).toBeTruthy();
        expect(thrown[0]).toBe(failure);
    });

    it("the remount after the boundary re-queries the failed slot, not the settled one", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const api = createApi({ plugins: [reactHooksPlugin()] });
        let fail = true;
        const userFn = vi.fn(async ({ id }: { id: number }) => ({ id, name: "Ada" }));
        const statsFn = vi.fn(async () => {
            await sleep(5);
            if (fail) throw new Error("down");
            return { posts: 7 };
        });
        const user = api.createResource<{ id: number }, TUser>({ queryFn: userFn });
        const stats = api.createResource<{ id: number }, TStats>({ queryFn: statsFn });
        function Card() {
            const { data } = useSuspenseResources({ user: user.bind({ id: 1 }), stats: stats.bind({ id: 1 }) });
            return h("span", { "data-testid": "card" }, `${data.user.name}:${data.stats.posts}`);
        }
        // Keeps the user entry held across the boundary's reset.
        function Keep() {
            useResource(user, { id: 1 });
            return null;
        }
        const tree = (attempt: number) => h(React.Fragment, null, h(Keep), h("div", { key: attempt }, shell(h(Card))));

        await outsideAct(async () => {
            const view = render(tree(0));
            await sleep(800);
            expect(screen.getByTestId("boundary")).toBeTruthy();

            fail = false;
            view.rerender(tree(1));
            await sleep(800);
        });

        expect(screen.getByTestId("card").textContent).toBe("Ada:7");
        expect(userFn).toHaveBeenCalledTimes(1);
        expect(statsFn).toHaveBeenCalledTimes(2);
    });

    it("does not re-suspend on a background invalidation", async () => {
        const { users, stats } = setup();
        let invalidate!: () => void;
        function Card() {
            const state = useSuspenseResources({
                user: users.resource.bind({ id: 1 }),
                stats: stats.resource.bind({ id: 1 }),
            });
            invalidate = state.invalidate;
            return h("span", { "data-testid": "card" }, `${state.status}:${state.isInvalidating}`);
        }

        render(shell(h(Card)));
        await flush();
        await flush(() => {
            users.last(1).resolve({ id: 1, name: "Ada" });
            stats.last(1).resolve({ posts: 3 });
        });
        expect(screen.getByTestId("card").textContent).toBe("success:false");

        act(() => invalidate());

        expect(screen.queryByTestId("fallback")).toBeNull();
        expect(screen.getByTestId("card").textContent).toBe("pending:true");
    });

    it("throws a TypeError on a SKIP slot", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { users } = setup();
        function Card() {
            useSuspenseResources({ user: users.resource.bind({ id: 1 }), off: SKIP } as never);
            return null;
        }

        expect(() => render(h(Card))).toThrow(/slot "off" is SKIP/);
    });
});

// ==================== Retention across a suspension ====================

describe("useSuspenseResources — a short retentionTime", () => {
    // A slot that settles more than 5 s (a single clutch's settle keep) before
    // the slowest one: the aggregate wait must hold it until the whole set
    // settles, or the retried render finds it evicted and suspends again.
    it("keeps a fast slot until the slowest one settles: every slot is loaded once", { timeout: 15_000 }, async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const fastFn = vi.fn(async ({ id }: { id: number }) => ({ id, name: `user-${id}` }));
        const slowFn = vi.fn(async () => {
            await sleep(5_500);
            return { posts: 1 };
        });
        const fast = api.createResource<{ id: number }, TUser>({ queryFn: fastFn, retentionTime: 0 });
        const slow = api.createResource<{ id: number }, TStats>({ queryFn: slowFn, retentionTime: 0 });
        function Card() {
            const { data } = useSuspenseResources({ user: fast.bind({ id: 1 }), stats: slow.bind({ id: 1 }) });
            return h("span", { "data-testid": "card" }, `${data.user.name}:${data.stats.posts}`);
        }

        await outsideAct(async () => {
            render(shell(h(Card)));
            await sleep(6_300);
        });

        expect(screen.getByTestId("card").textContent).toBe("user-1:1");
        expect(fastFn).toHaveBeenCalledTimes(1);
        expect(slowFn).toHaveBeenCalledTimes(1);
    });

    for (const retentionTime of [0, 50]) {
        it(`retentionTime ${retentionTime}: the data the suspension waited for renders, loaded once`, async () => {
            const api = createApi({ plugins: [reactHooksPlugin()] });
            const queryFn = vi.fn(async ({ id }: { id: number }) => {
                await sleep(5 * id);
                return { id, name: `user-${id}` };
            });
            const resource = api.createResource<{ id: number }, TUser>({ queryFn, retentionTime });
            function Rows() {
                const { data } = useSuspenseResources([1, 4].map((id) => resource.bind({ id })));
                return h("span", { "data-testid": "rows" }, data.map((user) => user.name).join(","));
            }

            await outsideAct(async () => {
                render(shell(h(Rows)));
                await sleep(800);
            });

            expect(screen.getByTestId("rows").textContent).toBe("user-1,user-4");
            expect(queryFn).toHaveBeenCalledTimes(2);
        });
    }
});
