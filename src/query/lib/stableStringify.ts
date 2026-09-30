/**
 * Deterministic serialization of arguments into a cache key: JSON with object
 * keys in a fixed order, so structurally equal arguments share one key. The
 * default `serializeArgs`.
 *
 * Key order: integer keys (`"0"`, `"10"`, not `"01"`) ascending, then the rest
 * sorted — the order earlier versions got from `JSON.stringify` over an object
 * rebuilt from sorted keys. A JSON value gets exactly that text, so keys
 * persisted in snapshots keep matching. Values JSON turns into `null` or
 * rejects get a key of their own, written as the JS literal: `undefined`,
 * `NaN`, `Infinity`, `-Infinity`, and a bigint as `12n`. Otherwise JSON's
 * rules hold: `toJSON(key)` is called once per value (a Date is its ISO
 * string), a boxed primitive is its primitive, and a function or symbol is
 * not data — omitted from an object like `undefined`, and written as
 * `undefined` elsewhere.
 *
 * Does NOT handle: Map, Set, RegExp — serialized by their own enumerable keys
 * (usually `{}`), like any other object (documented limitation).
 *
 * @throws TypeError on a circular structure.
 */
export function stableStringify(value: unknown): string {
    return serialize("", value, new Set()) ?? "undefined";
}

/**
 * @param key - The key `value` sits under in its parent (`""` at the root), passed to `toJSON`.
 * @param ancestors - The objects being serialized around `value`, to detect cycles.
 * @returns `undefined` when `value` is not data, like `JSON.stringify`.
 */
function serialize(key: string, value: unknown, ancestors: Set<object>): string | undefined {
    const data = toData(key, value);

    switch (typeof data) {
        case "string":
            return JSON.stringify(data);
        case "number":
            return Number.isFinite(data) ? JSON.stringify(data) : String(data);
        case "boolean":
            return String(data);
        case "bigint":
            return `${data}n`;
        case "undefined":
        case "function":
        case "symbol":
            return undefined;
    }
    if (data === null) return "null";

    const object = data as object;
    if (ancestors.has(object)) {
        throw new TypeError("stableStringify: cannot serialize a circular structure");
    }
    ancestors.add(object);

    const parts: string[] = [];
    if (Array.isArray(object)) {
        for (let index = 0; index < object.length; index++) {
            parts.push(serialize(String(index), object[index], ancestors) ?? "undefined");
        }
    } else {
        const record = object as Record<string, unknown>;
        for (const field of orderedKeys(record)) {
            const text = serialize(field, record[field], ancestors);
            if (text !== undefined) parts.push(`${JSON.stringify(field)}:${text}`);
        }
    }

    ancestors.delete(object);
    return Array.isArray(object) ? `[${parts.join(",")}]` : `{${parts.join(",")}}`;
}

/**
 * The data `value` stands for, as JSON sees it: the result of its `toJSON(key)`,
 * called once, then a boxed primitive's primitive.
 */
function toData(key: string, value: unknown): unknown {
    let data = value;
    if ((typeof data === "object" && data !== null) || typeof data === "bigint") {
        const { toJSON } = data as { toJSON?: unknown };
        if (typeof toJSON === "function") data = toJSON.call(data, key);
    }
    if (data instanceof Number) return Number(data);
    if (data instanceof String) return String(data);
    if (data instanceof Boolean || data instanceof BigInt) return data.valueOf();
    return data;
}

/** Own enumerable keys: integer keys ascending, then the rest sorted. */
function orderedKeys(record: object): string[] {
    const integers: string[] = [];
    const others: string[] = [];
    for (const key of Object.keys(record)) (isArrayIndex(key) ? integers : others).push(key);
    integers.sort((a, b) => Number(a) - Number(b));
    return integers.concat(others.sort());
}

/** A canonical array index: the keys JS objects enumerate first, in numeric order. */
function isArrayIndex(key: string): boolean {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key;
}
