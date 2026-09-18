import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { outsideAct, sleep, withSlowSiblings } from "@/__tests__/helpers/concurrent-react";
import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TSuspenseResourceState } from "@/query/types";

import { flushMicrotasks } from "../../__tests__/helpers/async-helpers";

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
type TArgs = { id: number };

/**
 * A resource whose every query hangs until the test settles it: `calls[n]` is
 * the n-th `queryFn` invocation, in call order.
 */
function createControlled(options?: { placeholderData?: (args: TArgs) => { data: TUser } | null }) {
    const calls: Deferred<TUser>[] = [];
    const api = createApi({ plugins: [reactHooksPlugin()] });
    const resource = api.createResource<TArgs, TUser>({
        queryFn: () => {
            const d = defer<TUser>();
            calls.push(d);
            return d.promise;
        },
        placeholderData: options?.placeholderData,
    });
    return { api, resource, calls };
}

/** Settle the n-th query and let every derived signal / render flush. */
async function settleCall(calls: Deferred<TUser>[], index: number, outcome: TUser | Error): Promise<void> {
    await act(async () => {
        if (outcome instanceof Error) {
            calls[index]!.reject(outcome);
        } else {
            calls[index]!.resolve(outcome);
        }
        await flushMicrotasks();
        await flushMicrotasks();
    });
}

/** Minimal Error Boundary that renders a fallback element once it catches. */
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

function suspenseFallback(testId: string) {
    return h("span", { "data-testid": testId }, "loading");
}

/** Error Boundary → Suspense → children, so both escape hatches are observable. */
function shell(children: React.ReactNode) {
    return h(
        ErrorBoundary,
        { fallback: h("span", { "data-testid": "boundary" }, "boom") },
        h(React.Suspense, { fallback: suspenseFallback("fallback") }, children),
    );
}

/** Neither escape hatch fired: the hook returned a state. */
function expectRendered(): void {
    expect(screen.queryByTestId("fallback")).toBeNull();
    expect(screen.queryByTestId("boundary")).toBeNull();
}

afterEach(() => {
    vi.restoreAllMocks();
});

// ==================== Tests ====================

describe("useSuspenseResource", () => {
    it("shows the Suspense fallback while loading, then renders data", async () => {
        const d = defer<{ name: string }>();
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<{ id: number }, { name: string }>({
            queryFn: () => d.promise,
        });

        function View() {
            const { data } = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, data.name);
        }

        render(h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)));

        expect(screen.getByTestId("fallback")).toBeTruthy();
        expect(screen.queryByTestId("name")).toBeNull();

        await act(async () => {
            d.resolve({ name: "Ada" });
            await flushMicrotasks();
        });

        expect(await screen.findByTestId("name")).toHaveProperty("textContent", "Ada");
        expect(screen.queryByTestId("fallback")).toBeNull();
    });

    it("throws to the nearest Error Boundary on an initial error", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});

        const d = defer<{ name: string }>();
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<{ id: number }, { name: string }>({
            queryFn: () => d.promise,
        });

        function View() {
            const { data } = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, data.name);
        }

        render(
            h(
                ErrorBoundary,
                { fallback: h("span", { "data-testid": "boundary" }, "boom") },
                h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)),
            ),
        );

        expect(screen.getByTestId("fallback")).toBeTruthy();

        await act(async () => {
            d.reject(new Error("nope"));
            await flushMicrotasks();
        });

        expect(await screen.findByTestId("boundary")).toBeTruthy();
    });

    it("renders synchronously without a fallback when the entry is already cached", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<{ id: number }, { name: string }>({
            queryFn: async () => ({ name: "cached" }),
        });

        // Warm the cache before the component mounts.
        resource.trigger({ id: 7 });
        await flushMicrotasks();
        await flushMicrotasks();

        function View() {
            const { data } = resource.useSuspenseResource({ id: 7 });
            return h("span", { "data-testid": "name" }, data.name);
        }

        await act(async () => {
            render(h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)));
        });

        expect(screen.queryByTestId("fallback")).toBeNull();
        expect(screen.getByTestId("name").textContent).toBe("cached");
    });

    it("settles an args change made inside startTransition without a render loop", async () => {
        const d = defer<{ name: string }>();
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<{ id: number }, { name: string }>({
            queryFn: ({ id }) => (id === 1 ? Promise.resolve({ name: "Ada" }) : d.promise),
        });

        let setId!: (id: number) => void;
        let renders = 0;

        function View({ id }: { id: number }) {
            renders++;
            const { data } = resource.useSuspenseResource({ id });
            return h("span", { "data-testid": "name" }, data.name);
        }

        function App() {
            const [id, set] = React.useState(1);
            setId = set;
            return h(React.Suspense, { fallback: suspenseFallback("fallback") }, withSlowSiblings(h(View, { id }), id));
        }

        render(h(App));
        expect(await screen.findByTestId("name")).toHaveProperty("textContent", "Ada");

        await outsideAct(async () => {
            renders = 0;
            React.startTransition(() => setId(2));
            await sleep(100);

            // Stale data stays on screen while the new args load (SWR).
            expect(screen.getByTestId("name").textContent).toBe("Ada");
            expect(screen.queryByTestId("fallback")).toBeNull();

            d.resolve({ name: "Grace" });
            await sleep(200);
        });

        expect(screen.getByTestId("name").textContent).toBe("Grace");
        // A render-phase mutation of a shared clutch makes this ping-pong between
        // the transition lane (id=2) and the committed tree (id=1) instead.
        expect(renders).toBeLessThanOrEqual(4);

        await act(async () => {});
    });
});

// ==================== The three-step order over the state matrix ====================

describe("useSuspenseResource — matrix order (hasData → error → suspend)", () => {
    it("row 2: suspends while the initial load has nothing to show", () => {
        const { resource } = createControlled();

        function View() {
            const state = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, state.data.name);
        }

        render(shell(h(View)));

        expect(screen.getByTestId("fallback")).toBeTruthy();
        expect(screen.queryByTestId("boundary")).toBeNull();
    });

    it("row 7: throws the error when the load failed with nothing to show", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { resource, calls } = createControlled();

        function View() {
            const state = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, state.data.name);
        }

        render(shell(h(View)));
        await settleCall(calls, 0, new Error("boom"));

        expect(screen.getByTestId("boundary")).toBeTruthy();
    });

    it("row 10: keeps suspending while a retry with nothing to show is in flight", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { resource, calls } = createControlled();

        // Drive the shared cache entry into row 7 and then into row 10 from
        // outside React: once the hook throws, its own clutch is gone.
        const outside = resource.createClutch();
        outside.switch({ id: 1 }, { markPending: true });
        outside.start();
        await settleCall(calls, 0, new Error("first"));
        await act(async () => {
            outside.retry();
            await flushMicrotasks();
        });
        expect(outside.state$.peek().status).toBe("pending");
        expect(outside.state$.peek().hasError).toBe(true);
        expect(outside.state$.peek().hasData).toBe(false);

        function View() {
            const state = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, state.data.name);
        }

        render(shell(h(View)));

        // `status` is `pending`, not `error` — step 2 does not fire, step 3 does.
        expect(screen.getByTestId("fallback")).toBeTruthy();
        expect(screen.queryByTestId("boundary")).toBeNull();

        // Once the retry fails the state is row 7 again — now it throws.
        await settleCall(calls, 1, new Error("second"));
        expect(screen.getByTestId("boundary")).toBeTruthy();
    });

    it("rows 5, 6, 9 and 12: data of the current args is always returned, never suspended on", async () => {
        const { resource, calls } = createControlled();
        let seen!: TSuspenseResourceState<TArgs, TUser>;

        function View() {
            const state = resource.useSuspenseResource({ id: 1 });
            seen = state;
            // Compile-time proof of the narrowed return type.
            const source: "placeholder" | "previous" | "current" = state.dataSource;
            return h("span", { "data-testid": "name" }, `${state.data.name}:${source}`);
        }

        render(shell(h(View)));
        await settleCall(calls, 0, { id: 1, name: "Ada" });

        // Row 5 — success.
        expectRendered();
        expect(seen.status).toBe("success");
        expect(seen.dataSource).toBe("current");
        expect(seen.hasData).toBe(true);
        expect(seen.hasError).toBe(false);

        // Row 6 — a background invalidation never suspends.
        await act(async () => {
            seen.invalidate();
            await flushMicrotasks();
        });
        expectRendered();
        expect(seen.status).toBe("pending");
        expect(seen.dataSource).toBe("current");
        expect(seen.isInvalidating).toBe(true);
        expect(screen.getByTestId("name").textContent).toBe("Ada:current");

        // Row 9 — the invalidation failed; stale data stays on screen.
        await settleCall(calls, 1, new Error("stale"));
        expectRendered();
        expect(seen.status).toBe("error");
        expect(seen.dataSource).toBe("current");
        expect(seen.hasError).toBe(true);
        expect(seen.data.name).toBe("Ada");

        // Row 12 — the retry of row 9 is in flight, still nothing to suspend on.
        await act(async () => {
            seen.retry();
            await flushMicrotasks();
        });
        expectRendered();
        expect(seen.status).toBe("pending");
        expect(seen.dataSource).toBe("current");
        expect(seen.hasError).toBe(true);
        expect(seen.isInvalidating).toBe(true);

        await settleCall(calls, 2, { id: 1, name: "Grace" });
        expect(screen.getByTestId("name").textContent).toBe("Grace:current");
    });

    it("rows 4 and 8: previous data keeps rendering, and its error is returned rather than thrown", async () => {
        const { resource, calls } = createControlled();
        let seen!: TSuspenseResourceState<TArgs, TUser>;

        function View({ id }: { id: number }) {
            const state = resource.useSuspenseResource({ id });
            seen = state;
            return h("span", { "data-testid": "name" }, state.data.name);
        }

        const view = render(shell(h(View, { id: 1 })));
        await settleCall(calls, 0, { id: 1, name: "Ada" });
        expect(screen.getByTestId("name").textContent).toBe("Ada");

        // Row 4 — new args, the previous args' data stays on screen.
        view.rerender(shell(h(View, { id: 2 })));
        expectRendered();
        expect(seen.status).toBe("pending");
        expect(seen.dataSource).toBe("previous");
        expect(seen.isSwitching).toBe(true);
        expect(seen.args).toEqual({ id: 2 });
        expect(seen.dataArgs).toEqual({ id: 1 });
        expect(screen.getByTestId("name").textContent).toBe("Ada");

        // Row 8 — the new args failed: returned, not thrown.
        await settleCall(calls, 1, new Error("nope"));
        expectRendered();
        expect(seen.status).toBe("error");
        expect(seen.dataSource).toBe("previous");
        expect(seen.hasError).toBe(true);
        expect(screen.getByTestId("name").textContent).toBe("Ada");
    });

    it("rows 3 and 13: placeholder data renders at once, and its error is returned rather than thrown", async () => {
        const { resource, calls } = createControlled({
            placeholderData: ({ id }) => ({ data: { id, name: "skeleton" } }),
        });
        let seen!: TSuspenseResourceState<TArgs, TUser>;

        function View() {
            const state = resource.useSuspenseResource({ id: 1 });
            seen = state;
            return h("span", { "data-testid": "name" }, state.data.name);
        }

        render(shell(h(View)));

        // Row 3 — a placeholder is enough to render; no fallback at all.
        expectRendered();
        expect(seen.status).toBe("pending");
        expect(seen.dataSource).toBe("placeholder");
        expect(seen.isInitialLoading).toBe(true);
        expect(screen.getByTestId("name").textContent).toBe("skeleton");

        // Row 13 — the query failed behind the placeholder: returned, not thrown.
        await settleCall(calls, 0, new Error("nope"));
        expectRendered();
        expect(seen.status).toBe("error");
        expect(seen.dataSource).toBe("placeholder");
        expect(seen.hasError).toBe(true);
        expect(screen.getByTestId("name").textContent).toBe("skeleton");
    });

    it("never returns a state without data: dataSource is placeholder, previous or current", async () => {
        const { resource, calls } = createControlled();
        const sources: string[] = [];

        function View({ id }: { id: number }) {
            const state = resource.useSuspenseResource({ id });
            sources.push(state.dataSource);
            return h("span", { "data-testid": "name" }, state.data.name);
        }

        const view = render(shell(h(View, { id: 1 })));
        await settleCall(calls, 0, { id: 1, name: "Ada" });
        view.rerender(shell(h(View, { id: 2 })));
        await settleCall(calls, 1, { id: 2, name: "Grace" });

        expect(sources.length).toBeGreaterThan(0);
        for (const source of sources) {
            expect(["placeholder", "previous", "current"]).toContain(source);
        }
    });
});

describe("ResourceClutch.whenSettled", () => {
    it("resolves once data becomes available and is reusable afterwards", async () => {
        const d = defer<number>();
        const api = createApi();
        const resource = api.createResource<void, number>({ queryFn: () => d.promise });

        const clutch = resource.createClutch();
        clutch.switch(undefined, { markPending: true });
        clutch.start();

        let settled = false;
        void clutch.whenSettled().then(() => {
            settled = true;
        });

        await flushMicrotasks();
        expect(settled).toBe(false);

        d.resolve(42);
        await flushMicrotasks();
        await flushMicrotasks();

        expect(settled).toBe(true);
        // Already settled → resolves immediately on subsequent calls.
        await expect(clutch.whenSettled()).resolves.toBeUndefined();
    });

    it("resolves (does not reject) when the query fails", async () => {
        const d = defer<number>();
        const api = createApi();
        const resource = api.createResource<void, number>({ queryFn: () => d.promise });

        const clutch = resource.createClutch();
        clutch.switch(undefined, { markPending: true });
        clutch.start();

        const settled = clutch.whenSettled();

        d.reject(new Error("boom"));
        await flushMicrotasks();
        await flushMicrotasks();

        await expect(settled).resolves.toBeUndefined();
    });
});
