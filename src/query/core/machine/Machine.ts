import type { TInvalidatingState, TPendingState, TSuccessState } from "@/query/types";

import { MachineError } from "./MachineError";
import { MachineInvalidateError } from "./MachineInvalidateError";
import { MachineInvalidating } from "./MachineInvalidating";
import { MachinePending } from "./MachinePending";
import { MachineSuccess } from "./MachineSuccess";

export { MachineBase } from "./MachineBase";

/**
 * Union of all Machine subtypes.
 *
 * Backward-compatible: existing code typed as `Machine<A,D>` still works
 * because all subtypes extend `MachineBase<A,D>` and carry the same `.state` shape.
 */
export type Machine<TArgs, TData> =
    | MachinePending<TArgs, TData>
    | MachineSuccess<TArgs, TData>
    | MachineError<TArgs, TData>
    | MachineInvalidating<TArgs, TData>
    | MachineInvalidateError<TArgs, TData>;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Machine {
    export function pending<TArgs, TData>(args: TArgs): MachinePending<TArgs, TData> {
        const state: TPendingState<TArgs> = {
            status: "pending",
            args,
            data: null,
            error: null,
            updatedAt: null,
            isRetrying: false,
        };
        return new MachinePending<TArgs, TData>(state);
    }

    export function fromSnapshot<TArgs, TData>(
        snapshot: { args: TArgs; data: TData; updatedAt: number },
        isStale = false,
    ): MachineSuccess<TArgs, TData> | MachineInvalidating<TArgs, TData> {
        if (isStale) {
            const state: TInvalidatingState<TArgs, TData> = {
                status: "invalidating",
                args: snapshot.args,
                data: snapshot.data,
                error: null,
                updatedAt: snapshot.updatedAt,
                patchState: null,
                isRetrying: false,
            };
            return new MachineInvalidating<TArgs, TData>(state);
        }

        const state: TSuccessState<TArgs, TData> = {
            status: "success",
            args: snapshot.args,
            data: snapshot.data,
            error: null,
            updatedAt: snapshot.updatedAt,
            patchState: null,
        };
        return new MachineSuccess<TArgs, TData>(state);
    }
}
