import type { CreatePatchResult, IPatchHandle, TMachineInstance, TPatch, TPatchState } from "@/query/types";

import type { IPatchResolution } from "./Patcher";
import { Patcher } from "./Patcher";

/**
 * Abstract base for machine states that carry data (success, refreshing).
 * Owns patchState and provides createPatch / finishPatch / abortAllPendingPatches.
 * All methods return new immutable instances.
 */
export abstract class MachineWithData<TArgs, TData> {
    readonly args: TArgs;
    readonly data: TData;
    readonly patchState: TPatchState<TData> | null;

    constructor(args: TArgs, data: TData, patchState: TPatchState<TData> | null) {
        this.args = args;
        this.data = data;
        this.patchState = patchState;
    }

    /**
     * Creates a new machine with patched data and updated patchState,
     * plus an IPatchHandle for commit/abort.
     * Returns null if patchFn produces no changes (patches array is empty).
     */
    createPatch(patchFn: (draft: TData) => void): CreatePatchResult<TArgs, TData> | null {
        const result = Patcher.createPatch(patchFn, this.data);

        // If no patches produced, return null
        if (result.patch.patches.length === 0) {
            return null;
        }

        const newPatch = result.patch;
        const originalData = this.patchState?.originalData ?? this.data;
        const existingPatches = this.patchState?.patches ?? [];

        const newPatchState: TPatchState<TData> = {
            originalData,
            patches: [...existingPatches, newPatch],
            isConsistencyViolation: false,
        };

        const newMachine = this.cloneWith({
            data: result.data,
            patchState: newPatchState,
        });

        const patchHandle: IPatchHandle = {
            commit: () => {},
            abort: () => {},
        };

        return {
            machine: newMachine as unknown as CreatePatchResult<TArgs, TData>["machine"],
            patchHandle,
        };
    }

    /**
     * Finishes a patch (commit or abort) and returns a new machine with resolved state.
     */
    finishPatch(type: "committed" | "aborted", patch: TPatch): TMachineInstance<TArgs, TData> {
        if (!this.patchState) {
            return this as unknown as TMachineInstance<TArgs, TData>;
        }

        const resolution: IPatchResolution<TData> = Patcher.finishPatch(
            this.patchState.originalData,
            this.patchState.patches,
            type,
            patch,
        );

        return this.cloneWith({
            data: resolution.data,
            patchState: resolution.patchState,
        }) as unknown as TMachineInstance<TArgs, TData>;
    }

    /**
     * Aborts all pending patches, returns a new machine with resolved state.
     */
    abortAllPendingPatches(): TMachineInstance<TArgs, TData> {
        if (!this.patchState) {
            return this as unknown as TMachineInstance<TArgs, TData>;
        }

        const resolution: IPatchResolution<TData> = Patcher.abortAllPending(
            this.patchState.originalData,
            this.patchState.patches,
        );

        return this.cloneWith({
            data: resolution.data,
            patchState: resolution.patchState,
        }) as unknown as TMachineInstance<TArgs, TData>;
    }

    /**
     * Clone with partial updates. Used internally by transitions.
     */
    protected abstract cloneWith(updates: Record<string, unknown>): MachineWithData<TArgs, TData>;
}
