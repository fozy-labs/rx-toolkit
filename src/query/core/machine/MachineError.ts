import type { TErrorState, TPendingState } from "@/query/types";

import { MachineBase } from "./MachineBase";
import { MachinePending } from "./MachinePending";

export class MachineError<TArgs, TData> extends MachineBase<TArgs, TData> {
    readonly status = "error" as const;
    declare readonly state: TErrorState<TArgs>;

    constructor(state: TErrorState<TArgs>) {
        super(state);
    }

    /** error → pending (keeps the retried error — the retry marker of an in-flight state) */
    retry(): MachinePending<TArgs, TData> {
        const state: TPendingState<TArgs> = {
            status: "pending",
            args: this.state.args,
            data: null,
            error: this.state.error,
            updatedAt: null,
        };
        return new MachinePending<TArgs, TData>(state);
    }

    /**
     * error → pending (clears the error). The failed entry itself holds nothing,
     * but the reader's view may still show previous-args data or a placeholder
     * the machine knows nothing about: invalidating re-checks the query without
     * keeping the failure on screen.
     */
    invalidate(): MachinePending<TArgs, TData> {
        const state: TPendingState<TArgs> = {
            status: "pending",
            args: this.state.args,
            data: null,
            error: null,
            updatedAt: null,
        };
        return new MachinePending<TArgs, TData>(state);
    }
}
