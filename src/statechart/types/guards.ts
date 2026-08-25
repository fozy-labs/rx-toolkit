import type { ActionArgs, BuiltinCallable, DynamicParams } from "./actions";
import { BUILTIN } from "./brand";
import type { MachineContext, NonReducibleUnknown } from "./common";
import type { EventObject } from "./events";
import type { StateValue } from "./stateValue";

/** Guards receive the same `{ context, event }` object as actions. */
export type GuardArgs<TContext extends MachineContext, TExpressionEvent extends EventObject> = ActionArgs<
    TContext,
    TExpressionEvent
>;

/**
 * A custom guard: inline in the config (`TParams` = `undefined`) or referenced
 * by name through `implementations.guards`.
 */
export type GuardPredicate<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams = unknown> = (
    args: GuardArgs<TContext, TExpressionEvent>,
    params: TParams,
) => boolean;

/** `{ type: "name", params?: ... }` reference to a guard of the implementation table. */
export interface GuardObject<TContext extends MachineContext, TExpressionEvent extends EventObject> {
    type: string;
    params?: DynamicParams<TContext, TExpressionEvent, NonReducibleUnknown>;
}

// --- builtin guards --------------------------------------------------------
// `TParams` is inferred from the slot (see `BuiltinCallable`), never written.

export interface AndGuard<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "and";
    readonly type: "xstate.and";
    readonly guards: readonly Guard<TContext, TExpressionEvent>[];
}

export interface OrGuard<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "or";
    readonly type: "xstate.or";
    readonly guards: readonly Guard<TContext, TExpressionEvent>[];
}

export interface NotGuard<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "not";
    readonly type: "xstate.not";
    readonly guard: Guard<TContext, TExpressionEvent>;
}

/**
 * `stateIn("#id")` / `stateIn({ a: "b" })`: true when the machine is in the
 * given state. An `#id` string checks node membership; anything else uses
 * `matches()` semantics against the current state value.
 */
export interface StateInGuard<
    TContext extends MachineContext = MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
> extends BuiltinCallable<TContext, TExpressionEvent, TParams> {
    readonly [BUILTIN]: "stateIn";
    readonly type: "xstate.stateIn";
    readonly stateValue: StateValue;
}

export type BuiltinGuard<TContext extends MachineContext, TExpressionEvent extends EventObject, TParams = undefined> =
    | AndGuard<TContext, TExpressionEvent, TParams>
    | OrGuard<TContext, TExpressionEvent, TParams>
    | NotGuard<TContext, TExpressionEvent, TParams>
    | StateInGuard<TContext, TExpressionEvent, TParams>;

/**
 * Everything accepted as a transition `guard`: a name, a `{ type, params }`
 * reference, an inline predicate or a builtin combinator.
 */
export type Guard<TContext extends MachineContext, TExpressionEvent extends EventObject> =
    | string
    | GuardObject<TContext, TExpressionEvent>
    | GuardPredicate<TContext, TExpressionEvent, undefined>
    | BuiltinGuard<TContext, TExpressionEvent, undefined>;
