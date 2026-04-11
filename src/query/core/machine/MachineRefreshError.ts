import type { TRefreshErrorState, TRefreshingState } from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { MachineRefreshing } from "./MachineRefreshing";
import { MachineWithData } from "./MachineWithData";

export class MachineRefreshError<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "refresh-error" as const;
    declare readonly state: TRefreshErrorState<TArgs, TData>;

    constructor(state: TRefreshErrorState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new MachineRefreshError(state as TRefreshErrorState<TArgs, TData>) as this;
    }

    /** refresh-error → refreshing */
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
