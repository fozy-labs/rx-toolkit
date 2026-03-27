import { act, renderHook } from "@testing-library/react";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { _createResourceV2 } from "@/query-v2/api/_createResourceV2";
import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";

import { useResourceV2Agent } from "../useResourceV2Agent";

function createControllableResource<TArgs = { id: number }, TData = { name: string }>() {
    const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
    const resource = _createResourceV2<TArgs, TData>({
        queryFn,
        cacheLifetime: false as never,
    });
    return { resource, queryFn, calls };
}

describe("useResourceV2Agent", () => {
    // RH01: renders with pending, then success
    it("RH01: renders with pending state, then transitions to success on resolve", async () => {
        const { resource, calls } = createControllableResource();

        const { result } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        expect(result.current.status).toBe("pending");
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeNull();

        await act(async () => {
            calls[0].resolve({ name: "item-1" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "item-1" });
        expect(result.current.isLoading).toBe(false);
    });

    // RH02: SKIP token — idle state, no fetch
    it("RH02: SKIP token keeps idle state with no fetch", () => {
        const { resource, queryFn } = createControllableResource();

        const { result } = renderHook(() => useResourceV2Agent(resource, SKIP));

        expect(queryFn).not.toHaveBeenCalled();
        expect(result.current.status).toBe("idle");
        expect(result.current.data).toBeNull();
        expect(result.current.isLoading).toBe(false);
    });

    // RH03: args change triggers new fetch + SWR
    it("RH03: changing args triggers new fetch with SWR showing stale data", async () => {
        const { resource, queryFn, calls } = createControllableResource();

        let args: { id: number } = { id: 1 };
        const { result, rerender } = renderHook(() => useResourceV2Agent(resource, args));

        expect(queryFn).toHaveBeenCalledTimes(1);

        // Resolve first call
        await act(async () => {
            calls[0].resolve({ name: "item-1" });
            await flushMicrotasks();
        });

        expect(result.current.data).toEqual({ name: "item-1" });

        // Change args
        args = { id: 2 };
        rerender();

        expect(queryFn).toHaveBeenCalledTimes(2);
        // SWR: should still show previous data while loading new
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toEqual({ name: "item-1" });

        // Resolve second call
        await act(async () => {
            calls[1].resolve({ name: "item-2" });
            await flushMicrotasks();
        });

        expect(result.current.data).toEqual({ name: "item-2" });
        expect(result.current.isLoading).toBe(false);
    });

    // RH04: unmount cleans up agent/subscription
    it("RH04: unmount cleans up subscription without errors", async () => {
        const { resource, calls } = createControllableResource();

        const { result, unmount } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        expect(result.current.isLoading).toBe(true);

        unmount();

        // Resolving after unmount should not cause errors
        await act(async () => {
            calls[0].resolve({ name: "item-1" });
            await flushMicrotasks();
        });
    });

    // RH05: same args on rerender — no re-fetch
    it("RH05: same args on rerender does not trigger re-fetch", async () => {
        const { resource, queryFn, calls } = createControllableResource();

        const args = { id: 1 };
        const { rerender } = renderHook(() => useResourceV2Agent(resource, args));

        expect(queryFn).toHaveBeenCalledTimes(1);

        await act(async () => {
            calls[0].resolve({ name: "item-1" });
            await flushMicrotasks();
        });

        // Rerender with same args
        rerender();

        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // RH06: void args — no second argument
    it("RH06: void args resource works without second argument", async () => {
        const { queryFn, calls } = createControllableQueryFn<void, { items: string[] }>();
        const resource = _createResourceV2<void, { items: string[] }>({
            queryFn,
            cacheLifetime: false as never,
        });

        const { result } = renderHook(() => useResourceV2Agent(resource));

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(result.current.isLoading).toBe(true);

        await act(async () => {
            calls[0].resolve({ items: ["a", "b"] });
            await flushMicrotasks();
        });

        expect(result.current.data).toEqual({ items: ["a", "b"] });
    });

    // RH07: multiple components sharing same resource/args — single fetch
    it("RH07: multiple hooks sharing same resource/args trigger a single fetch", async () => {
        const { resource, queryFn, calls } = createControllableResource();

        const { result: result1 } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));
        const { result: result2 } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        // queryFn called once per entry (dedup at entry level)
        expect(queryFn).toHaveBeenCalledTimes(1);

        await act(async () => {
            calls[0].resolve({ name: "shared-data" });
            await flushMicrotasks();
        });

        expect(result1.current.data).toEqual({ name: "shared-data" });
        expect(result2.current.data).toEqual({ name: "shared-data" });
    });

    // RH08: useSyncExternalStore tearing protection — verify consistent state
    it("RH08: useSyncExternalStore provides consistent snapshot reads", async () => {
        const { resource, calls } = createControllableResource();

        const { result } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        // The hook uses useSyncExternalStore — verify state is a coherent snapshot
        const state = result.current;
        expect(state.status).toBe("pending");
        expect(state.isLoading).toBe(true);
        expect(state.isSuccess).toBe(false);
        // All fields consistent with pending status
        expect(state.data).toBeNull();
        expect(state.error).toBeNull();

        await act(async () => {
            calls[0].resolve({ name: "consistent" });
            await flushMicrotasks();
        });

        const successState = result.current;
        expect(successState.status).toBe("success");
        expect(successState.isSuccess).toBe(true);
        expect(successState.isLoading).toBe(false);
        expect(successState.data).toEqual({ name: "consistent" });
    });

    // RH09: error boundary — hook does not throw on error state
    it("RH09: error state is reported in state, hook does not throw", async () => {
        const { resource, calls } = createControllableResource();

        const { result } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        await act(async () => {
            calls[0].reject(new Error("fetch failed"));
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("error");
        expect(result.current.isError).toBe(true);
        expect(result.current.error).toBeInstanceOf(Error);
        expect((result.current.error as Error).message).toBe("fetch failed");
        expect(result.current.data).toBeNull();
    });

    // RH10: rapid unmount/remount — no stale callbacks
    it("RH10: rapid unmount/remount produces clean state", async () => {
        const { resource, calls } = createControllableResource();

        // First mount
        const { unmount } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));
        unmount();

        // Remount
        const { result } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        // The resource entry is shared, so the query is still in-flight
        expect(result.current.isLoading).toBe(true);

        await act(async () => {
            calls[0].resolve({ name: "after-remount" });
            await flushMicrotasks();
        });

        expect(result.current.data).toEqual({ name: "after-remount" });
        expect(result.current.status).toBe("success");
    });
});
