import type { TErrorState, TPendingState, TSuccessState } from "@/query/types";

import { MachineBase } from "./MachineBase";
import { MachineError } from "./MachineError";
import { MachineSuccess } from "./MachineSuccess";

export class MachinePending<TArgs, TData> extends MachineBase<TArgs, TData> {
    readonly status = "pending" as const;
    declare readonly state: TPendingState<TArgs>;

    constructor(state: TPendingState<TArgs>) {
        super(state);
    }

    /** pending → success */
    success(data: TData): MachineSuccess<TArgs, TData> {
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

    /** pending → error */
    fail(error: unknown): MachineError<TArgs, TData> {
        const state: TErrorState<TArgs> = {
            status: "error",
            args: this.state.args,
            data: null,
            error,
            updatedAt: null,
        };
        return new MachineError<TArgs, TData>(state);
    }
}
