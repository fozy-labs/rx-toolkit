import type { ActionFunction, BuiltinAction, DelayExpr } from "./actions";
import type { MachineContext } from "./common";
import type { EventObject } from "./events";
import type { BuiltinGuard, GuardPredicate } from "./guards";

/**
 * Params of a referenced implementation are untyped at this level (they come
 * from `{ type, params }` objects in the config). Declare the parameter
 * explicitly when you need it: `(args, params: { level: number }) => ...`.
 * `never` accepts any declared parameter type without an `any` leak.
 */
export type ImplementationParams = never;

/**
 * Function slots of the tables are bivariant in their arguments (method
 * syntax): an implementation may type `event` narrower than the machine's
 * event union. Generated code relies on it — the converter narrows the event
 * of a guard / action / delay to the events whose transitions reference it.
 * TypeScript does not check that the narrowing fits the config.
 */
type Bivariant<TArgs extends unknown[], TResult> = { bivarianceHack(...args: TArgs): TResult }["bivarianceHack"];

export type ActionImplementation<TContext extends MachineContext, TEvent extends EventObject> =
    | Bivariant<Parameters<ActionFunction<TContext, TEvent, ImplementationParams>>, void>
    | BuiltinAction<TContext, TEvent, TEvent, ImplementationParams>;

export type GuardImplementation<TContext extends MachineContext, TEvent extends EventObject> =
    | Bivariant<Parameters<GuardPredicate<TContext, TEvent, ImplementationParams>>, boolean>
    | BuiltinGuard<TContext, TEvent, ImplementationParams>;

export type DelayImplementation<TContext extends MachineContext, TEvent extends EventObject> =
    number | Bivariant<Parameters<DelayExpr<TContext, TEvent, ImplementationParams>>, number>;

/** Second argument of `createMachine` and argument of `definition.provide()`. */
export interface MachineImplementations<TContext extends MachineContext, TEvent extends EventObject> {
    actions?: Record<string, ActionImplementation<TContext, TEvent>>;
    guards?: Record<string, GuardImplementation<TContext, TEvent>>;
    delays?: Record<string, DelayImplementation<TContext, TEvent>>;
}

/** `definition.implementations`: every table present (possibly empty) and frozen. */
export interface ResolvedMachineImplementations<TContext extends MachineContext, TEvent extends EventObject> {
    readonly actions: Readonly<Record<string, ActionImplementation<TContext, TEvent>>>;
    readonly guards: Readonly<Record<string, GuardImplementation<TContext, TEvent>>>;
    readonly delays: Readonly<Record<string, DelayImplementation<TContext, TEvent>>>;
}
