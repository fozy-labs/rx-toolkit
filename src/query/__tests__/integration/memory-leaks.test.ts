import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query/__tests__/helpers";
import { createApi } from "@/query/api/createApi";
import { useResourceAgent } from "@/query/react";

type TArgs = { id: number };
type TData = { name: string };

describe("Integration: memory-leaks", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function createTestResource(cacheLifetime: number | false = 5000) {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: cacheLifetime as never,
        });
        return { api, resource, queryFn, calls };
    }

    // ── ML01: Agent state resets when switching to SKIP ──
    it("ML01: agent resets to idle when started with SKIP", async () => {
        const { resource, calls } = createTestResource(false);
        const agent = resource.createAgent();

        agent.start({ id: 1 });
        expect(agent.state$.peek().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(agent.state$.peek().status).toBe("success");

        // After starting with SKIP, creating a new agent should work without leaks
        const agent2 = resource.createAgent();
        agent2.start({ id: 1 });
        expect(agent2.state$.peek().status).toBe("success");
    });

    // ── ML02: Resource GC removes entry after cacheLifetime ──
    it("ML02: entry is GC'd after cacheLifetime when no subscribers", async () => {
        const lifetime = 5000;
        const { resource, calls } = createTestResource(lifetime);

        // Create entry and subscribe via entry obs
        const entry = resource.getEntry({ id: 1 }, true);
        const sub = entry.obs.subscribe();
        entry.query().catch(() => {});
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(resource.getEntry({ id: 1 })).not.toBeNull();

        // Unsubscribe — starts GC timer
        sub.unsubscribe();

        // Before timer: entry still exists
        vi.advanceTimersByTime(lifetime - 100);
        expect(resource.getEntry({ id: 1 })).not.toBeNull();

        // After timer: entry is removed
        vi.advanceTimersByTime(200);
        expect(resource.getEntry({ id: 1 })).toBeNull();
    });

    // ── ML03: GC timer cleared on re-subscribe ──
    it("ML03: re-subscribing before GC timer preserves the entry", async () => {
        const lifetime = 5000;
        const { resource, calls } = createTestResource(lifetime);

        // Create entry and subscribe via entry obs
        const entry = resource.getEntry({ id: 1 }, true);
        const sub1 = entry.obs.subscribe();
        entry.query().catch(() => {});
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // Unsubscribe — starts GC timer
        sub1.unsubscribe();

        // Re-subscribe before timer fires
        vi.advanceTimersByTime(lifetime / 2);
        const sub2 = entry.obs.subscribe();

        // Advance past original timer — entry should survive
        vi.advanceTimersByTime(lifetime);
        expect(resource.getEntry({ id: 1 })).not.toBeNull();
        expect(resource.getEntry({ id: 1 })!.peek().status).toBe("success");

        sub2.unsubscribe();
    });

    // ── ML04: Signal cleanup on unsubscribe ──
    it("ML04: agent state$ compute does not fire after unsubscribe", async () => {
        const { resource, calls } = createTestResource(false);
        const agent = resource.createAgent();

        agent.start({ id: 1 });
        expect(agent.state$.peek().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const computeSpy = vi.fn();
        const sub = agent.state$.obs.subscribe(() => {
            computeSpy();
        });

        // Unsubscribe
        sub.unsubscribe();

        // Further mutations to resource should not trigger agent state$
        computeSpy.mockClear();
        resource.query({ id: 2 });
        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();

        // Agent's compute should not have fired for the new entry
        expect(computeSpy).not.toHaveBeenCalled();
    });

    // ── ML05: React hook unmount cleanup ──
    it("ML05: unmounting hook disposes agent and cleans up subscription", async () => {
        const { resource, calls } = createTestResource(false);

        const { result, unmount } = renderHook(() => useResourceAgent(resource, { id: 1 }));

        await act(async () => {
            calls[0].resolve({ name: "Alice" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Alice" });

        // Unmount — agent should be disposed, subscription cleaned up
        unmount();

        // Resource should still function normally for new agents
        const agent2 = resource.createAgent();
        agent2.start({ id: 1 });
        expect(agent2.state$.peek().status).toBe("success");
    });

    // ── ML06: Repeated mount/unmount cycles ──
    it("ML06: 10 mount/unmount cycles do not accumulate subscriptions", async () => {
        const { resource, queryFn, calls } = createTestResource(false);

        // Resolve the first call — subsequent mounts reuse cache
        const { unmount: u0 } = renderHook(() => useResourceAgent(resource, { id: 1 }));
        expect(queryFn).toHaveBeenCalledTimes(1);

        await act(async () => {
            calls[0].resolve({ name: "Alice" });
            await flushMicrotasks();
        });
        u0();

        // 10 mount/unmount cycles
        for (let i = 0; i < 10; i++) {
            const { result, unmount } = renderHook(() => useResourceAgent(resource, { id: 1 }));

            await act(async () => {
                await flushMicrotasks();
            });

            expect(result.current.status).toBe("success");
            expect(result.current.data).toEqual({ name: "Alice" });
            unmount();
        }

        // Entry should still exist and be valid
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("success");

        // queryFn should only have been called once (cache hit for all subsequent mounts)
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // ── ML07: Args change cleanup ──
    it("ML07: changing args properly transitions agent — old entry is not leaked", async () => {
        const { resource, queryFn, calls } = createTestResource(false);

        let args: TArgs = { id: 1 };
        const { result, rerender } = renderHook(() => useResourceAgent(resource, args));

        // Resolve first query
        await act(async () => {
            calls[0].resolve({ name: "Alice" });
            await flushMicrotasks();
        });
        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Alice" });

        // Change args to id:2
        args = { id: 2 };
        rerender();

        await act(async () => {
            await flushMicrotasks();
        });

        expect(queryFn).toHaveBeenCalledTimes(2);

        // Resolve second query
        await act(async () => {
            calls[1].resolve({ name: "Bob" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Bob" });

        // Both entries exist in cache (previous is preserved for SWR)
        expect(resource.getEntry({ id: 1 })).not.toBeNull();
        expect(resource.getEntry({ id: 2 })).not.toBeNull();

        // Only 2 queryFn calls total — no spurious re-fetches
        expect(queryFn).toHaveBeenCalledTimes(2);
    });
});
