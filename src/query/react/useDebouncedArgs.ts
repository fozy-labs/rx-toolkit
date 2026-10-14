import { useDebouncedValue } from "@/common/react/useDebouncedValue";
import type { UseDebouncedValueResult } from "@/common/react/useDebouncedValue";
import { SKIP } from "@/query/constants";
import { stableStringify } from "@/query/lib/stableStringify";
import { isKeyed } from "@/query/lib/toKeyed";
import type { TArgsOrKeyed } from "@/query/types/common";

export type UseDebouncedArgsOptions = { delay: number };

function keyOf(value: unknown): string | typeof SKIP {
    if (value === SKIP) return SKIP;

    const args = value as TArgsOrKeyed<unknown>;
    return isKeyed(args) ? args.key : stableStringify(value);
}

function equals(a: unknown, b: unknown): boolean {
    return keyOf(a) === keyOf(b);
}

function immediate(value: unknown): boolean {
    return value === SKIP;
}

/**
 * Debounces resource arguments using their structural serialization key, or the `.key` of keyed arguments.
 * Resources with a custom `serializeArgs` that ignores fields may observe an output change they consider equal;
 * that change is a harmless no-op.
 *
 * @param args The latest resource arguments or `SKIP`.
 * @param options Debounce delay in milliseconds.
 * @returns The applied arguments, debounce status, and a function to apply the latest arguments immediately.
 */
export function useDebouncedArgs<TArgs>(args: TArgs, options: UseDebouncedArgsOptions): UseDebouncedValueResult<TArgs> {
    return useDebouncedValue(args, { delay: options.delay, equals, immediate });
}
