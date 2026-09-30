/**
 * Deterministic serialization of arguments into a cache key: JSON with object
 * keys sorted, so structurally equal arguments share one key. The default
 * `serializeArgs`.
 *
 * A JSON value gets exactly its `JSON.stringify` text (keys sorted), so keys
 * persisted in snapshots keep matching. Values JSON would turn into `null`
 * get a key of their own, written as the JS literal: `undefined`, `NaN`,
 * `Infinity`, `-Infinity`, and a bigint as `12n`. Otherwise JSON's rules
 * hold: `toJSON()` is honoured (a Date is its ISO string), a boxed primitive
 * is its primitive, and a function or symbol is not data — omitted from an
 * object like `undefined`, and written as `undefined` elsewhere.
 *
 * Does NOT handle: Map, Set, RegExp — serialized by their own enumerable keys
 * (usually `{}`), like any other object (documented limitation).
 *
 * @throws TypeError on a circular structure.
 */
export function stableStringify(value: unknown): string {
    return serialize(value, new Set());
}

/** @param ancestors - The objects being serialized around `value`, to detect cycles. */
function serialize(value: unknown, ancestors: Set<object>): string {
    const data = toData(value);

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
            return "undefined";
    }
    if (data === null) return "null";

    const object = data as object;
    if (ancestors.has(object)) {
        throw new TypeError("stableStringify: cannot serialize a circular structure");
    }
    ancestors.add(object);

    let text: string;
    if (Array.isArray(object)) {
        text = `[${Array.from(object, (item) => serialize(item, ancestors)).join(",")}]`;
    } else {
        const record = object as Record<string, unknown>;
        const fields: string[] = [];
        for (const key of Object.keys(record).sort()) {
            const item = toData(record[key]);
            if (item === undefined) continue;
            fields.push(`${JSON.stringify(key)}:${serialize(item, ancestors)}`);
        }
        text = `{${fields.join(",")}}`;
    }

    ancestors.delete(object);
    return text;
}

/**
 * The data `value` stands for, as JSON sees it: the result of its `toJSON()`,
 * a boxed primitive's primitive, and `undefined` for a function or symbol.
 */
function toData(value: unknown): unknown {
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    if (typeof value !== "object" || value === null) return value;

    const { toJSON } = value as { toJSON?: unknown };
    if (typeof toJSON === "function") return toData(toJSON.call(value));
    if (value instanceof Number || value instanceof String || value instanceof Boolean || value instanceof BigInt) {
        return value.valueOf();
    }
    return value;
}
