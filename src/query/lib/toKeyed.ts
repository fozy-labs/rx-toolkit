import { KEYED_BRAND } from "../constants";
import type { TArgsOrKeyed, TKeyed } from "../types";

import { stableStringify } from "./stableStringify";

/**
 * Type guard: returns `true` if `args` is already wrapped in `TKeyed<T>`.
 */
export function isKeyed<T>(args: TArgsOrKeyed<T>): args is TKeyed<T> {
    return args !== null && typeof args === "object" && KEYED_BRAND in args;
}

/**
 * Normalizes raw args into `TKeyed<T>`.
 * If `args` is already `TKeyed`, it passes through unchanged.
 * Otherwise wraps with `{ value: args, key: serializeFn(args) }`.
 */
export function toKeyed<T>(args: TArgsOrKeyed<T>, serializeFn: (value: T) => string = stableStringify): TKeyed<T> {
    if (isKeyed(args)) return args;
    return { value: args as T, key: serializeFn(args as T), [KEYED_BRAND]: true } as TKeyed<T>;
}
