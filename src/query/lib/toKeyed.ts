import { KEYED_BRAND } from "../constants";
import type { Args, Keyed } from "../types";

import { stableStringify } from "./stableStringify";

/**
 * Type guard: returns `true` if `args` is already wrapped in `Keyed<T>`.
 */
export function isKeyed<T>(args: Args<T>): args is Keyed<T> {
    return args !== null && typeof args === "object" && KEYED_BRAND in args;
}

/**
 * Normalizes raw args into `Keyed<T>`.
 * If `args` is already `Keyed`, it passes through unchanged.
 * Otherwise wraps with `{ value: args, key: serializeFn(args) }`.
 */
export function toKeyed<T>(args: Args<T>, serializeFn: (value: T) => string = stableStringify): Keyed<T> {
    if (isKeyed(args)) return args;
    return { value: args as T, key: serializeFn(args as T), [KEYED_BRAND]: true } as Keyed<T>;
}
