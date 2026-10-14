import { act, renderHook } from "@testing-library/react";
import React, { startTransition, useState } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { useDebouncedValue } from "./useDebouncedValue";

afterEach(() => {
    vi.useRealTimers();
});

describe("useDebouncedValue", () => {
    it("applies the mount value immediately and waits for the full delay after a change", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, { delay: 100 }), {
            initialProps: { value: "initial" },
        });

        expect(result.current.slice(0, 2)).toEqual(["initial", false]);
        rerender({ value: "next" });
        expect(result.current.slice(0, 2)).toEqual(["initial", true]);

        act(() => vi.advanceTimersByTime(99));
        expect(result.current.slice(0, 2)).toEqual(["initial", true]);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.slice(0, 2)).toEqual(["next", false]);
    });

    it("restarts the delay for changes and cancels when the input returns to the applied value", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, { delay: 100 }), {
            initialProps: { value: "a" },
        });

        rerender({ value: "b" });
        act(() => vi.advanceTimersByTime(70));
        rerender({ value: "c" });
        act(() => vi.advanceTimersByTime(70));
        expect(result.current[0]).toBe("a");

        rerender({ value: "a" });
        expect(result.current.slice(0, 2)).toEqual(["a", false]);
        act(() => vi.advanceTimersByTime(200));
        expect(result.current.slice(0, 2)).toEqual(["a", false]);
    });

    it("applies immediate values and zero-delay changes in the same render", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, { delay: 100, immediate: (next) => next === "" }),
            { initialProps: { value: "a" } },
        );

        rerender({ value: "b" });
        rerender({ value: "" });
        expect(result.current.slice(0, 2)).toEqual(["", false]);
        act(() => vi.advanceTimersByTime(200));
        expect(result.current[0]).toBe("");

        const zeroDelay = renderHook(({ value }) => useDebouncedValue(value, { delay: 0 }), {
            initialProps: { value: 1 },
        });
        zeroDelay.rerender({ value: 2 });
        expect(zeroDelay.result.current.slice(0, 2)).toEqual([2, false]);
    });

    it("uses Object.is by default and supports equal objects without restarting a timer", () => {
        vi.useFakeTimers();
        const first = { id: 1 };
        const second = { id: 1 };
        const defaults = renderHook(({ value }) => useDebouncedValue(value, { delay: 100 }), {
            initialProps: { value: first },
        });
        defaults.rerender({ value: second });
        expect(defaults.result.current[0]).toBe(first);
        expect(defaults.result.current[1]).toBe(true);

        const equals = (a: { id: number }, b: { id: number }) => a.id === b.id;
        const custom = renderHook(({ value }) => useDebouncedValue(value, { delay: 100, equals }), {
            initialProps: { value: { id: 0 } },
        });
        const appliedEqual = { id: 0 };
        custom.rerender({ value: appliedEqual });
        expect(custom.result.current.slice(0, 2)).toEqual([custom.result.current[0], false]);

        const scheduled = { id: 1 };
        custom.rerender({ value: scheduled });
        act(() => vi.advanceTimersByTime(50));
        const scheduledEqual = { id: 1 };
        custom.rerender({ value: scheduledEqual });
        act(() => vi.advanceTimersByTime(50));
        expect(custom.result.current[0]).toBe(scheduledEqual);
        expect(custom.result.current[1]).toBe(false);
    });

    it("flushes the latest committed value, clears the timer, remains stable, and is a no-op when idle", () => {
        vi.useFakeTimers();
        let renders = 0;
        const { result, rerender } = renderHook(
            ({ value }) => {
                renders++;
                return useDebouncedValue(value, { delay: 100 });
            },
            { initialProps: { value: "a" } },
        );
        const flush = result.current[2];
        flush();
        expect(renders).toBe(1);

        rerender({ value: "b" });
        expect(result.current[2]).toBe(flush);
        act(() => result.current[2]());
        expect(result.current.slice(0, 2)).toEqual(["b", false]);
        expect(vi.getTimerCount()).toBe(0);
        act(() => vi.advanceTimersByTime(200));
        expect(result.current[0]).toBe("b");
    });

    it("flushes the value captured before pending transition work and a later input commit", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => {
            const [value, setValue] = useState("a");
            const [, setOther] = useState(0);
            const debounced = useDebouncedValue(value, { delay: 300 });
            return { debounced, setValue, setOther };
        });

        act(() => result.current.setValue("b"));
        expect(result.current.debounced.slice(0, 2)).toEqual(["a", true]);

        act(() => {
            startTransition(() => {
                result.current.setOther(1);
                result.current.debounced[2]();
            });
            result.current.setValue("c");
        });

        expect(result.current.debounced.slice(0, 2)).toEqual(["b", true]);
        act(() => vi.advanceTimersByTime(300));
        expect(result.current.debounced.slice(0, 2)).toEqual(["c", false]);
    });

    it("does not restart a running timer when delay changes", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value, delay }) => useDebouncedValue(value, { delay }), {
            initialProps: { value: "a", delay: 100 },
        });
        rerender({ value: "b", delay: 100 });
        act(() => vi.advanceTimersByTime(70));
        rerender({ value: "b", delay: 500 });
        act(() => vi.advanceTimersByTime(30));
        expect(result.current.slice(0, 2)).toEqual(["b", false]);
    });

    it("clears timers on unmount and stores function values without calling them", () => {
        vi.useFakeTimers();
        const value = vi.fn();
        const { result, rerender, unmount } = renderHook(({ value }) => useDebouncedValue(value, { delay: 10 }), {
            initialProps: { value },
        });
        const next = vi.fn();
        rerender({ value: next });
        expect(result.current[0]).toBe(value);
        expect(value).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "10"])("rejects invalid delay %s", (delay) => {
        expect(() => renderHook(() => useDebouncedValue("value", { delay: delay as number }))).toThrow(RangeError);
    });

    it("keeps the timer lifecycle safe under StrictMode", () => {
        vi.useFakeTimers();
        const wrapper = ({ children }: React.PropsWithChildren) =>
            React.createElement(React.StrictMode, null, children);
        const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, { delay: 50 }), {
            initialProps: { value: "a" },
            wrapper,
        });
        rerender({ value: "b" });
        act(() => vi.advanceTimersByTime(49));
        expect(result.current.slice(0, 2)).toEqual(["a", true]);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current.slice(0, 2)).toEqual(["b", false]);
    });

    it("exposes the expected result type", () => {
        expectTypeOf<ReturnType<typeof useDebouncedValue<string>>>().toEqualTypeOf<[string, boolean, () => void]>();
    });
});
