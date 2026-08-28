/**
 * Public type surface of the statechart module (re-exported from the package
 * root). Inference helpers (`DoNotInfer`, `NonReducibleUnknown`,
 * `SingleOrArray`) and the `BUILTIN` brand stay module-internal: they are
 * reachable through the types that use them but are not package-level API.
 */
export * from "./actions";
export type { MachineContext, MetaObject } from "./common";
export * from "./config";
export * from "./events";
export * from "./guards";
export * from "./implementations";
export * from "./statechart";
export * from "./stateValue";
