import type { IPatchHandle, TPatchEntry, TPatchState } from "@/query/types";

import { MachineStateError } from "../errors";
import { createPatches } from "../patcher";

import { processAllPatches, processPatches, withDataState, type TDataState } from "./machine-helpers";
import { MachineBase } from "./MachineBase";

export type TPatchCreateResult<TMachine> = { machine: TMachine; handle: IPatchHandle };

/**
 * Abstract intermediate base for data-bearing machine states (success, refreshing, refresh-error).
 *
 * Carries `data`, `updatedAt`, `patchState` and all patch methods.
 * Concrete subtypes (MachineSuccess, MachineRefreshing, MachineRefreshError)
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

    finishPatch(): this {
        if (!this.state.patchState) {
            throw new MachineStateError("finishPatch", "no active patchState");
        }

        return this.withState(processPatches(this.state, this.state.patchState));
    }

    finishAllPatches(): this {
        if (!this.state.patchState) {
            throw new MachineStateError("finishAllPatches", "no active patchState");
        }

        return this.withState(processAllPatches(this.state, this.state.patchState));
    }
}
