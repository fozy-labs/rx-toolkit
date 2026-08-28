/**
 * Small value helpers shared by the config validators (`normalize`,
 * `MachineDefinition`) and `deepFreeze`. Kept dependency-light: only the
 * builtin brand check is imported, for `describeValue`.
 */
import { isBuiltin } from "./createBuiltin";

/** A plain object literal (or `Object.create(null)`): not an array, not a class instance, not a function. */
export function isPlainObject(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    if (typeof value !== "object" || value === null) return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

export function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/** Short description of a rejected value for error messages (`null`, `an array`, `builtin 'xstate.assign'`, `number`, ...). */
export function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (isBuiltin(value)) return `builtin '${value.type}'`;
    return typeof value;
}
