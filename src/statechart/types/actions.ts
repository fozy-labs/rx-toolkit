import { BUILTIN } from "./brand";
import type { MachineContext, NonReducibleUnknown, SingleOrArray } from "./common";
import type { EventObject } from "./events";

/** The argument object passed to every action, guard, delay and output function. */
export interface ActionArgs<TContext extends MachineContext, TExpressionEvent extends EventObject> {
    context: TContext;
    event: TExpressionEvent;
}

/**
 * A custom action: inline in the config (`TParams` = `undefined`) or referenced
 * by name through `implementations.actions` (`TParams` is whatever the
 * `{ type, params }` reference resolved to).
 */
export type ActionFunction<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams = unknown> = (
    args: ActionArgs<TContext, TExpressionEvent>,
    params: TParams,
) => void;

/**
 * Call signature carried by every builtin action / guard object. Builtins are
 * declarative: calling one throws. The signature exists for type inference
 * only, in two ways (both borrowed from XState):
 *
 * - TypeScript defers inference of a nested generic call (`assign(...)`
 *   inside `createMachine({...})`) only when the callee returns a function
 *   type; with a plain-object return `TContext` / `TEvent` would be fixed to
 *   their defaults before the outer call is inferred.
 * - An inline arrow next to a builtin in a union slot is contextually typed
 *   only when every callable member of the union has an identical parameter
 *   list, so `TParams` must match the slot (`undefined` in configs, `never`
 *   in implementation tables) — it is inferred from the slot, never written.
 */
export interface BuiltinCallable<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams> {
    (args: ActionArgs<TContext, TExpressionEvent>, params: TParams): never;
}

/** Static params or a function computing them from `{ context, event }`. */
export type DynamicParams<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams> =
    | TParams
    | ((args: ActionArgs<TContext, TExpressionEvent>) => TParams);

/** `{ type: "name", params?: ... }` reference to an action of the implementation table. */
export interface ActionObject<TContext extends MachineContext, TExpressionEvent extends EventObject> {
    type: string;
    params?: DynamicParams<TContext, TExpressionEvent, NonReducibleUnknown>;
}

// --- builtin actions -------------------------------------------------------

export type Assigner<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams = unknown> = (
    args: ActionArgs<TContext, TExpressionEvent>,
    params: TParams,
) => Partial<TContext>;

export type PropertyAssigner<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = unknown,
> = {
    [K in keyof TContext]?:
        | TContext[K]
        | ((args: ActionArgs<TContext, TExpressionEvent>, params: TParams) => TContext[K]);
};

/** Produced by `assign()`. Applied by the interpreter core (shallow merge, XState semantics). */
export interface AssignAction<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "assign";
    readonly type: "xstate.assign";
    readonly assignment:
        | Assigner<TContext, TExpressionEvent, TParams>
        | PropertyAssigner<TContext, TExpressionEvent, TParams>;
}

export type SendExpr<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TSentEvent extends EventObject,
    TParams = unknown,
> = (args: ActionArgs<TContext, TExpressionEvent>, params: TParams) => TSentEvent;

export type DelayExpr<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams = unknown> = (
    args: ActionArgs<TContext, TExpressionEvent>,
    params: TParams,
) => number;

export interface RaiseActionOptions<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = unknown,
> {
    /** Identifier for `cancel(id)`. Defaults to an internal unique id. */
    id?: string;
    /** Milliseconds, a named delay from `implementations.delays`, or a function computing milliseconds. */
    delay?: number | string | DelayExpr<TContext, TExpressionEvent, TParams>;
}

/**
 * Produced by `raise()`. Without `delay` the event goes to the internal queue
 * of the running macrostep; with `delay` it is scheduled through the executor.
 */
export interface RaiseAction<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "raise";
    readonly type: "xstate.raise";
    readonly event: TEvent | SendExpr<TContext, TExpressionEvent, TEvent, TParams>;
    readonly id: string | undefined;
    readonly delay: number | string | DelayExpr<TContext, TExpressionEvent, TParams> | undefined;
}

/** Produced by `cancel()`. Drops a pending delayed `raise` / `after` timer by id. */
export interface CancelAction<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "cancel";
    readonly type: "xstate.cancel";
    readonly sendId: string | ((args: ActionArgs<TContext, TExpressionEvent>, params: TParams) => string);
}

export type LogExpr<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams = unknown> = (
    args: ActionArgs<TContext, TExpressionEvent>,
    params: TParams,
) => unknown;

/** Produced by `log()`. Delegated to the executor's `log` (default `console.log`). */
export interface LogAction<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "log";
    readonly type: "xstate.log";
    readonly value: NonReducibleUnknown | LogExpr<TContext, TExpressionEvent, TParams>;
    readonly label: string | undefined;
}

/**
 * Recipe of `mutate()`: `context` arrives as an Immer draft, the return
 * value is ignored. Declared with method syntax so that the arguments are
 * bivariant: an implementation may type `event` narrower than the machine's
 * event union (generated code narrows it to the events whose transitions
 * reference the action; the config, not TypeScript, guarantees the fit).
 */
export type MutateRecipe<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams = unknown> = {
    bivarianceHack(args: ActionArgs<TContext, TExpressionEvent>, params: TParams): void;
}["bivarianceHack"];

/**
 * Produced by `mutate()`. Applied by the interpreter core: the next context is
 * `produce(context, recipe)` — structurally shared with the previous one,
 * which is never mutated. Not an XState builtin (`type` says so).
 */
export interface MutateAction<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "mutate";
    readonly type: "rx-toolkit.mutate";
    readonly recipe: MutateRecipe<TContext, TExpressionEvent, TParams>;
}

export type BuiltinAction<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TEvent extends EventObject,
    TParams = undefined,
> =
    | AssignAction<TContext, TExpressionEvent, TParams>
    | MutateAction<TContext, TExpressionEvent, TParams>
    | RaiseAction<TContext, TExpressionEvent, TEvent, TParams>
    | CancelAction<TContext, TExpressionEvent, TParams>
    | LogAction<TContext, TExpressionEvent, TParams>;

/**
 * Everything accepted in `entry`, `exit` and transition `actions`:
 * a name, a `{ type, params }` reference, an inline function or a builtin.
 */
export type Action<TContext extends MachineContext, TExpressionEvent extends EventObject, TEvent extends EventObject> =
    | string
    | ActionObject<TContext, TExpressionEvent>
    | ActionFunction<TContext, TExpressionEvent, undefined>
    | BuiltinAction<TContext, TExpressionEvent, TEvent, undefined>;

export type Actions<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TEvent extends EventObject,
> = SingleOrArray<Action<TContext, TExpressionEvent, TEvent>>;
