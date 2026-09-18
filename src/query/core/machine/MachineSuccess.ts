import type { TInvalidateErrorState, TInvalidatingState, TSuccessState } from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { replayPatches } from "./machine-helpers";
import { MachineInvalidateError } from "./MachineInvalidateError";
import { MachineInvalidating } from "./MachineInvalidating";
import { MachineWithData } from "./MachineWithData";

export class MachineSuccess<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "success" as const;
    declare readonly state: TSuccessState<TArgs, TData>;

    constructor(state: TSuccessState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new MachineSuccess(state as TSuccessState<TArgs, TData>) as this;
    }

    /** success → success (subsequent stream emission; replays patches on new data) */
    next(data: TData): MachineSuccess<TArgs, TData> {
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

    /** success → invalidate-error (a streaming query failed after delivering data; data is kept) */
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

    /** success → invalidating */
    invalidate(): MachineInvalidating<TArgs, TData> {
        const state: TInvalidatingState<TArgs, TData> = {
            status: "invalidating",
            args: this.state.args,
            data: this.state.data,
            error: null,
            updatedAt: this.state.updatedAt,
            patchState: this.state.patchState,
            isRetrying: false,
        };
        return new MachineInvalidating<TArgs, TData>(state);
    }
}
