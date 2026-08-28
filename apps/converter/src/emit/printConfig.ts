/**
 * Deterministic pretty-printer of the JSON config subset as a TS object
 * literal: 4-space indent, trailing commas, keys unquoted when they are
 * identifiers or integers, values inlined when they fit into the line.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue | undefined };

export const INDENT = "    ";
const MAX_INLINE_WIDTH = 100;
const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const INTEGER_KEY = /^(?:0|[1-9][0-9]*)$/;

function printKey(key: string): string {
    return IDENTIFIER_KEY.test(key) || INTEGER_KEY.test(key) ? key : JSON.stringify(key);
}

function entriesOf(value: { [key: string]: JsonValue | undefined }): Array<[string, JsonValue]> {
    return Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined);
}

function printInline(value: JsonValue): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return value.length === 0 ? "[]" : `[${value.map(printInline).join(", ")}]`;
    const entries = entriesOf(value);
    if (entries.length === 0) return "{}";
    return `{ ${entries.map(([key, child]) => `${printKey(key)}: ${printInline(child)}`).join(", ")} }`;
}

/** Renders `value`; the first line carries no indent, the closing bracket sits at `indent`. */
export function printValue(value: JsonValue, indent: string): string {
    const inline = printInline(value);
    if (value === null || typeof value !== "object" || indent.length + inline.length <= MAX_INLINE_WIDTH) return inline;
    const inner = indent + INDENT;
    if (Array.isArray(value)) {
        return `[\n${value.map((child) => `${inner}${printValue(child, inner)},`).join("\n")}\n${indent}]`;
    }
    return `{\n${entriesOf(value)
        .map(([key, child]) => `${inner}${printKey(key)}: ${printValue(child, inner)},`)
        .join("\n")}\n${indent}}`;
}
