import { createBuiltin } from "./core/createBuiltin";
import type {
    AndGuard,
    EventObject,
    Guard,
    MachineContext,
    NotGuard,
    OrGuard,
    StateInGuard,
    StateValue,
} from "./types";
import type { DoNotInfer } from "./types/common";

/**
 * Builtin guard combinators. Like XState they return frozen *functions* (named
 * `and` / `or` / `not` / `stateIn`) carrying the `BUILTIN` brand; calling one
 * throws. The interpreter evaluates them structurally. Parameters are
 * `DoNotInfer` so the generics (including `TParams`) come from the contextual
 * `guard` slot.
 */

export function and<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(
    guards: readonly Guard<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>>[],
): AndGuard<TContext, TExpressionEvent, TParams> {
    return createBuiltin<AndGuard<TContext, TExpressionEvent, TParams>>("and", "and", "xstate.and", {
        guards: Object.freeze([...guards]),
    });
}

export function or<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(
    guards: readonly Guard<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>>[],
): OrGuard<TContext, TExpressionEvent, TParams> {
    return createBuiltin<OrGuard<TContext, TExpressionEvent, TParams>>("or", "or", "xstate.or", {
        guards: Object.freeze([...guards]),
    });
}

export function not<
    TContext extends MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(guard: Guard<DoNotInfer<TContext>, DoNotInfer<TExpressionEvent>>): NotGuard<TContext, TExpressionEvent, TParams> {
    return createBuiltin<NotGuard<TContext, TExpressionEvent, TParams>>("not", "not", "xstate.not", { guard });
}

/** True when the machine is in `stateValue` (`"#id"` checks node membership, anything else uses `matches()`). */
export function stateIn<
    TContext extends MachineContext = MachineContext,
    TExpressionEvent extends EventObject = EventObject,
    TParams = undefined,
>(stateValue: StateValue): StateInGuard<TContext, TExpressionEvent, TParams> {
    return createBuiltin<StateInGuard<TContext, TExpressionEvent, TParams>>("stateIn", "stateIn", "xstate.stateIn", {
        stateValue,
    });
}
