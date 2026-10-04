import { act, renderHook } from "@testing-library/react";
import React from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { useDelayedValue } from "./useDelayedValue";

afterEach(() => {
    vi.useRealTimers();
});

describe("useDelayedValue", () => {
    it("passes falsy mount values through and delays a truthy mount value", () => {
        vi.useFakeTimers();
        const off = renderHook(() => useDelayedValue(false, { delay: 100 }));
        expect(off.result.current).toEqual([false, false]);

        const on = renderHook(() => useDelayedValue(true, { delay: 100 }));
        expect(on.result.current).toEqual([false, true]);
        act(() => vi.advanceTimersByTime(100));
        expect(on.result.current).toEqual([true, false]);
    });

    it("cancels a pending show when the input becomes falsy", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value }) => useDelayedValue(value, { delay: 100 }), {
            initialProps: { value: false },
        });
        rerender({ value: true });
        expect(result.current).toEqual([false, true]);
        rerender({ value: false });
        expect(result.current).toEqual([false, false]);
        act(() => vi.advanceTimersByTime(200));
        expect(result.current).toEqual([false, false]);
    });

    it("holds a shown value until the minimum duration deadline", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ value }) => useDelayedValue(value, { delay: 20, minDuration: 100 }),
            { initialProps: { value: false } },
        );
        rerender({ value: true });
        act(() => vi.advanceTimersByTime(20));
        expect(result.current).toEqual([true, false]);
        act(() => vi.advanceTimersByTime(40));
        rerender({ value: false });
        expect(result.current).toEqual([true, true]);
        act(() => vi.advanceTimersByTime(59));
        expect(result.current).toEqual([true, true]);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toEqual([false, false]);
    });

    it("passes falsy input through immediately after the minimum duration", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value }) => useDelayedValue(value, { delay: 10, minDuration: 30 }), {
            initialProps: { value: false },
        });
        rerender({ value: true });
        act(() => vi.advanceTimersByTime(40));
        rerender({ value: false });
        expect(result.current).toEqual([false, false]);
    });

    it("keeps the shown value without dropping when truthy input returns during a hold", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ value }) => useDelayedValue(value, { delay: 10, minDuration: 100 }),
            { initialProps: { value: false } },
        );
        rerender({ value: true });
        act(() => vi.advanceTimersByTime(10));
        act(() => vi.advanceTimersByTime(20));
        rerender({ value: false });
        expect(result.current).toEqual([true, true]);
        act(() => vi.advanceTimersByTime(20));
        rerender({ value: true });
        expect(result.current).toEqual([true, false]);
        act(() => vi.advanceTimersByTime(70));
        expect(result.current).toEqual([true, false]);
    });

    it("shows immediately with delay zero and turns off immediately with the default minimum duration", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value }) => useDelayedValue(value, { delay: 0 }), {
            initialProps: { value: false },
        });
        rerender({ value: true });
        expect(result.current).toEqual([true, false]);
        rerender({ value: false });
        expect(result.current).toEqual([false, false]);
    });

    it("keeps the last off output while waiting and latest truthy input when shown", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ value }) => useDelayedValue(value, { delay: 100, minDuration: 40 }),
            { initialProps: { value: "" as string | null } },
        );
        expect(result.current).toEqual(["", false]);
        rerender({ value: "first" });
        expect(result.current).toEqual(["", true]);
        act(() => vi.advanceTimersByTime(50));
        rerender({ value: "latest" });
        expect(result.current).toEqual(["", true]);
        act(() => vi.advanceTimersByTime(50));
        expect(result.current).toEqual(["latest", false]);

        rerender({ value: "shown" });
        expect(result.current).toEqual(["shown", false]);
        rerender({ value: "updated" });
        expect(result.current).toEqual(["updated", false]);
        rerender({ value: null });
        expect(result.current).toEqual(["updated", true]);
        rerender({ value: "" });
        expect(result.current).toEqual(["updated", true]);
        rerender({ value: "held" });
        expect(result.current).toEqual(["held", false]);
        rerender({ value: null });
        act(() => vi.advanceTimersByTime(40));
        expect(result.current).toEqual([null, false]);
        rerender({ value: "next" });
        act(() => vi.advanceTimersByTime(100));
        expect(result.current).toEqual(["next", false]);
        rerender({ value: null });
        expect(result.current).toEqual(["next", true]);
        act(() => vi.advanceTimersByTime(40));
        expect(result.current).toEqual([null, false]);
    });

    it("uses undefined as the mount fallback for a truthy non-boolean value", () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => useDelayedValue("loading", { delay: 10 }));
        expect(result.current).toEqual([undefined, true]);
        act(() => vi.advanceTimersByTime(10));
        expect(result.current).toEqual(["loading", false]);
    });

    it("stores function values without calling them", () => {
        vi.useFakeTimers();
        const value = vi.fn();
        const { result } = renderHook(() => useDelayedValue(value, { delay: 10 }));
        expect(result.current).toEqual([undefined, true]);
        act(() => vi.advanceTimersByTime(10));
        expect(result.current[0]).toBe(value);
        expect(value).not.toHaveBeenCalled();
    });

    it("shows the latest generic input after the original wait without restarting it", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(({ value }) => useDelayedValue(value, { delay: 100 }), {
            initialProps: { value: "first" as string | null },
        });
        expect(result.current).toEqual([undefined, true]);
        act(() => vi.advanceTimersByTime(50));
        rerender({ value: "latest" });
        act(() => vi.advanceTimersByTime(49));
        expect(result.current).toEqual([undefined, true]);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toEqual(["latest", false]);
    });

    it("does not restart active timers when options change", () => {
        vi.useFakeTimers();
        const { result, rerender } = renderHook(
            ({ value, delay, minDuration }) => useDelayedValue(value, { delay, minDuration }),
            { initialProps: { value: false, delay: 100, minDuration: 100 } },
        );
        rerender({ value: true, delay: 100, minDuration: 100 });
        act(() => vi.advanceTimersByTime(60));
        rerender({ value: true, delay: 500, minDuration: 500 });
        act(() => vi.advanceTimersByTime(40));
        expect(result.current).toEqual([true, false]);

        rerender({ value: false, delay: 500, minDuration: 100 });
        expect(result.current).toEqual([true, true]);
        act(() => vi.advanceTimersByTime(40));
        rerender({ value: false, delay: 1, minDuration: 500 });
        act(() => vi.advanceTimersByTime(60));
        expect(result.current).toEqual([false, false]);
    });

    it("clears timers on unmount", () => {
        vi.useFakeTimers();
        const { unmount } = renderHook(() => useDelayedValue(true, { delay: 100 }));
        expect(vi.getTimerCount()).toBe(1);
        unmount();
        expect(vi.getTimerCount()).toBe(0);

        const held = renderHook(({ value }) => useDelayedValue(value, { delay: 10, minDuration: 100 }), {
            initialProps: { value: true },
        });
        act(() => vi.advanceTimersByTime(10));
        held.rerender({ value: false });
        expect(vi.getTimerCount()).toBe(1);
        held.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "10"])("rejects invalid delay %s", (delay) => {
        expect(() => renderHook(() => useDelayedValue(true, { delay: delay as number }))).toThrow(RangeError);
    });

    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, "10"])("rejects invalid minDuration %s", (minDuration) => {
        expect(() => renderHook(() => useDelayedValue(true, { delay: 1, minDuration: minDuration as number }))).toThrow(
            RangeError,
        );
    });

    it("keeps the timer lifecycle safe under StrictMode", () => {
        vi.useFakeTimers();
        const wrapper = ({ children }: React.PropsWithChildren) =>
            React.createElement(React.StrictMode, null, children);
        const { result } = renderHook(() => useDelayedValue(true, { delay: 25 }), { wrapper });
        expect(result.current).toEqual([false, true]);
        act(() => vi.advanceTimersByTime(24));
        expect(result.current).toEqual([false, true]);
        act(() => vi.advanceTimersByTime(1));
        expect(result.current).toEqual([true, false]);
    });

    it("exposes the expected inferred types", () => {
        expectTypeOf<ReturnType<typeof useDelayedValue<boolean>>>().toEqualTypeOf<[boolean, boolean]>();
        expectTypeOf<ReturnType<typeof useDelayedValue<string | null>>[0]>().toEqualTypeOf<string | null | undefined>();
    });
});
