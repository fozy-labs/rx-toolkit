import type { TRefreshErrorState, TRefreshingState, TSuccessState } from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { replayPatches } from "./machine-helpers";
import { MachineRefreshError } from "./MachineRefreshError";
import { MachineRefreshing } from "./MachineRefreshing";
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

    /** success → refresh-error (a streaming query failed after delivering data; data is kept) */
    fail(error: unknown): MachineRefreshError<TArgs, TData> {
        const state: TRefreshErrorState<TArgs, TData> = {
            status: "refresh-error",
            args: this.state.args,
            data: this.state.data,
            error,
            updatedAt: this.state.updatedAt,
            patchState: this.state.patchState,
        };
        return new MachineRefreshError<TArgs, TData>(state);
    }

    /** success → refreshing */
    refresh(): MachineRefreshing<TArgs, TData> {
        const state: TRefreshingState<TArgs, TData> = {
            status: "refreshing",
            args: this.state.args,
            data: this.state.data,
            error: null,
            updatedAt: this.state.updatedAt,
            patchState: this.state.patchState,
        };
        return new MachineRefreshing<TArgs, TData>(state);
    }
}
