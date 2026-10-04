import { useRef, useState } from "react";

import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";

export interface UseDelayedValueOptions {
    /** Delay in milliseconds before showing a truthy value; must be non-negative and finite. */
    delay: number;
    /** Minimum time in milliseconds a shown value stays visible; defaults to 0. */
    minDuration?: number;
}

export type TDelayedValue<T> = [T] extends [boolean] ? boolean : T | undefined;
export type UseDelayedValueResult<T> = [value: TDelayedValue<T>, isDelaying: boolean];

type DelayedState<T> =
    | { phase: "off" }
    | { phase: "waiting"; output: TDelayedValue<T> }
    | { phase: "on"; shownAt: number }
    | { phase: "holding"; output: TDelayedValue<T>; shownAt: number; deadline: number };

function fallbackValue<T>(value: T): TDelayedValue<T> {
    return (typeof value === "boolean" ? false : undefined) as TDelayedValue<T>;
}

function initialState<T>(value: T, delay: number): DelayedState<T> {
    if (!value) return { phase: "off" };
    if (delay === 0) return { phase: "on", shownAt: Date.now() };
    return { phase: "waiting", output: fallbackValue(value) };
}

/**
 * Delays showing truthy values and keeps shown values visible for a minimum duration.
 *
 * @param value The value whose truthy state controls visibility.
 * @param options Delay and minimum visible duration in milliseconds.
 * @returns The displayed value and whether it is waiting or being held.
 */
export function useDelayedValue<T>(value: T, options: UseDelayedValueOptions): UseDelayedValueResult<T> {
    const { delay, minDuration = 0 } = options;

    if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
        throw new RangeError(
            `useDelayedValue: "delay" must be a non-negative number of milliseconds (got ${String(delay)})`,
        );
    }
    if (typeof minDuration !== "number" || !Number.isFinite(minDuration) || minDuration < 0) {
        throw new RangeError(
            `useDelayedValue: "minDuration" must be a non-negative number of milliseconds (got ${String(minDuration)})`,
        );
    }

    const [state, setState] = useState<DelayedState<T>>(() => initialState(value, delay));
    const latestInput = useRef(value);
    const lastOffOutput = useRef<TDelayedValue<T>>(fallbackValue(value));
    const hasOffOutput = useRef(false);
    const lastShown = useRef<TDelayedValue<T>>(fallbackValue(value));
    const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    let current = state;
    if (current.phase === "off" && value) {
        current =
            delay === 0
                ? { phase: "on", shownAt: Date.now() }
                : {
                      phase: "waiting",
                      output: hasOffOutput.current ? lastOffOutput.current : fallbackValue(value),
                  };
        setState(() => current);
    } else if (current.phase === "waiting" && !value) {
        current = { phase: "off" };
        setState(() => current);
    } else if (current.phase === "on" && !value) {
        if (Date.now() - current.shownAt >= minDuration) {
            current = { phase: "off" };
        } else {
            current = {
                phase: "holding",
                output: lastShown.current,
                shownAt: current.shownAt,
                deadline: current.shownAt + minDuration,
            };
        }
        setState(() => current);
    } else if (current.phase === "holding" && value) {
        current = { phase: "on", shownAt: current.shownAt };
        setState(() => current);
    }

    const clearWaitTimer = () => {
        if (waitTimer.current !== null) clearTimeout(waitTimer.current);
        waitTimer.current = null;
    };
    const clearHoldTimer = () => {
        if (holdTimer.current !== null) clearTimeout(holdTimer.current);
        holdTimer.current = null;
    };

    useIsomorphicLayoutEffect(() => {
        latestInput.current = value;
        if (current.phase === "off") {
            lastOffOutput.current = value as TDelayedValue<T>;
            hasOffOutput.current = true;
        } else if (current.phase === "on" && value) {
            lastShown.current = value as TDelayedValue<T>;
        }

        if (current.phase === "waiting" && value) {
            clearHoldTimer();
            if (waitTimer.current === null) {
                waitTimer.current = setTimeout(() => {
                    waitTimer.current = null;
                    if (latestInput.current) setState(() => ({ phase: "on", shownAt: Date.now() }));
                }, delay);
            }
        } else {
            clearWaitTimer();
        }

        if (current.phase === "holding" && !value) {
            if (holdTimer.current === null) {
                holdTimer.current = setTimeout(
                    () => {
                        holdTimer.current = null;
                        if (!latestInput.current) setState(() => ({ phase: "off" }));
                    },
                    Math.max(0, current.deadline - Date.now()),
                );
            }
        } else {
            clearHoldTimer();
        }
    });

    useIsomorphicLayoutEffect(
        () => () => {
            clearWaitTimer();
            clearHoldTimer();
        },
        [],
    );

    if (current.phase === "off") return [value as TDelayedValue<T>, false];
    if (current.phase === "waiting" || current.phase === "holding") return [current.output, true];
    return [value as TDelayedValue<T>, false];
}
