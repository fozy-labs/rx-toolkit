/**
 * Brand attached to every builtin action / guard object produced by `assign`,
 * `raise`, `cancel`, `log`, `and`, `or`, `not`, `stateIn`. A global symbol so
 * that two copies of the package (or the differential test harness) agree on
 * what a builtin is.
 */
export const BUILTIN: unique symbol = Symbol.for("@fozy-labs/rx-toolkit/statechart/builtin");

export type BuiltinBrand = typeof BUILTIN;
