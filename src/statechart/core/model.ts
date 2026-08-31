/**
 * Normalized internal model produced by `normalize(config)` and consumed by the
 * interpreter, the exporters and the devtools. Everything here is immutable
 * after normalization; nodes reference each other directly (no ids to look
 * up during a step). See `.tmp/statechart-impl-spec.md`, section 2.
 */
import type {
    Action,
    ContextFactory,
    DoneStateEvent,
    EventObject,
    Guard,
    HistoryType,
    MachineConfig,
    MachineContext,
    Mapper,
    MetaObject,
    SnapshotStatus,
    StateNodeConfig,
    StateNodeType,
} from "../types";
import type { NonReducibleUnknown } from "../types/common";

/** Any event an action of the model may observe (user events plus system events). */
export type ModelEvent<TEvent extends EventObject> = TEvent | EventObject;

/** Actions as stored in the model: the raw config value, already validated. */
export type ModelAction<TContext extends MachineContext, TEvent extends EventObject> = Action<
    TContext,
    ModelEvent<TEvent>,
    TEvent
>;

/** Guards as stored in the model: the raw config value, already validated. */
export type ModelGuard<TContext extends MachineContext, TEvent extends EventObject> = Guard<
    TContext,
    ModelEvent<TEvent>
>;

/** `output` of a final state or of the root: a mapper or a static value. */
export type OutputResolver<TContext extends MachineContext> =
    Mapper<TContext, ModelEvent<EventObject> | DoneStateEvent, NonReducibleUnknown> | NonReducibleUnknown;

export interface Transition<TContext extends MachineContext, TEvent extends EventObject> {
    readonly source: StateNode<TContext, TEvent>;
    /**
     * Resolved target nodes; `null` for targetless transitions (actions only,
     * no exit/entry). History nodes may appear here and are resolved at step
     * time against `MachineState.historyValue`.
     */
    readonly target: readonly StateNode<TContext, TEvent>[] | null;
    readonly actions: readonly ModelAction<TContext, TEvent>[];
    readonly guard: ModelGuard<TContext, TEvent> | null;
    readonly reenter: boolean;
    /**
     * The `on` descriptor (`"TIMER"`, `"*"`, `"user.*"`), a system event type
     * (`"xstate.done.state.<id>"`, `"xstate.after.<delay>.<id>"`),
     * `NULL_EVENT` (`""`) for `always`, or `null` for initial / synthetic
     * transitions.
     */
    readonly eventType: string | null;
    /** The `after` key this transition came from; `null` otherwise. */
    readonly delay: number | string | null;
    readonly description: string | undefined;
    readonly meta: MetaObject | undefined;
    /** Config path for diagnostics: `"states.a.on.E[1]"`, `"states.a.always[0]"`, `"states.a.after.3000[0]"`, `"states.a.onDone[0]"`. */
    readonly configPath: string;
}

/** The implicit transition into a compound state's `initial` child. */
export interface InitialTransition<TContext extends MachineContext, TEvent extends EventObject> extends Transition<
    TContext,
    TEvent
> {
    readonly target: readonly [StateNode<TContext, TEvent>];
    readonly guard: null;
    readonly reenter: false;
    readonly eventType: null;
    readonly delay: null;
}

export interface StateNode<TContext extends MachineContext, TEvent extends EventObject> {
    /** `config.id`, or `<machineId>.<path>` joined with `"."`; the root's id is the machine id. */
    readonly id: string;
    /** Key under the parent's `states`; the machine id for the root. */
    readonly key: string;
    /** Keys from the root down to this node (`[]` for the root). */
    readonly path: readonly string[];
    readonly type: StateNodeType;
    /** Document order (depth-first, root = 0). Drives exit/entry ordering. */
    readonly order: number;
    readonly parent: StateNode<TContext, TEvent> | null;
    /** Children in document order, history nodes included. */
    readonly children: readonly StateNode<TContext, TEvent>[];
    readonly childrenByKey: ReadonlyMap<string, StateNode<TContext, TEvent>>;
    /** Compound nodes only. */
    readonly initial: InitialTransition<TContext, TEvent> | null;
    /**
     * Candidates per event descriptor: `on` entries plus the synthesized
     * `xstate.done.state.<id>` (from `onDone`) and `xstate.after.<delay>.<id>`
     * (from `after`) descriptors. Array order = config order (first enabled wins).
     */
    readonly transitions: ReadonlyMap<string, readonly Transition<TContext, TEvent>[]>;
    readonly always: readonly Transition<TContext, TEvent>[];
    /** `after` transitions, also present in `transitions` under their event type. */
    readonly after: readonly Transition<TContext, TEvent>[];
    /**
     * `config.entry` followed by one `raise(afterEvent, { delay, id: afterEventType })`
     * per `after` key (mirrors XState `getDelayedTransitions`).
     */
    readonly entry: readonly ModelAction<TContext, TEvent>[];
    /** `config.exit` followed by one `cancel(afterEventType)` per `after` key. */
    readonly exit: readonly ModelAction<TContext, TEvent>[];
    /** History nodes only. */
    readonly history: HistoryType | null;
    /** Resolved `config.target` of a history node; `null` when absent (parent's initial / the parent itself for parallel). */
    readonly historyTarget: readonly StateNode<TContext, TEvent>[] | null;
    /** Final nodes and the root only; `undefined` otherwise. */
    readonly output: OutputResolver<TContext> | undefined;
    readonly tags: readonly string[];
    readonly meta: MetaObject | undefined;
    readonly description: string | undefined;
    /** The raw (frozen) config of this node. */
    readonly config: StateNodeConfig<TContext, TEvent>;
    /** `""` for the root, `"states.a.states.b"` below. */
    readonly configPath: string;
}

/** Names referenced by the config, checked against the implementation table by `Statechart`. */
export interface ModelReferences {
    readonly actions: ReadonlySet<string>;
    readonly guards: ReadonlySet<string>;
    readonly delays: ReadonlySet<string>;
}

export interface MachineModel<TContext extends MachineContext, TEvent extends EventObject> {
    readonly id: string;
    readonly root: StateNode<TContext, TEvent>;
    /** Every node in document order; `nodes[i].order === i`. */
    readonly nodes: readonly StateNode<TContext, TEvent>[];
    readonly idMap: ReadonlyMap<string, StateNode<TContext, TEvent>>;
    /** Always a factory: an object `context` is wrapped in `() => context`. */
    readonly context: ContextFactory<TContext>;
    readonly references: ModelReferences;
    readonly config: MachineConfig<TContext, TEvent>;
}

/**
 * The immutable value the pure interpreter steps over. `configuration` holds
 * every active node including the root and all ancestors (XState `_nodes`).
 * A step that changes nothing returns the very same object.
 */
export interface MachineState<TContext extends MachineContext, TEvent extends EventObject> {
    readonly configuration: ReadonlySet<StateNode<TContext, TEvent>>;
    readonly context: TContext;
    /** History node id → nodes recorded when the history's parent was last exited. */
    readonly historyValue: Readonly<Record<string, readonly StateNode<TContext, TEvent>[]>>;
    readonly status: SnapshotStatus;
    readonly output: unknown;
    readonly error: unknown;
}
