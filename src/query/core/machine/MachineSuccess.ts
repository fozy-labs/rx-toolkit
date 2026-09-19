import type {
    TQueryEntryInvalidateErrorState,
    TQueryEntryInvalidatingState,
    TQueryEntrySuccessState,
} from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { replayPatches } from "./machine-helpers";
import { MachineInvalidateError } from "./MachineInvalidateError";
import { MachineInvalidating } from "./MachineInvalidating";
import { MachineWithData } from "./MachineWithData";

export class MachineSuccess<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "success" as const;
    declare readonly state: TQueryEntrySuccessState<TArgs, TData>;

    constructor(state: TQueryEntrySuccessState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new MachineSuccess(state as TQueryEntrySuccessState<TArgs, TData>) as this;
    }

    /** success → success (subsequent stream emission; replays patches on new data) */
    next(data: TData): MachineSuccess<TArgs, TData> {
        const patchState = this.state.patchState;

        if (!patchState) {
            const state: TQueryEntrySuccessState<TArgs, TData> = {
                status: "success",
                args: this.state.args,
                data,
                error: null,
                updatedAt: Date.now(),
                patchState: null,
            };
            return new MachineSuccess<TArgs, TData>(state);
        }

        // Replay pending patches on new base. A discarded replay keeps this
        // state as it is (flagged) — the emission brings nothing usable.
        const replayed = replayPatches(this.state, "success", data, patchState.patches, Date.now());
        return replayed.ok ? new MachineSuccess<TArgs, TData>(replayed.state) : this.withState(replayed.state);
    }

    /** success → invalidate-error (a streaming query failed after delivering data; data is kept) */
    fail(error: unknown): MachineInvalidateError<TArgs, TData> {
        const state: TQueryEntryInvalidateErrorState<TArgs, TData> = {
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
        const state: TQueryEntryInvalidatingState<TArgs, TData> = {
            status: "invalidating",
            args: this.state.args,
            data: this.state.data,
            error: null,
            updatedAt: this.state.updatedAt,
            patchState: this.state.patchState,
        };
        return new MachineInvalidating<TArgs, TData>(state);
    }
}
