import type { Actions } from "./actions";
import type { MachineContext, MetaObject } from "./common";
import type { DoneStateEvent, EventDescriptor, EventObject, ExtractEvent } from "./events";
import type { Guard } from "./guards";

// Inference helpers are module-local in every file that uses them: a consumer's
// declaration inlines them, while an exported helper the root leaves out gets a
// non-portable file-path reference (TS2742) — see `types/index.ts`.

/**
 * Blocks inference without wrapping the type (the native `NoInfer` survives
 * instantiation as a wrapper and breaks distributive conditionals and discriminated
 * object-literal checks in this module).
 */
type DoNotInfer<T> = [T][T extends any ? 0 : any];

/** `T | unknown` collapses to `unknown` and kills contextual typing; this union covers the same value space without collapsing. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- `{}` is the point: any non-nullish value without collapsing the union
type NonReducibleUnknown = {} | null | undefined;

type SingleOrArray<T> = readonly T[] | T;

export type StateNodeType = "atomic" | "compound" | "parallel" | "final" | "history";

export type HistoryType = "shallow" | "deep";

/** A function of `{ context, event }` producing `output` of a final state / the machine. */
export type Mapper<TContext extends MachineContext, TExpressionEvent extends EventObject, TResult> = (args: {
    context: TContext;
    event: TExpressionEvent;
}) => TResult;

/** `"sibling"`, `"#id"`, `"#id.child.path"`, `".child"` or several of them (parallel regions only). */
export type TransitionTarget = SingleOrArray<string>;

export interface TransitionConfig<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TEvent extends EventObject,
> {
    target?: TransitionTarget | undefined;
    actions?: Actions<TContext, TExpressionEvent, TEvent>;
    guard?: Guard<TContext, TExpressionEvent>;
    /** Exit and re-enter the source state even when the target is a descendant. @default false */
    reenter?: boolean;
    description?: string;
    meta?: MetaObject;
}

/** A target string, a transition object, or an array of those (first enabled wins). */
export type TransitionConfigOrTarget<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TEvent extends EventObject,
> = SingleOrArray<string | undefined | TransitionConfig<TContext, TExpressionEvent, TEvent>>;

export type TransitionsConfig<TContext extends MachineContext, TEvent extends EventObject> = {
    [K in EventDescriptor<TEvent>]?: TransitionConfigOrTarget<TContext, ExtractEvent<TEvent, K>, TEvent>;
};

/** Keys are milliseconds or named delays resolved through `implementations.delays`. */
export type DelayedTransitions<TContext extends MachineContext, TEvent extends EventObject> = {
    [delay: string | number]: string | SingleOrArray<TransitionConfig<TContext, TEvent, TEvent>> | undefined;
};

export interface StateNodeConfig<TContext extends MachineContext, TEvent extends EventObject> {
    /** Unique id, referenced by `#id` targets. Defaults to `<machineId>.<path>`. */
    id?: string;
    /** Inferred from `states` / `history` when omitted. */
    type?: StateNodeType;
    /** Key of the initial child (compound states). */
    initial?: string;
    states?: StatesConfig<TContext, TEvent>;
    on?: TransitionsConfig<TContext, TEvent>;
    /** Eventless transitions, re-evaluated after every microstep. */
    always?: TransitionConfigOrTarget<TContext, TEvent, TEvent>;
    after?: DelayedTransitions<TContext, TEvent>;
    entry?: Actions<TContext, TEvent, TEvent>;
    exit?: Actions<TContext, TEvent, TEvent>;
    /** Taken when a final child (compound) / every region (parallel) is reached. */
    onDone?: string | SingleOrArray<TransitionConfig<TContext, DoneStateEvent, TEvent>>;
    /** History pseudo-state kind; `true` means `"shallow"`. */
    history?: HistoryType | true;
    /** Default target of a history state when no history was recorded. */
    target?: string;
    /** Output of a final state (goes into `xstate.done.state.*` and the machine output). */
    output?: Mapper<TContext, TEvent, NonReducibleUnknown> | NonReducibleUnknown;
    tags?: SingleOrArray<string>;
    description?: string;
    meta?: MetaObject;
}

export type StatesConfig<TContext extends MachineContext, TEvent extends EventObject> = {
    [key: string]: StateNodeConfig<TContext, TEvent>;
};

/**
 * XState v5 typegen-free idiom: `types: { context: {} as Ctx, events: {} as Ev }`.
 * Ignored at runtime, used only for inference.
 */
export interface MachineTypes<TContext extends MachineContext, TEvent extends EventObject, TOutput> {
    context?: TContext;
    events?: TEvent;
    output?: TOutput;
    tags?: string;
    meta?: MetaObject;
}

export type ContextFactory<TContext extends MachineContext> = () => TContext;

type RootStateNodeConfig<TContext extends MachineContext, TEvent extends EventObject> = Omit<
    StateNodeConfig<TContext, TEvent>,
    "output" | "history" | "target"
>;

/**
 * The root config accepted by `createMachine`. `context` is optional only when
 * `TContext` is the unconstrained `MachineContext`.
 */
export type MachineConfig<
    TContext extends MachineContext,
    TEvent extends EventObject,
    TOutput = unknown,
> = RootStateNodeConfig<DoNotInfer<TContext>, DoNotInfer<TEvent>> & {
    types?: MachineTypes<TContext, TEvent, TOutput>;
    /** Machine output, resolved from the `xstate.done.state.*` event of the top-level final state. */
    output?: Mapper<TContext, DoneStateEvent, TOutput> | TOutput;
    /**
     * Verbatim text of the `.mmd` file the machine was generated from
     * (`definition.source`). Not interpreted; the viz renders it instead of
     * `toMermaid()`, `toXStateSource()` drops it.
     */
    source?: string;
} & (MachineContext extends TContext
        ? { context?: TContext | ContextFactory<TContext> }
        : { context: TContext | ContextFactory<TContext> });
