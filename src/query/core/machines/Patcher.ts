import { applyPatches, enablePatches, produceWithPatches, type Objectish, type Patch } from "immer";

import type { TPatch, TPatchState } from "@/query/types";

enablePatches();

/** Result of Patcher.resolvePatches — returns computed data and new patch state */
export interface IPatchResolution<TData> {
    readonly data: TData;
    readonly patchState: TPatchState<TData> | null;
}

function applyImmerPatches<TData>(data: TData, patches: unknown[]): TData {
    return applyPatches(data as Objectish, patches as Patch[]) as TData;
}

export class Patcher {
    /**
     * Creates a pending patch from a patchFn applied to data via Immer.
     * Returns the patch record and the new (patched) data.
     */
    static createPatch<TData>(patchFn: (draft: TData) => void, data: TData): { patch: TPatch; data: TData } {
        const [newData, patches, inversePatches] = produceWithPatches(
            data as Objectish,
            patchFn as (draft: Objectish) => void,
        );

        return {
            patch: {
                patches,
                inversePatches,
                status: "pending",
            },
            data: newData as TData,
        };
    }

    /**
     * Re-applies patches on top of fresh original data.
     * Committed patches are baked into base. Pending patches are re-applied and kept.
     * Aborted patches have their inverse applied (if pending patches follow) or are dropped.
     * Detects consistency violations when applyPatches throws.
     */
    static resolvePatches<TData>(originalData: TData, patches: TPatch[]): IPatchResolution<TData> {
        if (patches.length === 0) {
            return { data: originalData, patchState: null };
        }

        let currentData = originalData;
        let baseData = originalData;
        const remainingPatches: TPatch[] = [];
        let foundPending = false;
        let isConsistencyViolation = false;

        const lastPendingIndex = patches.findLastIndex((p) => p.status === "pending");

        for (let index = 0; index < patches.length; index++) {
            const patch = patches[index];

            try {
                if (patch.status === "pending") {
                    foundPending = true;
                    currentData = applyImmerPatches(currentData, patch.patches);
                    remainingPatches.push(patch);
                } else if (foundPending) {
                    if (patch.status === "committed") {
                        currentData = applyImmerPatches(currentData, patch.patches);
                        remainingPatches.push(patch);
                    } else if (patch.status === "aborted") {
                        const hasPendingAfter = index < lastPendingIndex;
                        if (hasPendingAfter) {
                            currentData = applyImmerPatches(currentData, patch.inversePatches);
                            remainingPatches.push(patch);
                        }
                        // No pending after → drop from queue
                    }
                } else {
                    // Before first pending
                    if (patch.status === "committed") {
                        currentData = applyImmerPatches(currentData, patch.patches);
                        baseData = currentData;
                        // committed before pending → bake into base, remove from queue
                    }
                    // aborted before pending → drop silently
                }
            } catch {
                isConsistencyViolation = true;
                // Return last valid data state, clear all patches
                return {
                    data: currentData,
                    patchState: {
                        patches: [],
                        originalData: currentData,
                        isConsistencyViolation: true,
                    },
                };
            }
        }

        const hasPending = remainingPatches.some((p) => p.status === "pending");

        if (!hasPending) {
            return { data: currentData, patchState: null };
        }

        return {
            data: currentData,
            patchState: {
                originalData: baseData,
                patches: remainingPatches,
                isConsistencyViolation,
            },
        };
    }

    /**
     * Commits or aborts a single patch, then resolves.
     * Returns new data and updated patchState.
     */
    static finishPatch<TData>(
        originalData: TData,
        patches: TPatch[],
        type: "committed" | "aborted",
        patch: TPatch,
    ): IPatchResolution<TData> {
        // Create new patches array with target patch status updated
        const updatedPatches = patches.map((p) => (p === patch ? { ...p, status: type } : p));

        return Patcher.resolvePatches(originalData, updatedPatches);
    }

    /**
     * Aborts all pending patches, resolves and returns data with patchState=null.
     */
    static abortAllPending<TData>(originalData: TData, patches: TPatch[]): IPatchResolution<TData> {
        const updatedPatches = patches.map((p) => (p.status === "pending" ? { ...p, status: "aborted" as const } : p));

        return Patcher.resolvePatches(originalData, updatedPatches);
    }
}
