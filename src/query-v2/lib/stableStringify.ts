function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Deterministic JSON.stringify with sorted object keys.
 * Used as the default serializeArgs for the 'serialize' key strategy.
 *
 * Handles: plain objects, arrays, primitives, null, undefined, nested structures.
 * Does NOT handle: Date, Map, Set, RegExp (documented limitation).
 */
export function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_, val: unknown) => {
        if (isPlainObject(val)) {
            return Object.keys(val)
                .sort()
                .reduce<Record<string, unknown>>((acc, key) => {
                    acc[key] = val[key];
                    return acc;
                }, {});
        }
        return val;
    });
}
