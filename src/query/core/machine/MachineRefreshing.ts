import type { TRefreshErrorState, TRefreshingState, TSuccessState } from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { replayPatches } from "./machine-helpers";
import { MachineRefreshError } from "./MachineRefreshError";
import { MachineSuccess } from "./MachineSuccess";
import { MachineWithData } from "./MachineWithData";

export class MachineRefreshing<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "refreshing" as const;
    declare readonly state: TRefreshingState<TArgs, TData>;

    constructor(state: TRefreshingState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new MachineRefreshing(state as TRefreshingState<TArgs, TData>) as this;
    }

    /** refreshing → success (replays patches on new data) */
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

    /** refreshing → refresh-error */
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
}
