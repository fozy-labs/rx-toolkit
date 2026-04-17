import type { TRefreshingState, TSuccessState } from "@/query/types";

import type { TDataState } from "./machine-helpers";
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
