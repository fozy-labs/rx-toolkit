import { act, renderHook } from "@testing-library/react";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { createApi } from "@/query-v2/api/createApi";
import { useResourceV2Agent } from "@/query-v2/react";

type TArgs = { id: number };
type TData = { name: string };

function createTestApi() {
    const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
    const api = createApi();
    const resource = api.createResourceV2<TArgs, TData>({
        key: "users",
        queryFn,
        cacheLifetime: false as never,
    });
    return { api, resource, queryFn, calls };
}

describe("Integration: query-flow", () => {
    // ── INT01: Full pipeline: createResourceV2 → query → cache → agent.state$ → data ──
    it("INT01: full pipeline from createResourceV2 through agent.state$ to data", async () => {
        const { resource, queryFn, calls } = createTestApi();

        // Create agent and start with args
        const agent = resource.createAgent();
        agent.start({ id: 1 });

        // Verify pending state
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(agent.state$().status).toBe("pending");
        expect(agent.state$().isLoading).toBe(true);
        expect(agent.state$().data).toBeNull();

        // Resolve the query
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // Verify success state flows through all layers
        const state = agent.state$();
        expect(state.status).toBe("success");
        expect(state.data).toEqual({ name: "Alice" });
        expect(state.isLoading).toBe(false);
        expect(state.isSuccess).toBe(true);
        expect(state.args).toEqual({ id: 1 });

        // Cache entry is accessible and consistent
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Alice" });
    });

    // ── INT02: Full pipeline: React hook → fetch → render → rerender with new args ──
    it("INT02: React hook renders pending, resolves, then SWR on args change", async () => {
        const { resource, queryFn, calls } = createTestApi();

        let args: TArgs = { id: 1 };
        const { result, rerender } = renderHook(() => useResourceV2Agent(resource, args));

        // Initial render: pending
        expect(result.current.status).toBe("pending");
        expect(result.current.isLoading).toBe(true);
        expect(queryFn).toHaveBeenCalledTimes(1);

        // Resolve first fetch
        await act(async () => {
            calls[0].resolve({ name: "Alice" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Alice" });

        // Change args → triggers SWR
        args = { id: 2 };
        rerender();

        expect(queryFn).toHaveBeenCalledTimes(2);
        // SWR: shows previous data while loading
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toEqual({ name: "Alice" });

        // Resolve second fetch
        await act(async () => {
            calls[1].resolve({ name: "Bob" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Bob" });
        expect(result.current.isLoading).toBe(false);
    });

    // ── INT12: Args change: old entry's request is not aborted ──
    it("INT12: args change does not abort old entry's pending request", async () => {
        const { resource, calls } = createTestApi();

        const agent = resource.createAgent();

        // Start with args1
        agent.start({ id: 1 });
        expect(calls).toHaveLength(1);

        // Switch to args2 before args1 resolves
        agent.start({ id: 2 });
        expect(calls).toHaveLength(2);

        // args1 abort signal should NOT be triggered
        expect(calls[0].abortSignal.aborted).toBe(false);

        // Both requests continue independently — resolve args1
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // args1 entry should be in success (available to other consumers)
        const entry1 = resource.getEntry({ id: 1 });
        expect(entry1).not.toBeNull();
        expect(entry1!.peek().status).toBe("success");
        expect(entry1!.peek().data).toEqual({ name: "Alice" });

        // Agent tracks args2 — still pending
        expect(agent.state$().status).toBe("pending");

        // Resolve args2
        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "Bob" });
    });
});
