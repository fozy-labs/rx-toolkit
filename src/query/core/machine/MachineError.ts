import type { TErrorState, TPendingState } from "@/query/types";

import { MachineBase } from "./MachineBase";
import { MachinePending } from "./MachinePending";

export class MachineError<TArgs, TData> extends MachineBase<TArgs, TData> {
    readonly status = "error" as const;
    declare readonly state: TErrorState<TArgs>;

    constructor(state: TErrorState<TArgs>) {
        super(state);
    }

    /** error → pending (keeps the retried error, marks `isRetrying`) */
    retry(): MachinePending<TArgs, TData> {
        const state: TPendingState<TArgs> = {
            status: "pending",
            args: this.state.args,
            data: null,
            error: this.state.error,
            updatedAt: null,
            isRetrying: true,
        };
        return new MachinePending<TArgs, TData>(state);
    }
}
