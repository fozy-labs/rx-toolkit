import type {
    TQueryEntryInvalidateErrorState,
    TQueryEntryInvalidatingState,
    TQueryEntrySuccessState,
} from "@/query/types";

import type { TDataState } from "./machine-helpers";
import { replayPatches } from "./machine-helpers";
import { MachineInvalidateError } from "./MachineInvalidateError";
import { MachineSuccess } from "./MachineSuccess";
import { MachineWithData } from "./MachineWithData";

export class MachineInvalidating<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "invalidating" as const;
    declare readonly state: TQueryEntryInvalidatingState<TArgs, TData>;

    constructor(state: TQueryEntryInvalidatingState<TArgs, TData>) {
        super(state);
    }

    protected withState(state: TDataState<TArgs, TData>): this {
        return new MachineInvalidating(state as TQueryEntryInvalidatingState<TArgs, TData>) as this;
    }

    /**
     * invalidating → success (replays patches on new data).
     *
     * Stays `invalidating` when the replay is discarded: the run brought data
     * the pending patches cannot live on, so it settles nothing and the owner
     * has to run the query again. See `replayPatches`.
     */
    rebase(data: TData): MachineSuccess<TArgs, TData> | MachineInvalidating<TArgs, TData> {
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

        // Replay pending patches on new base
        const replayed = replayPatches(this.state, "success", data, patchState.patches, Date.now());
        return replayed.ok ? new MachineSuccess<TArgs, TData>(replayed.state) : this.withState(replayed.state);
    }

    /** invalidating → invalidate-error */
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
}
