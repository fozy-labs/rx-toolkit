import { useRef, useState } from "react";

import { useIsomorphicLayoutEffect } from "./useIsomorphicLayoutEffect";

export interface UseDelayedFlagOptions {
    /** Delay in milliseconds before showing an active flag; must be non-negative and finite. */
    delay: number;
    /** Minimum time in milliseconds the flag stays shown; defaults to 0. */
    minDuration?: number;
}

export type UseDelayedFlagResult = [shown: boolean, isDelaying: boolean];

type DelayedState =
    | { phase: "off" }
    | { phase: "waiting" }
    | { phase: "on"; shownAt: number }
    | { phase: "holding"; shownAt: number; deadline: number };

function initialState(active: boolean, delay: number): DelayedState {
    if (!active) return { phase: "off" };
    if (delay === 0) return { phase: "on", shownAt: Date.now() };
    return { phase: "waiting" };
}

/**
 * Delays showing an active flag and keeps it shown for a minimum duration.
 *
 * @param active Whether the flag should be shown.
 * @param options Delay and minimum visible duration in milliseconds.
 * @returns Whether the flag is shown and whether it is waiting or being held.
 */
export function useDelayedFlag(active: boolean, options: UseDelayedFlagOptions): UseDelayedFlagResult {
    const { delay, minDuration = 0 } = options;

    if (typeof delay !== "number" || !Number.isFinite(delay) || delay < 0) {
        throw new RangeError(
            `useDelayedFlag: "delay" must be a non-negative number of milliseconds (got ${String(delay)})`,
        );
    }
    if (typeof minDuration !== "number" || !Number.isFinite(minDuration) || minDuration < 0) {
        throw new RangeError(
            `useDelayedFlag: "minDuration" must be a non-negative number of milliseconds (got ${String(minDuration)})`,
        );
    }

    const [state, setState] = useState<DelayedState>(() => initialState(active, delay));
    const latestInput = useRef(active);
    const waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    let current = state;
    if (current.phase === "off" && active) {
        current = delay === 0 ? { phase: "on", shownAt: Date.now() } : { phase: "waiting" };
        setState(() => current);
    } else if (current.phase === "waiting" && !active) {
        current = { phase: "off" };
        setState(() => current);
    } else if (current.phase === "on" && !active) {
        if (Date.now() - current.shownAt >= minDuration) {
            current = { phase: "off" };
        } else {
            current = {
                phase: "holding",
                shownAt: current.shownAt,
                deadline: current.shownAt + minDuration,
            };
        }
        setState(() => current);
    } else if (current.phase === "holding" && active) {
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
        latestInput.current = active;

        if (current.phase === "waiting" && active) {
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

        if (current.phase === "holding" && !active) {
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

    if (current.phase === "off") return [false, false];
    if (current.phase === "waiting") return [false, true];
    if (current.phase === "holding") return [true, true];
    return [true, false];
}
