import { BUILTIN, type BuiltinBrand } from "../types/brand";

/** Everything a builtin action / guard object carries besides the brand and the `type`. */
type BuiltinProps<T> = Omit<T, BuiltinBrand | "type">;

interface BuiltinShape {
    readonly [BUILTIN]: string;
    readonly type: string;
}

/**
 * Creates a builtin action / guard object the way XState does: a *function*
 * named like XState's inner function (`assign`, `raise`, ...) carrying the
 * `BUILTIN` brand, the XState `type` (`"xstate.assign"`, ...) and its payload
 * as own properties, frozen.
 *
 * A function (not a plain object) because TypeScript defers inference of a
 * nested generic call only when the callee returns a function type; see
 * `BuiltinCallable`. Calling the function throws: builtins are declarative.
 * `fn.name` matches XState so that `{ type: fn.name }` serialization (Stately
 * Inspector definition) renders identically.
 */
export function createBuiltin<T extends BuiltinShape>(
    brand: T[BuiltinBrand],
    name: string,
    type: T["type"],
    props: BuiltinProps<T>,
): T {
    const builtin = function builtin(): never {
        throw new Error(`'${type}' is a declarative builtin and must not be called directly.`);
    };
    Object.defineProperty(builtin, "name", { value: name });
    Object.assign(builtin, { [BUILTIN]: brand, type }, props);
    return Object.freeze(builtin) as unknown as T;
}

/** Brand check — the only way to tell a builtin from an inline action / guard function. */
export function isBuiltin(value: unknown): value is BuiltinShape {
    return typeof value === "function" && BUILTIN in value;
}
