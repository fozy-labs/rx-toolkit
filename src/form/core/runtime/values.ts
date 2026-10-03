import { shallowEqual } from "@/common/utils/shallowEqual";
import { untracked } from "@/signals/base/untracked";

import type { Parsed } from "../../types";

/** An initial value that was not provided: the node starts from its `defaultValue`. */
export const ABSENT: unique symbol = Symbol("absent");

/** Reinit data meaning "every node back to its `defaultValue`", as `initialize()` without `state`. */
export const DEFAULTS: unique symbol = Symbol("defaults");

/**
 * The presence rule of init, `initialize`, `push` and `insert`: a value is provided when its own
 * key exists and the value is not `undefined`; `null` is a value.
 */
export function isProvided(record: unknown, key: string): boolean {
    return (
        typeof record === "object" &&
        record !== null &&
        Object.prototype.hasOwnProperty.call(record, key) &&
        (record as Record<string, unknown>)[key] !== undefined
    );
}

/** The value of `key` in reinit data: `DEFAULTS` passes down, a missing key is `ABSENT`. */
export function childData(data: unknown, key: string): unknown {
    if (data === DEFAULTS) return DEFAULTS;
    return isProvided(data, key) ? (data as Record<string, unknown>)[key] : ABSENT;
}

type Equals = (a: unknown, b: unknown) => boolean;

/**
 * A call of a field's `equals` made by the form (`set` dedup, `isDirty$`, reinit): untracked, and
 * a throw falls back to `Object.is` with a `console.error`.
 */
export function safeEquals(equals: Equals | undefined, a: unknown, b: unknown, label: string): boolean {
    if (!equals) return Object.is(a, b);
    try {
        return untracked(() => Boolean(equals(a, b)));
    } catch (error) {
        console.error(`[rx-toolkit] equals of form field "${label}" threw; falling back to Object.is.`, error);
        return Object.is(a, b);
    }
}

export const NOT_PARSED: Parsed<never> = Object.freeze({ isParsed: false, value: undefined });

/** `parsed$` of a field: the same `isParsed` and the same value. */
export function parsedEquals(a: Parsed<unknown>, b: Parsed<unknown>): boolean {
    return a.isParsed === b.isParsed && Object.is(a.value, b.value);
}

/** `parsed$` of a group: the same `isParsed` and the same value of every key. */
export function composedParsedEquals(a: Parsed<unknown>, b: Parsed<unknown>): boolean {
    return a.isParsed === b.isParsed && shallowEqual(a.value, b.value);
}
