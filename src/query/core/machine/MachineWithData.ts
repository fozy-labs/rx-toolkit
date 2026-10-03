import type { IPatchHandle, TPatchEntry, TPatchState, TQueryEntryInvalidatingState } from "@/query/types";

import { QueryEntryStateError } from "../errors";
import { createPatches } from "../patcher";

import {
    processAllPatches,
    processPatches,
    withDataState,
    type TDataState,
    type TSettleOutcome,
} from "./machine-helpers";
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

    protected constructor(state: TDataState<TArgs, TData>, violated = false) {
        super(state, violated);
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

    /**
     * Wrap the `invalidating` state a consistency violation lands in (see
     * `consistencyViolation`), marked {@link MachineBase.violated}.
     */
    protected abstract withViolation(
        state: TQueryEntryInvalidatingState<TArgs, TData>,
    ): this | MachineInvalidating<TArgs, TData>;

    /** Wrap the outcome of a patch settle: this status, or a violation. */
    private withSettled(outcome: TSettleOutcome<TArgs, TData>): this | MachineInvalidating<TArgs, TData> {
        return outcome.ok ? this.withState(outcome.state) : this.withViolation(outcome.state);
    }

    // ==================== Patch Methods ====================

    createPatch(patchFn: (data: TData) => void, onSettle?: () => void): TPatchCreateResult<this> {
        const currentData = this.state.data;

        const [nextData, forward, inverse] = createPatches(currentData, patchFn);

        const entry: TPatchEntry = {
            forward,
            inverse,
            status: "pending",
            // Kept for replays: a rebase re-runs the recipe on the new base
            // rather than re-applying the recorded positional patches (see
            // `TPatchEntry.recipe`).
            recipe: patchFn,
        };

        const existingPatches = this.state.patchState?.patches ?? [];
        const originalData = this.state.patchState?.originalData ?? currentData;

        const newPatchState: TPatchState<TData> = {
            originalData,
            patches: [...existingPatches, entry],
            // A violation's data stays unconfirmed until a server answer lands.
            isConsistencyViolation: this.state.patchState?.isConsistencyViolation ?? false,
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
