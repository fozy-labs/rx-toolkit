import { SignalCycleError } from "@/signals/base/SignalCycleError";

import { FormConfigError } from "../FormConfigError";

/** The outcome of a guarded user callback: its value, or the error it threw. */
export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };

/**
 * Runs a user callback of the form graph so that its throw never leaves the graph: the throw
 * becomes a failed outcome, which the caller turns into an issue. Configuration errors pass
 * through (see {@link passConfigError}); `where` names the callback in them.
 */
export function guard<T>(fn: () => T, where: string): Outcome<T> {
    try {
        return { ok: true, value: fn() };
    } catch (error) {
        return { ok: false, error: passConfigError(error, where) };
    }
}

/**
 * Rethrows a configuration error, returns any other error. A `FormConfigError` goes on as is; a
 * signal cycle becomes a `FormConfigError` at `where`, the innermost callback that closed it.
 */
export function passConfigError(error: unknown, where: string): unknown {
    if (error instanceof FormConfigError) throw error;
    if (error instanceof SignalCycleError) {
        throw new FormConfigError(
            where,
            `reads a signal that depends on its own result (${error.chain.join(" → ")}); ` +
                "form callbacks may read only inputs",
        );
    }
    return error;
}

/** Equality of outcomes: the same value, or the same error. */
export function outcomeEquals(a: Outcome<unknown>, b: Outcome<unknown>): boolean {
    if (a.ok && b.ok) return Object.is(a.value, b.value);
    if (!a.ok && !b.ok) return Object.is(a.error, b.error);
    return false;
}

/** The message of an issue made from a thrown error. */
export function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message || error.name;
    return String(error);
}
