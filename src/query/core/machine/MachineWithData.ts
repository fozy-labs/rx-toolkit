import type { IPatchHandle, TPatchEntry, TPatchState, TQueryEntryInvalidatingState } from "@/query/types";

import { QueryEntryStateError } from "../errors";
import { createPatches } from "../patcher";

import { processAllPatches, processPatches, withDataState, type TDataState } from "./machine-helpers";
import { MachineBase } from "./MachineBase";
import type { MachineInvalidating } from "./MachineInvalidating";

export type TPatchCreateResult<TMachine> = { machine: TMachine; handle: IPatchHandle };

/**
 * Abstract intermediate base for data-bearing machine states (success, invalidating, invalidate-error).
 *
 * Carries `data`, `updatedAt`, `patchState` and all patch methods.
 * Concrete subtypes (MachineSuccess, MachineInvalidating, MachineInvalidateError)
 * extend this and implement `withState` to preserve their identity on transitions.
 */
export abstract class MachineWithData<TArgs, TData> extends MachineBase<TArgs, TData> {
    declare readonly state: TDataState<TArgs, TData>;

    protected constructor(state: TDataState<TArgs, TData>) {
        super(state);
    }

    get data(): TData {
        return this.state.data;
    }

    get updatedAt(): number {
        return this.state.updatedAt;
    }

    get patchState(): TPatchState<TData> | null {
        return this.state.patchState;
    }

    protected abstract withState(state: TDataState<TArgs, TData>): this;

    /** Wrap the `invalidating` state a consistency violation lands in (see `consistencyViolation`). */
    protected abstract withViolation(
        state: TQueryEntryInvalidatingState<TArgs, TData>,
    ): this | MachineInvalidating<TArgs, TData>;

    /** Wrap the state a patch settle produced: this status, or `invalidating` after a violation. */
    private withSettled(state: TDataState<TArgs, TData>): this | MachineInvalidating<TArgs, TData> {
        return state.status === "invalidating" ? this.withViolation(state) : this.withState(state);
    }

    // ==================== Patch Methods ====================

    createPatch(patchFn: (data: TData) => void, onSettle?: () => void): TPatchCreateResult<this> {
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

        const newState = withDataState(this.state, nextData as TData, newPatchState);

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

        return { machine: this.withState(newState), handle };
    }

    /** Fold the settled patches up to the first pending one; a consistency violation lands in `invalidating`. */
    finishPatch(): this | MachineInvalidating<TArgs, TData> {
        if (!this.state.patchState) {
            throw new QueryEntryStateError("finishPatch", "no active patchState");
        }

        return this.withSettled(processPatches(this.state, this.state.patchState));
    }

    /** Fold every settled patch; a consistency violation lands in `invalidating`. */
    finishAllPatches(): this | MachineInvalidating<TArgs, TData> {
        if (!this.state.patchState) {
            throw new QueryEntryStateError("finishAllPatches", "no active patchState");
        }

        return this.withSettled(processAllPatches(this.state, this.state.patchState));
    }
}
