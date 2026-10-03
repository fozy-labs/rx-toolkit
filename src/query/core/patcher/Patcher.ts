import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer";

import type { TPatchEntry, TPatchState } from "@/query/types";

enablePatches();

// ==================== Result Type ====================

export type TPatchResult<TData> = { ok: true; data: TData; patchState: TPatchState<TData> | null } | { ok: false };

// ==================== Low-level Immer Operations ====================

export function createPatches<T>(base: T, recipe: (draft: T) => void): [T, Patch[], Patch[]] {
    return produceWithPatches(base, recipe) as [T, Patch[], Patch[]];
}

export function applyForwardPatches<T>(base: T, patches: Patch[]): T {
    return applyPatches(base as any, patches) as T;
}

export function rebasePatches<T>(base: T, forwardPatches: Patch[]): [T, Patch[], Patch[]] {
    return produceWithPatches(base as Record<string, unknown>, (draft) => {
        applyPatches(draft, forwardPatches);
    }) as unknown as [T, Patch[], Patch[]];
}

// ==================== High-level Patch Operations ====================

/**
 * Re-apply a patch entry onto `base`. An entry recorded with a recipe re-runs
 * it through Immer — the recipe was written against the data it finds (a
 * `findIndex` + a `-1` guard, not a fixed position), so it still lands on the
 * element it targeted where the recorded positional patches would hit a
 * neighbour. An entry without a recipe replays its recorded forward patches.
 * Either way the re-derived `forward` / `inverse` replace the recorded pair,
 * so a later abort undoes what was actually applied.
 */
function replayEntry<T>(base: T, entry: TPatchEntry): T {
    const [next, forward, inverse] = entry.recipe
        ? createPatches(base, entry.recipe)
        : rebasePatches(base, entry.forward);
    entry.forward = forward;
    entry.inverse = inverse;
    return next as T;
}

/**
 * Replay a list of patch entries onto new base data.
 * Pure data operation — no machine-state knowledge.
 */
export function replayPatchEntries<TData>(baseData: TData, patches: TPatchEntry[]): TPatchResult<TData> {
    let currentData = baseData;
    const replayedPatches: TPatchEntry[] = [];

    for (const p of patches) {
        if (p.status === "aborted") {
            replayedPatches.push(p);
            continue;
        }

        try {
            currentData = replayEntry(currentData, p);
            replayedPatches.push(p);
        } catch {
            return { ok: false };
        }
    }

    const hasPending = replayedPatches.some((p) => p.status === "pending");

    if (!hasPending) {
        // Nothing pending: aborted entries were skipped in the pass above and
        // the committed ones were already replayed in order on the same base —
        // `currentData` is the final data, no second replay needed.
        return { ok: true, data: currentData, patchState: null };
    }

    return {
        ok: true,
        data: currentData,
        patchState: {
            originalData: baseData,
            patches: replayedPatches,
            isConsistencyViolation: false,
        },
    };
}

/**
 * Process a patch state: fold settled independent patches, then replay remaining.
 * Stops at the first pending patch — patches after it are left as-is.
 * Pure data operation — no machine-state knowledge.
 */
export function processPatchState<TData>(patchState: TPatchState<TData>): TPatchResult<TData> {
    const patches = [...patchState.patches];
    let originalData = patchState.originalData;

    const firstPendingIdx = patches.findIndex((p) => p.status === "pending");
    const independentEnd = firstPendingIdx === -1 ? patches.length : firstPendingIdx;

    if (independentEnd > 0) {
        const independentPatches = patches.slice(0, independentEnd);
        for (const p of independentPatches) {
            if (p.status === "committed") {
                try {
                    originalData = replayEntry(originalData, p);
                } catch {
                    return { ok: false };
                }
            }
        }
        patches.splice(0, independentEnd);
    }

    if (patches.length === 0) {
        return { ok: true, data: originalData, patchState: null };
    }

    return replayPatchEntries(originalData, patches);
}

/**
 * Process ALL settled patches in a patch state, continuing past pending ones.
 * Committed patches are rebased and folded into originalData;
 * aborted patches are dropped; pending patches are kept and rebased.
 * Pure data operation — no machine-state knowledge.
 */
export function processAllSettledPatches<TData>(patchState: TPatchState<TData>): TPatchResult<TData> {
    let committedData = patchState.originalData;
    const pendingEntries: TPatchEntry[] = [];

    for (const p of patchState.patches) {
        if (p.status === "aborted") continue;

        if (p.status === "committed") {
            try {
                committedData = replayEntry(committedData, p);
            } catch {
                return { ok: false };
            }
            continue;
        }

        // pending
        pendingEntries.push(p);
    }

    if (pendingEntries.length === 0) {
        return { ok: true, data: committedData, patchState: null };
    }

    return replayPatchEntries(committedData, pendingEntries);
}
