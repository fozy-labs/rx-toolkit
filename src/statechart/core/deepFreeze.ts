import { isPlainObject } from "./utils";

export interface DeepFreezeOptions {
    /**
     * Top-level keys whose *values* are left unfrozen (the key itself still
     * becomes read-only as part of the frozen root). Used by `createMachine`
     * to keep the initial `context` object mutable, like XState.
     */
    except?: readonly PropertyKey[];
}

/**
 * Freezes plain objects and arrays recursively, in place. Functions, class
 * instances, `Map`/`Set` and other exotic objects are left untouched (freezing
 * them would not make their contents immutable anyway and may break them).
 * Cycles are tolerated.
 */
export function deepFreeze<T>(value: T, options?: DeepFreezeOptions): T {
    const seen = new WeakSet<object>();
    const except = new Set<PropertyKey>(options?.except ?? []);

    const visit = (node: unknown, isRoot: boolean): void => {
        if (!Array.isArray(node) && !isPlainObject(node)) return;
        if (seen.has(node)) return;
        seen.add(node);

        for (const key of Reflect.ownKeys(node)) {
            if (isRoot && except.has(key)) continue;
            visit((node as Record<PropertyKey, unknown>)[key], false);
        }

        Object.freeze(node);
    };

    visit(value, true);
    return value;
}
