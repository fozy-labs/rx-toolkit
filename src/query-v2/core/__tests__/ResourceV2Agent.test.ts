import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";
import { Signal } from "@/signals";

import { ResourceV2 } from "../ResourceV2";
import { ResourceV2Agent } from "../ResourceV2Agent";

/** Controllable queryFn: returns a promise you can resolve/reject from outside */
function controllableQueryFn<TArgs = unknown, TData = unknown>() {
    const calls: Array<{
        args: TArgs;
        resolve: (data: TData) => void;
        reject: (error: Error) => void;
        signal: AbortSignal;
    }> = [];

    const fn = vi.fn((args: TArgs, { abortSignal }: { abortSignal: AbortSignal }) => {
        return new Promise<TData>((resolve, reject) => {
            let settled = false;
            const wrappedResolve = (data: TData) => {
                if (settled) return;
                settled = true;
                resolve(data);
            };
            const wrappedReject = (error: Error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            calls.push({ args, resolve: wrappedResolve, reject: wrappedReject, signal: abortSignal });
            abortSignal.addEventListener("abort", () => {
                wrappedReject(new DOMException("Aborted", "AbortError"));
            });
        });
    });

    return { fn, calls };
}

function createResourceAndAgent<TArgs = number, TData = string>(
    overrides: Partial<ConstructorParameters<typeof ResourceV2<TArgs, TData>>[0]> = {},
) {
    const { fn, calls } = controllableQueryFn<TArgs, TData>();
    const resource = new ResourceV2<TArgs, TData>({
        queryFn: fn,
        cacheLifetime: 5000,
        ...overrides,
    });
    const agent = resource.createAgent() as ResourceV2Agent<TArgs, TData>;
    return { resource, agent, queryFn: fn, calls };
}

describe("ResourceV2Agent", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // A1: start triggers query, state$ reactive
    it("A1: start(args) triggers query and state$ is reactive", async () => {
        const { agent, calls } = createResourceAndAgent();

        // Initial state is idle
        expect(agent.state$().status).toBe("idle");
        expect(agent.state$().data).toBeNull();

        // Start query
        const startPromise = agent.start(1);

        // Should be pending
        expect(agent.state$().status).toBe("pending");
        expect(agent.state$().isLoading).toBe(true);

        // Resolve
        calls[0].resolve("result-data" as any);
        await startPromise;

        // Should be success
        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toBe("result-data");
        expect(agent.state$().isLoading).toBe(false);

        // Verify reactivity — state$ inside Signal.compute
        let evalCount = 0;
        const derived = Signal.compute(() => {
            evalCount++;
            return agent.state$().status;
        });
        expect(derived()).toBe("success");
        expect(evalCount).toBe(1);
    });

    // A2: SWR — start(newArgs) shows previous data while loading
    it("A2: SWR — previous data shown while loading new args", async () => {
        const { agent, calls } = createResourceAndAgent();

        // Load first args
        const p1 = agent.start(1);
        calls[0].resolve("data-1" as any);
        await p1;
        expect(agent.state$().data).toBe("data-1");

        // Start new args without resolving
        const p2 = agent.start(2);

        // SWR: should show previous data while loading
        const state = agent.state$();
        expect(state.data).toBe("data-1");
        expect(state.isLoading).toBe(true);
        expect(state.isInitialLoading).toBe(false);
        expect(state.status).toBe("pending");

        // Resolve new args
        calls[1].resolve("data-2" as any);
        await p2;

        expect(agent.state$().data).toBe("data-2");
        expect(agent.state$().isLoading).toBe(false);
    });

    // A3: isInitialLoading true on first load
    it("A3: isInitialLoading is true on first load (no previous data)", async () => {
        const { agent, calls } = createResourceAndAgent();

        agent.start(1);

        expect(agent.state$().isInitialLoading).toBe(true);
        expect(agent.state$().isLoading).toBe(true);
        expect(agent.state$().data).toBeNull();

        calls[0].resolve("data" as any);
        await vi.advanceTimersByTimeAsync(0);
    });

    // A4: isInitialLoading false when switching args with stale data
    it("A4: isInitialLoading false when stale data available from previous", async () => {
        const { agent, calls } = createResourceAndAgent();

        // Load first args
        const p1 = agent.start(1);
        calls[0].resolve("data-1" as any);
        await p1;

        // Start new args
        agent.start(2);

        // Should NOT be initial loading (stale data from args=1 is available)
        expect(agent.state$().isInitialLoading).toBe(false);
        expect(agent.state$().isLoading).toBe(true);
        expect(agent.state$().data).toBe("data-1"); // SWR

        calls[1].resolve("data-2" as any);
        await vi.advanceTimersByTimeAsync(0);
    });

    // A5: start(SKIP) no-op, state preserved
    it("A5: start(SKIP) is a no-op — no fetch, state preserved", async () => {
        const { agent, calls, queryFn } = createResourceAndAgent();

        // Load initial data
        const p1 = agent.start(1);
        calls[0].resolve("data-1" as any);
        await p1;

        expect(agent.state$().data).toBe("data-1");
        const callCountBefore = queryFn.mock.calls.length;

        // Start with SKIP — should not trigger any fetch
        await agent.start(SKIP as any);

        expect(queryFn.mock.calls.length).toBe(callCountBefore);
        expect(agent.state$().data).toBe("data-1");
        expect(agent.state$().status).toBe("success");
    });

    // A6: Rapid arg changes — latest wins
    it("A6: rapid arg changes — only latest args fetch completes", async () => {
        const { agent, calls } = createResourceAndAgent();

        // Start three rapid queries
        const p1 = agent.start(1);
        const p2 = agent.start(2);
        const p3 = agent.start(3);

        // Only args=3 should be the current
        // args=1 and args=2 queries were started but agent moved on
        expect(calls.length).toBe(3);

        // Resolve all — but only the latest matters
        calls[0].resolve("data-1" as any);
        calls[1].resolve("data-2" as any);
        calls[2].resolve("data-3" as any);

        await Promise.all([p1, p2, p3]);

        // Agent should show data for the latest args (3)
        expect(agent.state$().data).toBe("data-3");
        expect(agent.state$().args).toBe(3);
    });

    // A7: refreshError set when refresh fails
    it("A7: refreshError set when refresh fails, data preserved", async () => {
        const { agent, resource, calls } = createResourceAndAgent();

        // Load initial data
        const p1 = agent.start(1);
        calls[0].resolve("data-1" as any);
        await p1;

        expect(agent.state$().data).toBe("data-1");
        expect(agent.state$().refreshError).toBeNull();

        // Invalidate triggers refresh
        resource.invalidate(1);
        expect(agent.state$().status).toBe("refreshing");

        // Reject the refresh queryFn
        const refreshError = new Error("Refresh failed");
        calls[1].reject(refreshError);
        await vi.advanceTimersByTimeAsync(0);

        // ADR-2: data preserved, machine goes back to success
        expect(agent.state$().data).toBe("data-1");
        expect(agent.state$().status).toBe("success");
        expect(agent.state$().refreshError).toBe(refreshError);
    });

    // A8: previous cleared after current resolves
    it("A8: previous is cleared after current resolves", async () => {
        const { agent, calls } = createResourceAndAgent();

        // Load first args
        const p1 = agent.start(1);
        calls[0].resolve("data-1" as any);
        await p1;

        // Start new args
        const p2 = agent.start(2);

        // During loading, we have SWR (previous data available)
        expect(agent.state$().data).toBe("data-1");

        // Resolve new args
        calls[1].resolve("data-2" as any);
        await p2;

        // After resolve, previous should be cleared (data is from current, not stale)
        expect(agent.state$().data).toBe("data-2");
        expect(agent.state$().isLoading).toBe(false);

        // Verify previous is truly cleared: start a third args
        const p3 = agent.start(3);

        // Now there's no previous data from args=1 — only current (args=2) data is available as SWR
        // Actually args=2 is the previous now, providing SWR data
        expect(agent.state$().data).toBe("data-2");
        expect(agent.state$().isInitialLoading).toBe(false);

        calls[2].resolve("data-3" as any);
        await p3;
    });
});

// Edge case tests
describe("ResourceV2Agent — Edge Cases", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // E4: Concurrent invalidations on same args
    // ResourceV2.invalidate() only works from MachineSuccess state.
    // When already refreshing, a second invalidate is a no-op — the first refresh completes.
    it("E4: concurrent invalidations — second is no-op while refreshing", async () => {
        const { agent, resource, calls } = createResourceAndAgent();

        // Load initial data
        const p1 = agent.start(1);
        calls[0].resolve("data-1" as any);
        await p1;

        // First invalidation → refreshing
        resource.invalidate(1);
        expect(calls.length).toBe(2);
        expect(agent.state$().status).toBe("refreshing");

        // Second invalidation while refreshing — no-op (machine is not MachineSuccess)
        resource.invalidate(1);
        expect(calls.length).toBe(2); // No new call

        // Resolve first refresh
        calls[1].resolve("data-1-fresh" as any);
        await vi.advanceTimersByTimeAsync(0);

        expect(agent.state$().data).toBe("data-1-fresh");
        expect(agent.state$().status).toBe("success");
    });

    // E5: Rapid re-queries — 5 arg changes, only last completes
    it("E5: rapid arg changes (5) — only last completes", async () => {
        const { agent, calls, queryFn } = createResourceAndAgent();

        // Fire 5 rapid start calls
        const promises = [];
        for (let i = 1; i <= 5; i++) {
            promises.push(agent.start(i));
        }

        expect(queryFn).toHaveBeenCalledTimes(5);

        // Resolve only the last one; others are still pending but agent moved on
        calls[4].resolve("data-5" as any);

        // Resolve earlier ones too (they'll complete but agent ignores them for state)
        calls[0].resolve("data-1" as any);
        calls[1].resolve("data-2" as any);
        calls[2].resolve("data-3" as any);
        calls[3].resolve("data-4" as any);

        await Promise.all(promises);

        // Agent should show data for args=5 (latest wins)
        expect(agent.state$().data).toBe("data-5");
        expect(agent.state$().args).toBe(5);
    });

    // Additional: refreshError cleared on next success
    it("refreshError cleared on next successful query", async () => {
        const { agent, resource, calls } = createResourceAndAgent();

        // Load initial data
        const p1 = agent.start(1);
        calls[0].resolve("data-1" as any);
        await p1;

        // Invalidate and fail → sets refreshError
        resource.invalidate(1);
        calls[1].reject(new Error("refresh failed"));
        await vi.advanceTimersByTimeAsync(0);
        expect(agent.state$().refreshError).not.toBeNull();

        // New start clears refreshError
        const p3 = agent.start(2);
        calls[2].resolve("data-2" as any);
        await p3;

        expect(agent.state$().refreshError).toBeNull();
    });

    // Same args check — skip if unchanged
    it("start with same args is a no-op", async () => {
        const { agent, calls, queryFn } = createResourceAndAgent();

        const p1 = agent.start(1);
        calls[0].resolve("data" as any);
        await p1;

        const callCount = queryFn.mock.calls.length;

        // Starting with same args should be a no-op
        await agent.start(1);
        expect(queryFn.mock.calls.length).toBe(callCount);
    });

    // compareArgs delegates to resource
    it("compareArgs delegates to resource.compareArgs", () => {
        const { agent } = createResourceAndAgent();
        expect(agent.compareArgs(1, 1)).toBe(true);
        expect(agent.compareArgs(1, 2)).toBe(false);
    });
});
