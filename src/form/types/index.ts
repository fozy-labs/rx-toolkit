/**
 * Public type surface of the forms module, re-exported from the package root: the vocabulary a
 * user writes and every type a consumer's declaration may have to name.
 *
 * A type file exports exactly what the package publishes. A consumer's declaration names an
 * exported type by the module that exports it, and the package exports only its root, so an
 * exported type the root leaves out cannot be named (TS2742). Type-level machinery (inference
 * helpers, checks and the error strings they show) is therefore module-local in the file that
 * uses it, where a consumer's declaration inlines it. `declarations.test.ts` checks both rules.
 */
export * from "./common";
export * from "./context";
export * from "./definition";
export * from "./infer";
export * from "./issue";
export * from "./node";
export * from "./plugin";
export * from "./query";
