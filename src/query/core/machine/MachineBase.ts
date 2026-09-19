import type {
    IPatchHandle,
    TPatchEntry,
    TPatchState,
    TQueryEntryErrorState,
    TQueryEntryInvalidateErrorState,
    TQueryEntryInvalidatingState,
    TQueryEntryPendingState,
    TQueryEntryState,
    TQueryEntrySuccessState,
} from "@/query/types";

import { QueryEntryStateError, QueryEntryTransitionError } from "../errors";
import { createPatches } from "../patcher";

import { isDataState, processAllPatches, processPatches, replayPatches } from "./machine-helpers";

/**
 * Base class for the Machine state machine.
 *
 * Provides all transition methods with runtime guards.
 * Subtypes extend this and override their valid transitions with narrower return types.
 * Invalid transitions inherited from MachineBase throw QueryEntryTransitionError/QueryEntryStateError.
 */
export class MachineBase<TArgs, TData> {
    readonly state: TQueryEntryState<TArgs, TData>;

    protected constructor(state: TQueryEntryState<TArgs, TData>) {
        this.state = state;
    }

    // ==================== Transition Methods ====================

    /** pending → success */
    success(data: TData): MachineBase<TArgs, TData> {
        if (this.state.status !== "pending") {
            throw new QueryEntryTransitionError("success", this.state.status);
        }

        const state: TQueryEntrySuccessState<TArgs, TData> = {
            status: "success",
            args: this.state.args,
            data,
            error: null,
            updatedAt: Date.now(),
            patchState: null,
        };
        return new MachineBase<TArgs, TData>(state);
    }

    /** pending → error, invalidating → invalidate-error, success → invalidate-error */
    fail(error: unknown): MachineBase<TArgs, TData> {
        if (this.state.status === "pending") {
            const state: TQueryEntryErrorState<TArgs> = {
                status: "error",
                args: this.state.args,
                data: null,
                error,
                updatedAt: null,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        // A streaming query can fail after it already delivered data: the entry
        // sits in `success` when the stream errors. Data is kept, like a failed
        // background invalidation.
        if (this.state.status === "success") {
            const state: TQueryEntryInvalidateErrorState<TArgs, TData> = {
                status: "invalidate-error",
                args: this.state.args,
                data: this.state.data,
                error,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        if (this.state.status === "invalidating") {
            const state: TQueryEntryInvalidateErrorState<TArgs, TData> = {
                status: "invalidate-error",
                args: this.state.args,
                data: this.state.data,
                error,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        throw new QueryEntryTransitionError("fail", this.state.status);
    }

    /**
     * success → invalidating, invalidate-error → invalidating, error → pending.
     * Re-checks what is shown and clears the error; the caller's own view may
     * still hold data the machine does not know about (previous args or a
     * placeholder), which is why `error` is a valid origin.
     */
    invalidate(): MachineBase<TArgs, TData> {
        if (this.state.status === "error") {
            const state: TQueryEntryPendingState<TArgs> = {
                status: "pending",
                args: this.state.args,
                data: null,
                error: null,
                updatedAt: null,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        if (this.state.status === "success") {
            const state: TQueryEntryInvalidatingState<TArgs, TData> = {
                status: "invalidating",
                args: this.state.args,
                data: this.state.data,
                error: null,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        if (this.state.status === "invalidate-error") {
            const state: TQueryEntryInvalidatingState<TArgs, TData> = {
                status: "invalidating",
                args: this.state.args,
                data: this.state.data,
                error: null,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        throw new QueryEntryTransitionError("invalidate", this.state.status);
    }

    /**
     * error → pending, invalidate-error → invalidating. Unlike {@link invalidate},
     * the retried failure stays in `error` — in an in-flight state that is what
     * marks the run as a retry.
     */
    retry(): MachineBase<TArgs, TData> {
        if (this.state.status === "error") {
            const state: TQueryEntryPendingState<TArgs> = {
                status: "pending",
                args: this.state.args,
                data: null,
                error: this.state.error,
                updatedAt: null,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        if (this.state.status === "invalidate-error") {
            const state: TQueryEntryInvalidatingState<TArgs, TData> = {
                status: "invalidating",
                args: this.state.args,
                data: this.state.data,
                error: this.state.error,
                updatedAt: this.state.updatedAt,
                patchState: this.state.patchState,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        throw new QueryEntryTransitionError("retry", this.state.status);
    }

    /** success → success (subsequent stream emission; replays patches on new data) */
    next(data: TData): MachineBase<TArgs, TData> {
        if (this.state.status !== "success") {
            throw new QueryEntryTransitionError("next", this.state.status);
        }

        const patchState = this.state.patchState;

        // No patches → fresh success with the new base
        if (!patchState) {
            const state: TQueryEntrySuccessState<TArgs, TData> = {
                status: "success",
                args: this.state.args,
                data,
                error: null,
                updatedAt: Date.now(),
                patchState: null,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        // Replay pending patches on new base
        return new MachineBase<TArgs, TData>(
            replayPatches(this.state, "success", data, patchState.patches, Date.now()).state,
        );
    }

    /** invalidating → success (replays patches on new data) */
    rebase(data: TData): MachineBase<TArgs, TData> {
        if (this.state.status !== "invalidating") {
            throw new QueryEntryTransitionError("rebase", this.state.status);
        }

        const patchState = this.state.patchState;

        // No patches → straight to success
        if (!patchState) {
            const state: TQueryEntrySuccessState<TArgs, TData> = {
                status: "success",
                args: this.state.args,
                data,
                error: null,
                updatedAt: Date.now(),
                patchState: null,
            };
            return new MachineBase<TArgs, TData>(state);
        }

        // Replay pending patches on new base
        return new MachineBase<TArgs, TData>(
            replayPatches(this.state, "success", data, patchState.patches, Date.now()).state,
        );
    }

    // ==================== Patch Methods ====================

    /** Create an optimistic patch (success, invalidating, invalidate-error) */
    createPatch(
        patchFn: (data: TData) => void,
        onSettle?: () => void,
    ): { machine: MachineBase<TArgs, TData>; handle: IPatchHandle } {
        if (!isDataState(this.state)) {
            throw new QueryEntryStateError("createPatch", `invalid state "${this.state.status}"`);
        }

        const currentData = this.state.data;

        const [nextData, forward, inverse] = createPatches(currentData, patchFn);

        const entry: TPatchEntry = {
            forward,
            inverse,
            status: "pending",
        };

        const existingPatches = this.state.patchState?.patches ?? [];
        const originalData = this.state.patchState?.originalData ?? currentData;

        const newPatchState: TPatchState<TData> = {
            originalData,
            patches: [...existingPatches, entry],
            isConsistencyViolation: false,
        };

        const newState = {
            ...this.state,
            data: nextData as TData,
            patchState: newPatchState,
        };

        let isSettled = false;

        const handle: IPatchHandle = {
            commit: () => {
                if (isSettled) return;
                isSettled = true;
                entry.status = "committed";
                onSettle?.();
            },
            abort: () => {
                if (isSettled) return;
                isSettled = true;
                entry.status = "aborted";
                onSettle?.();
            },
        };

        return { machine: new MachineBase<TArgs, TData>(newState), handle };
    }

    /** Process all settled patches up to the first pending one */
    finishPatch(): MachineBase<TArgs, TData> {
        if (!isDataState(this.state) || !this.state.patchState) {
            throw new QueryEntryStateError("finishPatch", "no active patchState");
        }

        return new MachineBase<TArgs, TData>(processPatches(this.state, this.state.patchState));
    }

    /** Process all settled patches (continues past pending) */
    finishAllPatches(): MachineBase<TArgs, TData> {
        if (!isDataState(this.state) || !this.state.patchState) {
            throw new QueryEntryStateError("finishAllPatches", "no active patchState");
        }

        return new MachineBase<TArgs, TData>(processAllPatches(this.state, this.state.patchState));
    }
}
