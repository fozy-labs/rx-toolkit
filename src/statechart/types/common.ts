/**
 * Extended state of a machine. Mirrors XState's `MachineContext`.
 *
 * `any` (not `unknown`) on purpose: user context types are usually declared
 * as `interface`s, and an interface is not assignable to
 * `Record<string, unknown>` (no implicit index signature). This is the single
 * deliberate `any` in the public statechart types.
 */
export type MachineContext = Record<string, any>;

/** Free-form metadata attached to state nodes and transitions. */
export type MetaObject = Record<string, unknown>;

export type SingleOrArray<T> = readonly T[] | T;

/**
 * Blocks inference from a position without wrapping the type (XState's
 * `DoNotInfer`). The native `NoInfer<T>` survives instantiation as a wrapper
 * and breaks distributive conditionals (`ExtractEvent`) and discriminated
 * object-literal checks, so it is not used anywhere in this module.
 */
export type DoNotInfer<T> = [T][T extends any ? 0 : any];

/**
 * `T | unknown` collapses to `unknown` and kills contextual typing of function
 * members in the union. This union covers the same value space as `unknown`
 * without collapsing (same trick as XState's `NonReducibleUnknown`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` is the point: any non-nullish value without collapsing the union
export type NonReducibleUnknown = {} | null | undefined;

/**
 * Read-only view of a deep-frozen value: plain objects and arrays become
 * read-only all the way down, functions (including the builtin creators,
 * which are functions) and primitives are left as they are. Mirrors what
 * `deepFreeze` does at runtime to `MachineDefinition.config`.
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer U)[]
      ? readonly DeepReadonly<U>[]
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;
