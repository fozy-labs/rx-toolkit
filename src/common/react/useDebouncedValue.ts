import { useCallback, useRef, useState } from "react";

import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";

export interface UseDebouncedValueOptions<T> {
    /** Delay in milliseconds; must be non-negative and finite. */
    delay: number;
    /** Compares values; defaults to Object.is. */
    equals?: (a: T, b: T) => boolean;
    /** Values matching this predicate are applied immediately. */
    immediate?: (value: T) => boolean;
}

export type UseDebouncedValueResult<T> = [value: T, isDebouncing: boolean, flush: () => void];

/**
 * Returns a value after it has remained unchanged for the configured delay.
 *
 * @param value The latest input value.
 * @param options Debounce delay and optional comparison and immediate rules.
 * @returns The applied value, debounce status, and a function to apply the latest value immediately.
 */
export function useDebouncedValue<T>(value: T, options: UseDebouncedValueOptions<T>): UseDebouncedValueResult<T> {
    const { delay, equals = Object.is, immediate } = options;

    if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
        throw new RangeError(
            `useDebouncedValue: "delay" must be a non-negative number of milliseconds (got ${String(delay)})`,
        );
    }

    const [applied, setApplied] = useState<T>(() => value);
    const latestInput = useRef(value);
    const latestApplied = useRef(applied);
    const latestEquals = useRef(equals);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scheduledTarget = useRef<T | undefined>(undefined);

    const clearTimer = useCallback(() => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
        scheduledTarget.current = undefined;
    }, []);

    const shouldApplyImmediately = delay === 0 || immediate?.(value) === true;
    if (!equals(value, applied) && shouldApplyImmediately) {
        setApplied(() => value);
    }

    useIsomorphicLayoutEffect(() => {
        latestInput.current = value;
        latestApplied.current = applied;
        latestEquals.current = equals;

        if (equals(value, applied) || shouldApplyImmediately) {
            clearTimer();
            return;
        }

        if (timer.current !== null && equals(value, scheduledTarget.current as T)) {
            scheduledTarget.current = value;
            return;
        }

        clearTimer();
        scheduledTarget.current = value;
        timer.current = setTimeout(() => {
            const target = scheduledTarget.current as T;
            timer.current = null;
            scheduledTarget.current = undefined;
            setApplied(() => target);
        }, delay);
    });

    useIsomorphicLayoutEffect(
        () => () => {
            clearTimer();
        },
        [clearTimer],
    );

    const flush = useCallback(() => {
        if (latestEquals.current(latestInput.current, latestApplied.current)) {
            clearTimer();
            return;
        }

        clearTimer();
        setApplied(() => latestInput.current);
    }, [clearTimer]);

    return [applied, !equals(value, applied), flush];
}
