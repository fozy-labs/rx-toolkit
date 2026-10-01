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

// The inference helpers (`DoNotInfer`, `NonReducibleUnknown`, `SingleOrArray`,
// `DeepReadonly`) are module-local in each file that uses them: an exported helper the
// package root leaves out gets a non-portable file-path reference in a consumer's
// declaration (TS2742), while a module-local one is inlined — see `types/index.ts`.
