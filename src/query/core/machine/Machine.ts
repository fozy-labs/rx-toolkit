import type { TPendingState, TRefreshingState, TSuccessState } from "@/query/types";

import { MachineError } from "./MachineError";
import { MachinePending } from "./MachinePending";
import { MachineRefreshError } from "./MachineRefreshError";
import { MachineRefreshing } from "./MachineRefreshing";
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
    | MachineRefreshing<TArgs, TData>
    | MachineRefreshError<TArgs, TData>;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Machine {
    export function pending<TArgs, TData>(args: TArgs): MachinePending<TArgs, TData> {
        const state: TPendingState<TArgs> = {
            status: "pending",
            args,
            data: null,
            error: null,
            updatedAt: null,
        };
        return new MachinePending<TArgs, TData>(state);
    }

    export function fromSnapshot<TArgs, TData>(
        snapshot: { args: TArgs; data: TData; updatedAt: number },
        isStale = false,
    ): MachineSuccess<TArgs, TData> | MachineRefreshing<TArgs, TData> {
        if (isStale) {
            const state: TRefreshingState<TArgs, TData> = {
                status: "refreshing",
                args: snapshot.args,
                data: snapshot.data,
                error: null,
                updatedAt: snapshot.updatedAt,
                patchState: null,
            };
            return new MachineRefreshing<TArgs, TData>(state);
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
