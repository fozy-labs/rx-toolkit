import { act, renderHook } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { createApi } from "@/query/api/createApi";
import { SKIP } from "@/query/constants";
import { toKeyed } from "@/query/lib/toKeyed";
import { reactHooksPlugin } from "@/query/react/ReactHooksPlugin";

import { useDebouncedArgs } from "./useDebouncedArgs";

afterEach(() => {
    vi.useRealTimers();
});

describe("useDebouncedArgs", () => {
    it("applies the mount arguments immediately", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useDebouncedArgs({ q: "first" }, { delay: 100 }));

        expect(result.current).toEqual([{ q: "first" }, false, expect.any(Function)]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("does not debounce a structurally equal inline object", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ q }) => useDebouncedArgs({ q }, { delay: 100 }), {
            initialProps: { q: "same" },
        });

        rerender({ q: "same" });

        expect(result.current[0]).toEqual({ q: "same" });
        expect(result.current[1]).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("compares object keys independent of their order", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ reverse }) => useDebouncedArgs(reverse ? { b: 2, a: 1 } : { a: 1, b: 2 }, { delay: 100 }),
            { initialProps: { reverse: false } },
        );

        rerender({ reverse: true });

        expect(result.current[0]).toEqual({ a: 1, b: 2 });
        expect(result.current[1]).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("waits for changed arguments and restarts the delay for each change", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ q }) => useDebouncedArgs({ q }, { delay: 100 }), {
            initialProps: { q: "first" },
        });

        rerender({ q: "second" });
        expect(result.current[0]).toEqual({ q: "first" });
        expect(result.current[1]).toBe(true);

        act(() => vi.advanceTimersByTime(99));
        expect(result.current[0]).toEqual({ q: "first" });

        rerender({ q: "third" });
        act(() => vi.advanceTimersByTime(99));
        expect(result.current[0]).toEqual({ q: "first" });
        expect(result.current[1]).toBe(true);

        act(() => vi.advanceTimersByTime(1));
        expect(result.current[0]).toEqual({ q: "third" });
        expect(result.current[1]).toBe(false);
    });

    it("cancels the timer when arguments return to the applied value", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ q }) => useDebouncedArgs({ q }, { delay: 100 }), {
            initialProps: { q: "applied" },
        });

        rerender({ q: "pending" });
        expect(result.current[1]).toBe(true);
        rerender({ q: "applied" });

        expect(result.current[0]).toEqual({ q: "applied" });
        expect(result.current[1]).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(100));
        expect(result.current[0]).toEqual({ q: "applied" });
    });

    it("applies SKIP immediately and cancels a pending timer", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ args }) => useDebouncedArgs(args, { delay: 100 }), {
            initialProps: { args: { q: "applied" } as { q: string } | typeof SKIP },
        });

        rerender({ args: { q: "pending" } });
        expect(result.current[1]).toBe(true);
        rerender({ args: SKIP });

        expect(result.current[0]).toBe(SKIP);
        expect(result.current[1]).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("debounces arguments supplied after SKIP", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ args }) => useDebouncedArgs(args, { delay: 100 }), {
            initialProps: { args: SKIP as { q: string } | typeof SKIP },
        });

        expect(result.current).toEqual([SKIP, false, expect.any(Function)]);
        rerender({ args: { q: "after-skip" } });
        expect(result.current[0]).toBe(SKIP);
        expect(result.current[1]).toBe(true);

        act(() => vi.advanceTimersByTime(100));
        expect(result.current[0]).toEqual({ q: "after-skip" });
        expect(result.current[1]).toBe(false);
    });

    it("compares keyed arguments by their key", () => {
        vi.useFakeTimers();
        const first = toKeyed({ id: 1 }, () => "shared-key");
        const second = toKeyed({ id: 2 }, () => "shared-key");
        expect(first).not.toBe(second);
        expect(first.key).toBe(second.key);
        const { result, rerender } = renderHook(({ args }) => useDebouncedArgs(args, { delay: 100 }), {
            initialProps: { args: first },
        });

        rerender({ args: second });

        expect(result.current[0]).toBe(first);
        expect(result.current[1]).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("flushes the latest arguments immediately", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ q }) => useDebouncedArgs({ q }, { delay: 100 }), {
            initialProps: { q: "applied" },
        });
        rerender({ q: "next" });
        const flush = result.current[2];

        act(() => flush());

        expect(result.current[0]).toEqual({ q: "next" });
        expect(result.current[1]).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("infers resource arguments including SKIP", () => {
        const assertResourceArgs = (condition: boolean) => {
            const api = createApi({ plugins: [reactHooksPlugin()] });
            const resource = api.createResource<{ q: string }, string>({
                queryFn: async ({ q }) => q,
            });
            const args = useDebouncedArgs(condition ? { q: "a" } : SKIP, { delay: 1 })[0];

            expectTypeOf(args).toEqualTypeOf<{ q: string } | typeof SKIP>();
            resource.useResource(args);
        };
        void assertResourceArgs;
    });
});
