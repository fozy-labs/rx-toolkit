import type { StateValue } from "@fozy-labs/rx-toolkit";
import type { Observable } from "rxjs";

/**
 * XState-style state value, the library's type: `"off"`, `{ working: "green" }`,
 * `{ p: { $0: "a", $1: "c" } }`. Map values may be `undefined`.
 */
export type { StateValue };

/**
 * A guard or an action as a machine config may carry it: an implementation
 * name, a `{ type }` reference, an inline function or a builtin (`and()`,
 * `assign()`, ... — functions carrying their `type`). `implementationName`
 * in `core/configWalk` names it for display.
 */
export type ImplementationLike = string | { readonly type: string } | ((...args: never[]) => unknown);

export type GuardLike = ImplementationLike;

export type ActionLike = ImplementationLike;

export type ActionsLike = ActionLike | readonly ActionLike[];

/** A target key / id, or several of them (parallel regions). */
export type TransitionTargetLike = string | readonly string[];

/** One transition of a config: a bare target, an object, or a hole in a candidate list. */
export type TransitionLike =
    | string
    | undefined
    | {
          readonly target?: TransitionTargetLike;
          readonly guard?: GuardLike;
          readonly actions?: ActionsLike;
      };

/** A transition or the candidates of one trigger in source order. */
export type TransitionListLike = TransitionLike | readonly TransitionLike[];

export type StatesLike = { readonly [key: string]: StateNodeLike };

/**
 * The read-only, loosely typed view of a state node the viz walks. The real
 * `definition.config` of the library (deep-frozen `MachineConfig`) and the
 * converter's JSON config both satisfy it; the viz reads only these keys.
 */
export type StateNodeLike = {
    readonly type?: string;
    readonly description?: string;
    readonly initial?: string;
    readonly on?: { readonly [event: string]: TransitionListLike };
    readonly after?: { readonly [delay: string]: TransitionListLike };
    readonly always?: TransitionListLike;
    readonly onDone?: TransitionListLike;
    readonly states?: StatesLike;
};

/** The root of the config: `id`, `initial` and `states` are optional in the library's `MachineConfig`. */
export type MachineConfigLike = {
    readonly id?: string;
    readonly source?: string;
    readonly initial?: string;
    readonly states?: StatesLike;
};

/** Snapshot shape read from the machine. */
export type VizSnapshot<TContext = unknown> = {
    status: string;
    value: StateValue;
    context: TContext;
};

/** Minimal event shape accepted by the machine. */
export type VizEvent = { type: string };

/**
 * Structural subset of the library's `MachineStateSignal`: `MachineSignal.state(definition)`
 * is assignable to it without casts (`src/__tests__/vizMachine.types.test.tsx`);
 * `createFakeVizMachine` in `src/testing/` is the test double.
 */
export interface VizMachine<TContext = unknown, TEvent extends VizEvent = VizEvent> {
    (): VizSnapshot<TContext>;
    readonly obs: Observable<VizSnapshot<TContext>>;
    readonly definition: {
        readonly id: string;
        readonly source?: string;
        readonly config: MachineConfigLike;
        toMermaid(): string;
    };
    send(event: TEvent): void;
    can(event: TEvent): boolean;
    matches(value: StateValue): boolean;
}

/** A machine created by the `source` mode pipeline: a `VizMachine` its owner must dispose. */
export interface DisposableVizMachine<TContext = unknown, TEvent extends VizEvent = VizEvent> extends VizMachine<
    TContext,
    TEvent
> {
    dispose(): void;
}

/** Props of `StatechartViz`: a running machine or raw `.mmd` text. */
export type StatechartVizProps =
    | { machine: VizMachine; title?: string }
    | {
          source: string;
          title?: string;
          /**
           * Receives the machine created from `source` once the pipeline
           * succeeded, and `null` when that machine is disposed (source
           * change, unmount). Drive or inspect the machine from outside; the
           * viz stays its owner.
           */
          onMachine?: (machine: DisposableVizMachine | null) => void;
      };
