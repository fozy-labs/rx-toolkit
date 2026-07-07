/**
 * Runtime container detection and structural helpers shared by the draft
 * producer and the reactive proxy tree.
 *
 * unstable_ProxySignal only reaches *into* "plain containers" — arrays and plain objects.
 * Everything else (class instances, `Map`/`Set`, `Date`, `RegExp`, functions,
 * primitives) is treated as an opaque leaf value: stored and replaced by
 * reference, never proxied deeply. This keeps the reactive graph predictable and
 * avoids the well-known trap-collision bugs of proxying `Map`/`Set`.
 */

/** A plain object: literal `{}` or `Object.create(null)`. Not a class instance. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** An array or plain object — the only values unstable_ProxySignal traverses deeply. */
export function isPlainContainer(value: unknown): value is Record<string, unknown> | unknown[] {
    return Array.isArray(value) || isPlainObject(value);
}

const EMPTY_KEYS: readonly string[] = [];

/**
 * Own enumerable string keys of a container, or an empty list for leaf values.
 * For arrays these are the present index strings (holes are skipped, matching
 * `Object.keys`), never `length`.
 */
export function ownKeysOf(value: unknown): readonly string[] {
    return isPlainContainer(value) ? Object.keys(value as object) : EMPTY_KEYS;
}

/**
 * Whether two values expose the same *set* of own keys. Drives the structural
 * (iteration) signal: it fires only when a key is added or removed, never when
 * an existing key's value changes. A container and a leaf never match.
 */
export function sameKeySet(a: unknown, b: unknown): boolean {
    const ka = ownKeysOf(a);
    const kb = ownKeysOf(b);
    if (ka.length !== kb.length) return false;
    if (ka.length === 0) return true;
    const seen = new Set(ka);
    for (const key of kb) {
        if (!seen.has(key)) return false;
    }
    return true;
}

/** Shallow copy preserving array-ness. Only called on plain containers. */
export function shallowClone<T>(value: T): T {
    if (Array.isArray(value)) return value.slice() as unknown as T;
    return { ...(value as Record<string, unknown>) } as unknown as T;
}
