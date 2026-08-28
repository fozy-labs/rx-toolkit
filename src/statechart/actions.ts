import { createBuiltin } from "./core/createBuiltin";
import type {
    AssignAction,
    Assigner,
    CancelAction,
    EventObject,
    LogAction,
    LogExpr,
    MachineContext,
    MutateAction,
    MutateRecipe,
    PropertyAssigner,
    RaiseAction,
    RaiseActionOptions,
    SendExpr,
} from "./types";
import type { DoNotInfer, NonReducibleUnknown } from "./types/common";

/**
 * Builtin action creators. Like XState they return frozen *functions* (named
 * `assign` / `mutate` / `raise` / `cancel` / `log`) carrying the `BUILTIN`
 * brand and their payload; calling one throws. The interpreter core applies
 * `assign` and `mutate` itself and routes `raise` / `cancel` / `log` through
 * the executor.
 *
 * All parameters are `DoNotInfer`: the generics (including `TParams`) are
 * inferred from the contextual type — the `actions` slot of a typed config or
 * implementation table — not from the argument. Same approach as XState.
 */

/** Updates the context: a partial object, or a function of `{ context, event }` returning a partial. */
export function assign<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(
    assignment:
        | Assigner<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>, DoNotInfer<TParams>>
        | PropertyAssigner<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>, DoNotInfer<TParams>>,
): AssignAction<TContext, TExpressionEvent, TParams> {
    return createBuiltin<AssignAction<TContext, TExpressionEvent, TParams>>("assign", "assign", "xstate.assign", {
        assignment,
    });
}

/**
 * Updates the context through an Immer draft: the recipe mutates `context`
 * in place and the produced next context replaces the current one (the
 * previous object is untouched; unchanged subtrees are shared). The recipe's
 * return value is ignored. Plain objects and arrays are drafted; other values
 * (`Map`, `Set`, class instances) are handed over as they are.
 *
 * Not an XState builtin: the converter emits it for `@action` bodies, and
 * `toXStateSource()` imports it from this package.
 */
export function mutate<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(
    recipe: MutateRecipe<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>, DoNotInfer<TParams>>,
): MutateAction<TContext, TExpressionEvent, TParams> {
    return createBuiltin<MutateAction<TContext, TExpressionEvent, TParams>>("mutate", "mutate", "rx-toolkit.mutate", {
        recipe,
    });
}

/**
 * Raises an event to the machine itself. Immediate (internal queue of the
 * current macrostep) unless `options.delay` is given.
 */
export function raise<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TEvent extends EventObject = EventObject,
    TParams = undefined,
>(
    eventOrExpr:
        | DoNotInfer<TEvent>
        | SendExpr<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>, DoNotInfer<TEvent>, DoNotInfer<TParams>>,
    options?: RaiseActionOptions<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>, DoNotInfer<TParams>>,
): RaiseAction<TContext, TExpressionEvent, TEvent, TParams> {
    return createBuiltin<RaiseAction<TContext, TExpressionEvent, TEvent, TParams>>("raise", "raise", "xstate.raise", {
        event: eventOrExpr,
        id: options?.id,
        delay: options?.delay,
    });
}

/** Cancels a pending delayed `raise` (or an `after` timer by its event type). */
export function cancel<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(
    sendId: CancelAction<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>, DoNotInfer<TParams>>["sendId"],
): CancelAction<TContext, TExpressionEvent, TParams> {
    return createBuiltin<CancelAction<TContext, TExpressionEvent, TParams>>("cancel", "cancel", "xstate.cancel", {
        sendId,
    });
}

/** Logs a value (or the result of an expression) through the engine's logger. */
export function log<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(
    value?: NonReducibleUnknown | LogExpr<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>, DoNotInfer<TParams>>,
    label?: string,
): LogAction<TContext, TExpressionEvent, TParams> {
    const resolvedValue: LogAction<TContext, TExpressionEvent, TParams>["value"] =
        value === undefined ? ({ context, event }) => ({ context, event }) : value;
    return createBuiltin<LogAction<TContext, TExpressionEvent, TParams>>("log", "log", "xstate.log", {
        value: resolvedValue,
        label,
    });
}
