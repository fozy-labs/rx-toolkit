import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { outsideAct, sleep, Slow, withSlowSiblings } from "@/__tests__/helpers/concurrent-react";
import {
    COMMIT_TIMEOUT,
    createRenderStream,
    disableActEnvironment,
    expectNoMoreRenders,
} from "@/__tests__/helpers/render-stream";
import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";
import type { TSuspenseResourceState } from "@/query/types";
import { useSignal } from "@/react";
import { Signal } from "@/signals";

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
        // A suspending render starts its query right after itself, in a microtask
        await flushMicrotasks();
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
        resource.getEntry({ id: 7 }, true);
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

    it("does not suspend on an entry marked for revalidation: the first render already shows the re-query", async () => {
        let call = 0;
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<{ id: number }, { name: string }>({
            queryFn: async () => ({ name: `v${++call}` }),
        });

        // Warm the cache, then invalidate with nobody holding the entry.
        await resource.ensure({ id: 7 });
        resource.invalidate({ id: 7 });
        expect(call).toBe(1);
        expect(resource.getEntry({ id: 7 })!.isInvalidated).toBe(true);

        const seen: Array<{ name: string; isInvalidating: boolean }> = [];
        function View() {
            const state = resource.useSuspenseResource({ id: 7 });
            seen.push({ name: state.data.name, isInvalidating: state.isInvalidating });
            return h("span", { "data-testid": "name" }, state.data.name);
        }

        await act(async () => {
            render(h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)));
        });

        // The marked data rendered without a fallback, already as the re-query
        // the subscription starts (row 6), which then delivered fresh data.
        expect(screen.queryByTestId("fallback")).toBeNull();
        expect(seen[0]).toEqual({ name: "v1", isInvalidating: true });
        await act(async () => {
            await flushMicrotasks();
            await flushMicrotasks();
        });
        expect(call).toBe(2);
        expect(seen.some((s) => s.name === "v1" && !s.isInvalidating)).toBe(false);
        expect(screen.getByTestId("name").textContent).toBe("v2");
    });

    it("suspends for the re-query a failed entry owes after invalidate(), instead of throwing the cleared error", async () => {
        const errors: unknown[] = [];
        vi.spyOn(console, "error").mockImplementation((error: unknown) => errors.push(error));
        let fail = true;
        let call = 0;
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<{ id: number }, { name: string }>({
            queryFn: async () => {
                call++;
                if (fail) throw new Error("old failure");
                return { name: "fresh" };
            },
        });

        // A failed entry nobody holds: invalidate() only marks it.
        await resource.ensure({ id: 7 }).catch(() => {});
        fail = false;
        resource.invalidate({ id: 7 });
        expect(resource.getEntry({ id: 7 })!.isInvalidated).toBe(true);

        function View() {
            const { data } = resource.useSuspenseResource({ id: 7 });
            return h("span", { "data-testid": "name" }, data.name);
        }

        render(shell(h(View)));
        expect(screen.getByTestId("fallback")).toBeTruthy();

        await act(async () => {
            await flushMicrotasks();
            await flushMicrotasks();
        });

        expect(call).toBe(2);
        expect(screen.queryByTestId("boundary")).toBeNull();
        expect(screen.getByTestId("name").textContent).toBe("fresh");
        expect(errors).toEqual([]);
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

// ==================== Retention across a suspension ====================

describe("useSuspenseResource — a short retentionTime", () => {
    function setupShortRetention(retentionTime: number) {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const queryFn = vi.fn(async ({ id }: TArgs) => {
            await sleep(5);
            return { id, name: `user-${id}` };
        });
        const resource = api.createResource<TArgs, TUser>({ queryFn, retentionTime });
        function View() {
            const { data } = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, data.name);
        }
        return { resource, queryFn, View };
    }

    // React commits the retry of a suspended render up to ~300 ms after the
    // fallback showed; the wait's hold must last until the committed hook holds.
    for (const retentionTime of [0, 50]) {
        it(`retentionTime ${retentionTime}: the data the suspension waited for renders, loaded once`, async () => {
            const { queryFn, View } = setupShortRetention(retentionTime);

            await outsideAct(async () => {
                render(h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)));
                await sleep(800);
            });

            expect(screen.getByTestId("name").textContent).toBe("user-1");
            expect(queryFn).toHaveBeenCalledTimes(1);
        });
    }

    it("retentionTime 0 under a slow sibling tree: the data renders, loaded once", async () => {
        const { queryFn, View } = setupShortRetention(0);

        await outsideAct(async () => {
            render(
                h(
                    React.Suspense,
                    { fallback: suspenseFallback("fallback") },
                    h(View),
                    ...Array.from({ length: 6 }, (_, i) => h(Slow, { key: i, value: 1 })),
                ),
            );
            await sleep(1500);
        });

        expect(screen.getByTestId("name").textContent).toBe("user-1");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // Anyone may hold the entry for a moment between the settle and the
    // commit; letting go must not cost the render the entry it is about to show.
    const shortHolds = {
        ensure: (resource: ReturnType<typeof setupShortRetention>["resource"]) => resource.ensure({ id: 1 }),
        prefetch: (resource: ReturnType<typeof setupShortRetention>["resource"]) => resource.prefetch({ id: 1 }),
        "entry.hold()": (resource: ReturnType<typeof setupShortRetention>["resource"]) =>
            resource.getEntry({ id: 1 })!.hold()(),
    };
    for (const [name, shortHold] of Object.entries(shortHolds)) {
        it(`retentionTime 0 with a short ${name} before the commit: the data renders, loaded once`, async () => {
            const { resource, queryFn, View } = setupShortRetention(0);

            await outsideAct(async () => {
                render(h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)));
                await sleep(30);
                await shortHold(resource);
                await sleep(800);
            });

            expect(screen.getByTestId("name").textContent).toBe("user-1");
            expect(queryFn).toHaveBeenCalledTimes(1);
        });
    }

    // Nothing commits a failure with nothing to show: the render it wakes
    // throws to the Error Boundary. The entry follows the policy from the settle.
    it("a failure evicted at once by the policy is queried again when the boundary remounts", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        let fail = true;
        const queryFn = vi.fn(async ({ id }: TArgs) => {
            await sleep(5);
            if (fail) throw new Error("boom");
            return { id, name: `user-${id}` };
        });
        const resource = api.createResource<TArgs, TUser>({
            queryFn,
            retentionTime: (_args, state) => (state.hasError ? 0 : 60_000),
        });
        function View() {
            const { data } = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, data.name);
        }
        const tree = (attempt: number) =>
            h(
                ErrorBoundary,
                { key: attempt, fallback: h("span", { "data-testid": "boundary" }, "boom") },
                h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)),
            );

        vi.spyOn(console, "error").mockImplementation(() => {});
        await outsideAct(async () => {
            const { rerender } = render(tree(0));
            await sleep(800);
            expect(screen.getByTestId("boundary")).toBeTruthy();

            fail = false;
            rerender(tree(1));
            await sleep(800);
        });

        expect(screen.getByTestId("name").textContent).toBe("user-1");
        expect(queryFn).toHaveBeenCalledTimes(2);
    });
});

// ==================== A retained failure across an Error Boundary reset ====================

// These tests synchronize on React's commits, not the clock: React 19 throttles
// a commit replacing a freshly shown Suspense fallback to ~300 ms after it, so
// a fixed `sleep(300)` raced it. `takeRender()` waits for the commit itself and
// each assertion runs against that commit's frozen DOM snapshot.
describe("useSuspenseResource — a retained failure across an Error Boundary reset", () => {
    // The default retention keeps a failure: once the boundary shows, nobody
    // holds the entry, but its 60 s are far from over at the reset.
    function setupDefaultRetention(queryFn: (args: TArgs) => Promise<TUser>) {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<TArgs, TUser>({ queryFn });
        function View() {
            const { data } = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, data.name);
        }
        const tree = (attempt: number) =>
            h(
                ErrorBoundary,
                { key: attempt, fallback: h("span", { "data-testid": "boundary" }, "boom") },
                h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)),
            );
        return { resource, tree };
    }

    it("re-queries the retained failure when the boundary remounts, instead of re-throwing it", async () => {
        let fail = true;
        const queryFn = vi.fn(async ({ id }: TArgs) => {
            await sleep(5);
            if (fail) throw new Error("boom");
            return { id, name: `user-${id}` };
        });
        const { resource, tree } = setupDefaultRetention(queryFn);

        vi.spyOn(console, "error").mockImplementation(() => {});
        const actEnv = disableActEnvironment();
        try {
            const stream = createRenderStream({ snapshotDOM: true });
            const utils = await stream.render(tree(0));

            // The initial load suspends; its query starts in the microtask
            // right after the suspending render.
            const initial = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(initial.withinDOM().queryByTestId("fallback")).not.toBeNull();
            expect(initial.withinDOM().queryByTestId("boundary")).toBeNull();
            expect(initial.withinDOM().queryByTestId("name")).toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(1);

            // The retry render throws the failure: the boundary fallback
            // commits (this is the ~300 ms-throttled commit — takeRender
            // simply waits it out).
            const caught = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(caught.withinDOM().queryByTestId("boundary")).not.toBeNull();
            expect(caught.withinDOM().queryByTestId("fallback")).toBeNull();

            // The thrown failure is consumed: the entry is marked for the
            // re-query the remount will owe.
            const entry = resource.getEntry({ id: 1 })!;
            expect(entry.peek().status).toBe("error");
            expect(entry.isInvalidated).toBe(true);

            fail = false;
            await utils.rerender(tree(1));

            // The remount suspends on the owed re-query instead of re-throwing
            // the retained failure: exactly one re-query, started by the
            // remount's hold.
            const requerying = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(requerying.withinDOM().queryByTestId("fallback")).not.toBeNull();
            expect(requerying.withinDOM().queryByTestId("boundary")).toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(2);

            const loaded = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(loaded.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");
            expect(loaded.withinDOM().queryByTestId("fallback")).toBeNull();

            // A mount that shows data commits twice: the first subscription
            // re-derives the clutch state once (the derivation tracks its
            // subscribers), so one same-DOM update follows. Pinned, not
            // load-bearing.
            const echo = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(echo.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");

            expect(stream.totalRenderCount()).toBe(5);
            await expectNoMoreRenders(stream);
            // Re-checked after the quiet window: no late-starting re-query.
            expect(queryFn).toHaveBeenCalledTimes(2);
        } finally {
            actEnv.cleanup();
        }
    });

    it("throws the fresh failure when the re-query after the reset fails again, without looping", async () => {
        let call = 0;
        const queryFn = vi.fn(async ({ id }: TArgs) => {
            await sleep(5);
            throw new Error(`boom-${++call}`);
        });
        const { resource, tree } = setupDefaultRetention(queryFn);

        vi.spyOn(console, "error").mockImplementation(() => {});
        const actEnv = disableActEnvironment();
        try {
            const stream = createRenderStream({ snapshotDOM: true });
            const utils = await stream.render(tree(0));

            const initial = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(initial.withinDOM().queryByTestId("fallback")).not.toBeNull();
            expect(initial.withinDOM().queryByTestId("boundary")).toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(1);

            // The first failure reaches the boundary and is consumed.
            const caught = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(caught.withinDOM().queryByTestId("boundary")).not.toBeNull();
            expect(caught.withinDOM().queryByTestId("fallback")).toBeNull();
            const entry = resource.getEntry({ id: 1 })!;
            expect(entry.peek().status).toBe("error");
            expect((entry.peek().error as Error).message).toBe("boom-1");
            expect(entry.isInvalidated).toBe(true);

            await utils.rerender(tree(1));

            // The remount suspends on the re-query the consumed failure owes —
            // it does not re-throw the retained one.
            const requerying = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(requerying.withinDOM().queryByTestId("fallback")).not.toBeNull();
            expect(requerying.withinDOM().queryByTestId("boundary")).toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(2);

            // The fresh failure reaches the boundary and is consumed too,
            // which is what stops the cycle.
            const caughtAgain = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(caughtAgain.withinDOM().queryByTestId("boundary")).not.toBeNull();
            expect(caughtAgain.withinDOM().queryByTestId("fallback")).toBeNull();
            expect(entry.peek().status).toBe("error");
            expect((entry.peek().error as Error).message).toBe("boom-2");
            expect(entry.isInvalidated).toBe(true);

            // One re-query per reset: no fifth commit within a full throttle
            // window after the last expected commit, and no third query even
            // after it.
            expect(stream.totalRenderCount()).toBe(4);
            await expectNoMoreRenders(stream);
            expect(queryFn).toHaveBeenCalledTimes(2);
        } finally {
            actEnv.cleanup();
        }
    });

    it("a reset that lands while the re-query is already in flight joins it instead of starting a second one", async () => {
        const requery = defer<TUser>();
        let call = 0;
        const queryFn = vi.fn(async ({ id }: TArgs) => {
            call++;
            if (call === 1) {
                await sleep(5);
                throw new Error("boom-1");
            }
            // The re-query settles when the test says so.
            return requery.promise;
        });
        const { resource, tree } = setupDefaultRetention(queryFn);

        vi.spyOn(console, "error").mockImplementation(() => {});
        const actEnv = disableActEnvironment();
        try {
            const stream = createRenderStream({ snapshotDOM: true });
            const utils = await stream.render(tree(0));

            const initial = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(initial.withinDOM().queryByTestId("fallback")).not.toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(1);

            const caught = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(caught.withinDOM().queryByTestId("boundary")).not.toBeNull();

            // The consumed failure owes exactly one re-query; an outside hold
            // starts it while the boundary is still showing.
            const entry = resource.getEntry({ id: 1 })!;
            expect(entry.isInvalidated).toBe(true);
            const release = entry.hold();
            expect(queryFn).toHaveBeenCalledTimes(2);

            // The reset lands with that re-query already in flight: the
            // remount suspends on the same run instead of starting another.
            await utils.rerender(tree(1));
            const requerying = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(requerying.withinDOM().queryByTestId("fallback")).not.toBeNull();
            expect(requerying.withinDOM().queryByTestId("boundary")).toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(2);

            requery.resolve({ id: 1, name: "user-1" });
            const loaded = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(loaded.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");

            // Same-DOM echo of the data mount (the first subscription
            // re-derives the clutch state once) — not a second run.
            const echo = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(echo.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");

            expect(stream.totalRenderCount()).toBe(5);
            await expectNoMoreRenders(stream);
            // Re-checked after the quiet window: the joined run stayed the only one.
            expect(queryFn).toHaveBeenCalledTimes(2);
            release();
        } finally {
            actEnv.cleanup();
        }
    });

    it("the consumed failure leaves no residue: a remount after a successful re-query shows its data without a fallback commit or a new query", async () => {
        let fail = true;
        const queryFn = vi.fn(async ({ id }: TArgs) => {
            await sleep(5);
            if (fail) throw new Error("boom");
            return { id, name: `user-${id}` };
        });
        const { resource, tree } = setupDefaultRetention(queryFn);

        vi.spyOn(console, "error").mockImplementation(() => {});
        const actEnv = disableActEnvironment();
        try {
            const stream = createRenderStream({ snapshotDOM: true });
            const utils = await stream.render(tree(0));

            const initial = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(initial.withinDOM().queryByTestId("fallback")).not.toBeNull();
            expect(queryFn).toHaveBeenCalledTimes(1);

            const caught = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(caught.withinDOM().queryByTestId("boundary")).not.toBeNull();
            expect(resource.getEntry({ id: 1 })!.isInvalidated).toBe(true);

            // The re-query runs and succeeds before the reset: nothing is
            // mounted, so it commits nothing.
            fail = false;
            await resource.ensure({ id: 1 });
            const entry = resource.getEntry({ id: 1 })!;
            expect(entry.peek().status).toBe("success");
            expect(entry.isInvalidated).toBe(false);
            expect(stream.totalRenderCount()).toBe(2);

            // The remount shows the data in its first commit: no fallback
            // commit in between, no re-throw, no new query — the success
            // cleared the mark the boundary throw had left.
            await utils.rerender(tree(1));
            const loaded = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(loaded.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");
            expect(loaded.withinDOM().queryByTestId("fallback")).toBeNull();
            expect(loaded.withinDOM().queryByTestId("boundary")).toBeNull();

            // Same-DOM echo of the data mount (the first subscription
            // re-derives the clutch state once).
            const echo = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(echo.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");

            expect(queryFn).toHaveBeenCalledTimes(2);
            expect(stream.totalRenderCount()).toBe(4);
            await expectNoMoreRenders(stream);
        } finally {
            actEnv.cleanup();
        }
    });
});

// ==================== A pure render ====================

describe("useSuspenseResource — render stays pure", () => {
    it("starts the query outside render: a signal written by queryFn raises no render-phase update", async () => {
        const inFlight = Signal.state(0);
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<TArgs, TUser>({
            queryFn: async ({ id }) => {
                inFlight.set(inFlight.peek() + 1);
                return { id, name: `user-${id}` };
            },
        });
        const consoleError = vi.spyOn(console, "error");

        function Indicator() {
            return h("span", { "data-testid": "in-flight" }, String(useSignal(inFlight)));
        }
        function View() {
            const { data } = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, data.name);
        }
        function App({ show }: { show: boolean }) {
            return h(React.Fragment, null, h(Indicator), show ? shell(h(View)) : null);
        }

        const view = render(h(App, { show: false }));
        await act(async () => {
            view.rerender(h(App, { show: true }));
        });

        expect(await screen.findByTestId("name")).toHaveProperty("textContent", "user-1");
        expect(screen.getByTestId("in-flight").textContent).toBe("1");
        const renderPhaseUpdates = consoleError.mock.calls.filter((args) =>
            String(args[0]).includes("Cannot update a component"),
        );
        expect(renderPhaseUpdates).toEqual([]);
    });

    it("creates no cache entry in a render React discards", async () => {
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<TArgs, TUser>({
            retentionTime: 10,
            queryFn: async ({ id }) => ({ id, name: `user-${id}` }),
            placeholderData: () => ({ data: { id: 0, name: "skeleton" } }),
        });

        function View() {
            resource.useSuspenseResource({ id: 1 });
            return null;
        }
        function Blocker(): React.ReactNode {
            // A sibling suspends forever: the render of View is never committed
            throw new Promise<void>(() => {});
        }

        const view = render(h(React.Suspense, { fallback: null }, h(View), h(Blocker)));
        await act(async () => {
            await flushMicrotasks();
        });
        view.unmount();
        await act(async () => {
            await sleep(50);
        });

        expect(resource.getEntry({ id: 1 })).toBeNull();
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

    // The commit-level companion of rows 6 and 9 above: `act()` flushes
    // intermediate commits, so a transient fallback from a reordered
    // hasData/error/suspend sequence would be invisible there — here every
    // commit is observed.
    it("a background invalidation that fails commits the error over the data — no fallback or boundary commit ever", async () => {
        const requery = defer<TUser>();
        let call = 0;
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<TArgs, TUser>({
            queryFn: async ({ id }) => {
                call++;
                if (call === 1) {
                    await sleep(5);
                    return { id, name: `user-${id}` };
                }
                // The re-query settles when the test says so.
                return requery.promise;
            },
        });

        function View() {
            const { data } = resource.useSuspenseResource({ id: 1 });
            return h("span", { "data-testid": "name" }, data.name);
        }

        const actEnv = disableActEnvironment();
        try {
            const stream = createRenderStream({ snapshotDOM: true });
            await stream.render(shell(h(View)));

            const initial = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(initial.withinDOM().queryByTestId("fallback")).not.toBeNull();

            const loaded = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(loaded.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");
            expect(call).toBe(1);

            // Same-DOM echo of the data mount (the first subscription
            // re-derives the clutch state once); taken before the
            // invalidation so the commits below are exactly row 6 and row 9.
            const echo = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(echo.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");

            // The invalidation re-queries behind the shown data...
            resource.invalidate({ id: 1 });
            const invalidating = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(invalidating.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");
            expect(invalidating.withinDOM().queryByTestId("fallback")).toBeNull();
            expect(call).toBe(2);

            // ...and its failure lands the same way: the data never leaves
            // the screen, no fallback or boundary commit flashes in between.
            requery.reject(new Error("stale"));
            const failed = await stream.takeRender({ timeout: COMMIT_TIMEOUT });
            expect(failed.withinDOM().queryByTestId("name")?.textContent).toBe("user-1");
            expect(failed.withinDOM().queryByTestId("fallback")).toBeNull();
            expect(failed.withinDOM().queryByTestId("boundary")).toBeNull();

            expect(stream.totalRenderCount()).toBe(5);
            await expectNoMoreRenders(stream);
            // Re-checked after the quiet window: no late re-query.
            expect(call).toBe(2);
        } finally {
            actEnv.cleanup();
        }
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
