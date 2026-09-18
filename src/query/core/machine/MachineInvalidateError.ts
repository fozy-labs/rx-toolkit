import type { TInvalidateErrorState, TInvalidatingState } from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { MachineInvalidating } from "./MachineInvalidating";
import { MachineWithData } from "./MachineWithData";

export class MachineInvalidateError<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "invalidate-error" as const;
    declare readonly state: TInvalidateErrorState<TArgs, TData>;

    constructor(state: TInvalidateErrorState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new MachineInvalidateError(state as TInvalidateErrorState<TArgs, TData>) as this;
    }

    /** invalidate-error → invalidating */
    invalidate(): MachineInvalidating<TArgs, TData> {
        const state: TInvalidatingState<TArgs, TData> = {
            status: "invalidating",
            args: this.state.args,
            data: this.state.data,
            error: null,
            updatedAt: this.state.updatedAt,
            patchState: this.state.patchState,
        };
        return new MachineInvalidating<TArgs, TData>(state);
    }

    /** invalidate-error → invalidating (keeps the retried error — the retry marker of an in-flight state) */
    retry(): MachineInvalidating<TArgs, TData> {
        const state: TInvalidatingState<TArgs, TData> = {
            status: "invalidating",
            args: this.state.args,
            data: this.state.data,
            error: this.state.error,
            updatedAt: this.state.updatedAt,
            patchState: this.state.patchState,
        };
        return new MachineInvalidating<TArgs, TData>(state);
    }
}
