import type { TQueryEntryState } from "@/query/types";

import { MachineError } from "./MachineError";
import { MachineInvalidateError } from "./MachineInvalidateError";
import { MachineInvalidating } from "./MachineInvalidating";
import { MachinePending } from "./MachinePending";
import { MachineSuccess } from "./MachineSuccess";

export { MachineBase } from "./MachineBase";

/**
 * Union of all Machine subtypes.
 *
 * Internal to the query core: a cache entry stores the flat
 * {@link TQueryEntryState} record, and the machine is the transition algebra
 * over it — rebuilt on demand with {@link Machine.of}, never published.
 */
export type Machine<TArgs, TData> =
    | MachinePending<TArgs, TData>
    | MachineSuccess<TArgs, TData>
    | MachineError<TArgs, TData>
    | MachineInvalidating<TArgs, TData>
    | MachineInvalidateError<TArgs, TData>;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Machine {
    /**
     * Wrap a stored entry state into the machine that owns its transitions.
     *
     * A machine holds nothing beyond the record it wraps, so wrapping is free of
     * identity concerns: nested references — notably `patchState.patches`, whose
     * entries a live patch handle mutates — are carried over untouched.
     */
    export function of<TArgs, TData>(state: TQueryEntryState<TArgs, TData>): Machine<TArgs, TData> {
        switch (state.status) {
            case "pending":
                return new MachinePending<TArgs, TData>(state);
            case "success":
                return new MachineSuccess<TArgs, TData>(state);
            case "error":
                return new MachineError<TArgs, TData>(state);
            case "invalidating":
                return new MachineInvalidating<TArgs, TData>(state);
            case "invalidate-error":
                return new MachineInvalidateError<TArgs, TData>(state);
            default: {
                // Compiler-checked exhaustiveness: the union has no other status.
                const unexpected: never = state;
                return unexpected;
            }
        }
    }
}
