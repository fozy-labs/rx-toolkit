import { act, renderHook } from "@testing-library/react";

import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";
import { useResourceV2Agent } from "@/query-v2/react/useResourceV2Agent";

import { controllableQueryFn, createTestResource } from "./helpers";

describe("useResourceV2Agent (standalone)", () => {
    // T1: Renders with resource + args, returns reactive state with status === "success"
    it("T1: returns reactive state that resolves to success", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createTestResource({ queryFn: fn });

        const { result } = renderHook(() => useResourceV2Agent(resource, 1));

        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toBeNull();

        await act(async () => {
            calls[0].resolve("Alice");
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toBe("Alice");
        expect(result.current.isSuccess).toBe(true);
        expect(result.current.isLoading).toBe(false);
    });

    // T2: With SKIP — state is idle, queryFn not called
    it("T2: with SKIP — state is idle, queryFn not called", () => {
        const { fn } = controllableQueryFn<number, string>();
        const resource = createTestResource({ queryFn: fn });

        const { result } = renderHook(() => useResourceV2Agent(resource, SKIP));

        expect(result.current.status).toBe("idle");
        expect(result.current.data).toBeNull();
        expect(fn).not.toHaveBeenCalled();
    });

    // T3: Args change triggers re-query
    it("T3: args change triggers re-query", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createTestResource({ queryFn: fn });

        const { result, rerender } = renderHook(
            ({ args }) => useResourceV2Agent(resource, args),
            { initialProps: { args: 1 as number } },
        );

        // Resolve first query
        await act(async () => {
            calls[0].resolve("data-1");
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(result.current.data).toBe("data-1");

        // Change args
        rerender({ args: 2 });

        // Second query should have been triggered
        expect(fn).toHaveBeenCalledTimes(2);

        await act(async () => {
            calls[1].resolve("data-2");
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(result.current.data).toBe("data-2");
    });

    // T4: SKIP → real args triggers start, state transitions idle → pending → success
    it("T4: SKIP → real args triggers start", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createTestResource({ queryFn: fn });

        const { result, rerender } = renderHook(
            ({ args }) => useResourceV2Agent(resource, args as number | typeof SKIP),
            { initialProps: { args: SKIP as number | typeof SKIP } },
        );

        expect(result.current.status).toBe("idle");
        expect(fn).not.toHaveBeenCalled();

        // Switch to real args
        rerender({ args: 1 });

        expect(fn).toHaveBeenCalledTimes(1);
        expect(result.current.isLoading).toBe(true);

        await act(async () => {
            calls[0].resolve("data-1");
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toBe("data-1");
    });

    // T5: Same args on re-render is no-op (queryFn called once)
    it("T5: same args on re-render is no-op", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createTestResource({ queryFn: fn });

        const { result, rerender } = renderHook(
            ({ args }) => useResourceV2Agent(resource, args),
            { initialProps: { args: 1 } },
        );

        await act(async () => {
            calls[0].resolve("data-1");
            await new Promise((r) => setTimeout(r, 10));
        });

        expect(result.current.data).toBe("data-1");

        // Re-render with same args
        rerender({ args: 1 });

        // queryFn should have been called only once
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
