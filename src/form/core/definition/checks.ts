import { FormConfigError } from "../FormConfigError";

import { isContextToken, type QueryRecord, type RuleRecord } from "./records";

const SHOW_ERRORS: ReadonlySet<unknown> = new Set(["touched", "modified", "submitted", "always"]);

/** A plain object literal (or `Object.create(null)`): not an array, not a class instance. */
export function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** Short description of a rejected value for error messages. */
export function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    return typeof value;
}

export function joinPath(path: string, key: string): string {
    return path ? `${path}.${key}` : key;
}

export function assertOptions(value: unknown, allowed: readonly string[], builder: string): Record<string, unknown> {
    if (!isPlainObject(value)) {
        throw new FormConfigError("", `${builder}() expects an options object (got ${describeValue(value)})`);
    }
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            throw new FormConfigError(
                key,
                `'${key}' is not an option of ${builder}() (allowed: ${allowed.join(", ")})`,
            );
        }
    }
    return value;
}

/**
 * Names of children, rules, `computed` and `queries` must not end with `$` (the instance aliases
 * use it) and must not contain `.` or `/` (they would break the source string and devtools paths).
 */
export function assertName(name: string, path: string): void {
    if (name.endsWith("$") || name.includes(".") || name.includes("/")) {
        throw new FormConfigError(path, `the name '${name}' must not end with '$' or contain '.' or '/'`);
    }
}

export function assertRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
    if (!isPlainObject(value)) {
        throw new FormConfigError(path, `must be a plain object (got ${describeValue(value)})`);
    }
    return value;
}

export function assertFunction(value: unknown, path: string): (...args: any[]) => any {
    if (typeof value !== "function") {
        throw new FormConfigError(path, `must be a function (got ${describeValue(value)})`);
    }
    return value as (...args: any[]) => any;
}

export function checkShowErrors(value: unknown, path: string) {
    if (value !== undefined && !SHOW_ERRORS.has(value)) {
        throw new FormConfigError(
            path,
            `must be "touched", "modified", "submitted" or "always" (got ${String(value)})`,
        );
    }
    return value as "touched" | "modified" | "submitted" | "always" | undefined;
}

export function checkContext(value: unknown, path: string): boolean {
    if (value === undefined) return false;
    if (!isContextToken(value)) {
        throw new FormConfigError(path, "must be created by FormSignal.context<T>()");
    }
    return true;
}

/** A record of named callbacks (`computed`, `disabled`), frozen. */
export function checkCallbacks(value: unknown, path: string, checkNames: boolean): Readonly<Record<string, any>> {
    if (value === undefined) return Object.freeze({});
    const record = assertRecord(value, path);
    const result: Record<string, any> = {};
    for (const [name, fn] of Object.entries(record)) {
        const entryPath = joinPath(path, name);
        if (checkNames) assertName(name, entryPath);
        result[name] = assertFunction(fn, entryPath);
    }
    return Object.freeze(result);
}

/** `queries`: a key function, or `{ bind, debounce }`. */
export function checkQueries(value: unknown, path: string): Readonly<Record<string, QueryRecord>> {
    if (value === undefined) return Object.freeze({});
    const record = assertRecord(value, path);
    const result: Record<string, QueryRecord> = {};
    for (const [name, entry] of Object.entries(record)) {
        const entryPath = joinPath(path, name);
        assertName(name, entryPath);
        // Every function has a `bind` property: the function form is told apart by its type.
        if (typeof entry === "function") {
            result[name] = Object.freeze({ key: entry as QueryRecord["key"], debounce: null });
            continue;
        }
        if (!isPlainObject(entry)) {
            throw new FormConfigError(
                entryPath,
                `must be a function or { bind, debounce } (got ${describeValue(entry)})`,
            );
        }
        for (const key of Object.keys(entry)) {
            if (key !== "bind" && key !== "debounce") {
                throw new FormConfigError(entryPath, `'${key}' is not an option of a query (allowed: bind, debounce)`);
            }
        }
        const debounce = entry.debounce;
        if (typeof debounce !== "number" || !Number.isFinite(debounce) || debounce < 0) {
            throw new FormConfigError(
                joinPath(entryPath, "debounce"),
                `must be a non-negative number of milliseconds (got ${String(debounce)})`,
            );
        }
        result[name] = Object.freeze({ key: assertFunction(entry.bind, joinPath(entryPath, "bind")), debounce });
    }
    return Object.freeze(result);
}

/** `validate`: the short form, or a record of named rules, in declaration order. */
export function checkRules(value: unknown, path: string): readonly RuleRecord[] {
    if (value === undefined) return Object.freeze([]);
    if (typeof value === "function")
        return Object.freeze([Object.freeze({ name: null, fn: value as RuleRecord["fn"] })]);
    if (!isPlainObject(value)) {
        throw new FormConfigError(path, `must be a function or a record of functions (got ${describeValue(value)})`);
    }
    return Object.freeze(
        Object.entries(value).map(([name, fn]) => {
            const entryPath = joinPath(path, name);
            assertName(name, entryPath);
            return Object.freeze({ name, fn: assertFunction(fn, entryPath) });
        }),
    );
}
