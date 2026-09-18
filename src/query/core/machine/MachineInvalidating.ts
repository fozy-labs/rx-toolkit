import type { TInvalidateErrorState, TInvalidatingState, TSuccessState } from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { replayPatches } from "./machine-helpers";
import { MachineInvalidateError } from "./MachineInvalidateError";
import { MachineSuccess } from "./MachineSuccess";
import { MachineWithData } from "./MachineWithData";

export class MachineInvalidating<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "invalidating" as const;
    declare readonly state: TInvalidatingState<TArgs, TData>;

    constructor(state: TInvalidatingState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new MachineInvalidating(state as TInvalidatingState<TArgs, TData>) as this;
    }

    /** invalidating → success (replays patches on new data) */
    rebase(data: TData): MachineSuccess<TArgs, TData> {
        const patchState = this.state.patchState;

        if (!patchState) {
            const state: TSuccessState<TArgs, TData> = {
                status: "success",
                args: this.state.args,
                data,
                error: null,
                updatedAt: Date.now(),
                patchState: null,
            };
            return new MachineSuccess<TArgs, TData>(state);
        }

        // Replay pending patches on new base
        const resultState = replayPatches(this.state, "success", data, patchState.patches, Date.now());
        return new MachineSuccess<TArgs, TData>(resultState as TSuccessState<TArgs, TData>);
    }

    /** invalidating → invalidate-error */
    fail(error: unknown): MachineInvalidateError<TArgs, TData> {
        const state: TInvalidateErrorState<TArgs, TData> = {
            status: "invalidate-error",
            args: this.state.args,
            data: this.state.data,
            error,
            updatedAt: this.state.updatedAt,
            patchState: this.state.patchState,
        };
        return new MachineInvalidateError<TArgs, TData>(state);
    }
}
