/**
 * Public type surface of the statechart module (re-exported from the package
 * root). Inference helpers (`DoNotInfer`, `NonReducibleUnknown`, `SingleOrArray`,
 * `DeepReadonly`) and the `BUILTIN` brand are not package-level API: each is
 * module-local in the file that uses it, so a consumer's declaration inlines it
 * (an exported helper the root leaves out gets a non-portable file-path
 * reference, TS2742). `declarations.test.ts` checks this rule for the module.
 */
export * from "./actions";
export type { MachineContext, MetaObject } from "./common";
export * from "./config";
export * from "./events";
export * from "./guards";
export * from "./implementations";
export * from "./statechart";
export * from "./stateValue";
