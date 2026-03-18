import { applyPatches, enablePatches, type Objectish, type Patch, produceWithPatches } from 'immer';
import type { TResourceV2Patch, TPatchFn } from '@/query-v2/types/machine.types';
import { NO_VALUE } from '@/query-v2/lib/NO_VALUE';

enablePatches();

function applyImmerPatches<TData>(data: TData, patches: unknown[]): TData {
    return applyPatches(data as Objectish, patches as Patch[]) as TData;
}

export class Patcher {
    static createPatch<TData>(patchFn: TPatchFn<TData>, data: TData): TResourceV2Patch {
        const [, patches, inversePatches] = produceWithPatches(data as Objectish, patchFn as (draft: Objectish) => void);
        return {
            patches,
            inversePatches,
            status: 'pending',
        };
    }

    static resolvePatches<TData>(originalData: TData, patches: TResourceV2Patch[]): { data: TData; patches: TResourceV2Patch[]; baseData: TData } {
        let currentData = originalData;
        let baseData = originalData;
        const remainingPatches: TResourceV2Patch[] = [];
        let foundPending = false;

        const lastPendingIndex = patches.findLastIndex(p => p.status === 'pending');

        patches.forEach((patch, index) => {
            if (patch.status === 'pending') {
                foundPending = true;
                currentData = applyImmerPatches(currentData, patch.patches);
                remainingPatches.push(patch);
            } else if (foundPending) {
                if (patch.status === 'committed') {
                    currentData = applyImmerPatches(currentData, patch.patches);
                    remainingPatches.push(patch);
                } else if (patch.status === 'aborted') {
                    const hasPendingAfter = index < lastPendingIndex;
                    if (hasPendingAfter) {
                        currentData = applyImmerPatches(currentData, patch.inversePatches);
                        remainingPatches.push(patch);
                    }
                    // No pending after → remove from queue
                }
            } else {
                // Before first pending
                if (patch.status === 'committed') {
                    currentData = applyImmerPatches(currentData, patch.patches);
                    baseData = currentData;
                    // committed before pending → remove from queue
                } else if (patch.status === 'aborted') {
                    // aborted before pending → remove from queue
                }
            }
        });

        return { data: currentData, patches: remainingPatches, baseData };
    }

    static finishPatch<TData>(
        originalData: TData | typeof NO_VALUE,
        patches: TResourceV2Patch[] | null,
        type: 'commit' | 'abort',
        patch: TResourceV2Patch,
    ): { originalData: TData | typeof NO_VALUE; patches: TResourceV2Patch[] | null; data: TData | null } {
        if (!patches) {
            return { originalData, patches: null, data: null };
        }

        // Mark the target patch
        patch.status = type === 'commit' ? 'committed' : 'aborted';

        // If no originalData, nothing to resolve
        if (originalData === NO_VALUE) {
            return { originalData, patches, data: null };
        }

        // Resolve patches
        const resolved = Patcher.resolvePatches(originalData, patches);

        const hasPending = resolved.patches.some(p => p.status === 'pending');

        if (!hasPending) {
            // No pending patches remain → clear originalData and patches
            return {
                originalData: NO_VALUE,
                patches: resolved.patches.length > 0 ? resolved.patches : null,
                data: resolved.data,
            };
        }

        return {
            originalData: resolved.baseData,
            patches: resolved.patches.length > 0 ? resolved.patches : null,
            data: resolved.data,
        };
    }

    static abortAllPending<TData>(
        originalData: TData | typeof NO_VALUE,
        patches: TResourceV2Patch[] | null,
    ): { originalData: TData | typeof NO_VALUE; patches: TResourceV2Patch[] | null; data: TData | null } {
        if (!patches) {
            return { originalData, patches: null, data: null };
        }

        // Mark all pending as aborted
        for (const patch of patches) {
            if (patch.status === 'pending') {
                patch.status = 'aborted';
            }
        }

        if (originalData === NO_VALUE) {
            return { originalData: NO_VALUE, patches: null, data: null };
        }

        // Resolve: all should be either committed or aborted now
        const resolved = Patcher.resolvePatches(originalData, patches);

        return {
            originalData: NO_VALUE,
            patches: null,
            data: resolved.data,
        };
    }
}
