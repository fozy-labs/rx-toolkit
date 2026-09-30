import type { Observable } from "rxjs";

import { Signal } from "@/index";

/**
 * Thrown by {@link hangGuard} when a loop the current engine never leaves
 * exceeds its budget. Always the same instance per guard: a computed that
 * throws it keeps it as an unchanged error state, which ends the loop.
 */
export class HangGuardError extends Error {
    constructor(what: string) {
        super(`hang guard: ${what} ran too many times`);
        this.name = "HangGuardError";
    }
}

/**
 * Returns a tick to call on every run of a computeFn or effect body that may
 * loop forever on the current engine. The limit is far above any flush
 * iteration limit the new core may use, so the guard never masks the
 * expected `SignalCycleError`.
 */
export function hangGuard(what: string, limit = 5000) {
    let runs = 0;
    const error = new HangGuardError(what);
    const tick = () => {
        runs += 1;
        if (runs > limit) throw error;
    };
    tick.runs = () => runs;
    return tick;
}

export type ObsLog<T> = {
    values: T[];
    errors: unknown[];
    unsubscribe(): void;
};

/** Subscribes to an observable, recording values and errors (never unhandled). */
export function record<T>(obs: Observable<T>): ObsLog<T> {
    const values: T[] = [];
    const errors: unknown[] = [];
    const sub = obs.subscribe({
        next: (v) => values.push(v),
        error: (e: unknown) => errors.push(e),
    });
    return { values, errors, unsubscribe: () => sub.unsubscribe() };
}

/** Runs `read` in an effect and records every value it returns. */
export function effectLog<T>(read: () => T) {
    const values: T[] = [];
    const effect = Signal.effect(() => {
        values.push(read());
    });
    return { values, unsubscribe: () => effect.unsubscribe() };
}

/** Calls `fn` and returns what it threw, or `undefined`. */
export function caught(fn: () => unknown): unknown {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return undefined;
}
