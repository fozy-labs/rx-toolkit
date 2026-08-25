import type { MachineContext } from "./common";

export interface StateValueMap {
    [key: string]: StateValue | undefined;
}

/**
 * The string or object representing the active state(s) relative to the
 * machine root: `"green"`, `{ red: "wait" }`, `{ a: "x", b: { c: "y" } }`
 * (parallel). Mirrors XState's `StateValue`.
 */
export type StateValue = string | StateValueMap;

export type SnapshotStatus = "active" | "done" | "error" | "stopped";

interface MachineSnapshotBase<TContext extends MachineContext> {
    /** The current state value, computed from the active state nodes. */
    readonly value: StateValue;
    /** The current extended state. */
    readonly context: TContext;
    /** Tags of every active state node (deduplicated, document order). */
    readonly tags: readonly string[];
}

export interface ActiveMachineSnapshot<TContext extends MachineContext> extends MachineSnapshotBase<TContext> {
    readonly status: "active";
    readonly output: undefined;
    readonly error: undefined;
}

export interface DoneMachineSnapshot<TContext extends MachineContext, TOutput> extends MachineSnapshotBase<TContext> {
    readonly status: "done";
    readonly output: TOutput;
    readonly error: undefined;
}

export interface ErrorMachineSnapshot<TContext extends MachineContext> extends MachineSnapshotBase<TContext> {
    readonly status: "error";
    readonly output: undefined;
    readonly error: unknown;
}

export interface StoppedMachineSnapshot<TContext extends MachineContext> extends MachineSnapshotBase<TContext> {
    readonly status: "stopped";
    readonly output: undefined;
    readonly error: undefined;
}

/**
 * The public, immutable value held by `Statechart.state`. A new object per
 * macrostep that changed something; `Object.is`-stable otherwise. All keys are
 * always present (`output`/`error` are `undefined` unless the status says so),
 * so the object is a proper discriminated union on `status`.
 */
export type MachineSnapshot<TContext extends MachineContext, TOutput = unknown> =
    | ActiveMachineSnapshot<TContext>
    | DoneMachineSnapshot<TContext, TOutput>
    | ErrorMachineSnapshot<TContext>
    | StoppedMachineSnapshot<TContext>;
