import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApi } from "@/query/api/createApi";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";

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

    it("does not suspend on a background refresh (SWR keeps stale data)", async () => {
        const deferreds = [defer<{ v: number }>(), defer<{ v: number }>()];
        let call = 0;
        const api = createApi({ plugins: [reactHooksPlugin()] });
        const resource = api.createResource<void, { v: number }>({
            queryFn: () => deferreds[call++]!.promise,
        });

        let latestRefresh: () => void = () => {};

        function View() {
            const state = resource.useSuspenseResource();
            latestRefresh = state.refresh;
            return h("span", { "data-testid": "v" }, `${state.data.v}:${state.isRefreshing}`);
        }

        render(h(React.Suspense, { fallback: suspenseFallback("fallback") }, h(View)));

        await act(async () => {
            deferreds[0]!.resolve({ v: 1 });
            await flushMicrotasks();
        });

        expect((await screen.findByTestId("v")).textContent).toBe("1:false");

        // Trigger a background refresh — must NOT re-show the Suspense fallback.
        await act(async () => {
            latestRefresh();
            await flushMicrotasks();
        });

        expect(screen.queryByTestId("fallback")).toBeNull();
        expect(screen.getByTestId("v").textContent).toBe("1:true");

        await act(async () => {
            deferreds[1]!.resolve({ v: 2 });
            await flushMicrotasks();
        });

        expect(screen.getByTestId("v").textContent).toBe("2:false");
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
});

describe("ResourceAgent.whenSettled", () => {
    it("resolves once data becomes available and is reusable afterwards", async () => {
        const d = defer<number>();
        const api = createApi();
        const resource = api.createResource<void, number>({ queryFn: () => d.promise });

        const agent = resource.createAgent();
        agent.set(undefined, true);
        agent.start();

        let settled = false;
        void agent.whenSettled().then(() => {
            settled = true;
        });

        await flushMicrotasks();
        expect(settled).toBe(false);

        d.resolve(42);
        await flushMicrotasks();
        await flushMicrotasks();

        expect(settled).toBe(true);
        // Already settled → resolves immediately on subsequent calls.
        await expect(agent.whenSettled()).resolves.toBeUndefined();
    });

    it("resolves (does not reject) when the query fails", async () => {
        const d = defer<number>();
        const api = createApi();
        const resource = api.createResource<void, number>({ queryFn: () => d.promise });

        const agent = resource.createAgent();
        agent.set(undefined, true);
        agent.start();

        const settled = agent.whenSettled();

        d.reject(new Error("boom"));
        await flushMicrotasks();
        await flushMicrotasks();

        await expect(settled).resolves.toBeUndefined();
    });
});
