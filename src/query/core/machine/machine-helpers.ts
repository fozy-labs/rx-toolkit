import type {
    TInvalidateErrorState,
    TInvalidatingState,
    TMachineState,
    TPatchEntry,
    TPatchState,
    TPendingState,
    TRetrying,
    TSuccessState,
} from "@/query/types";

import { processAllSettledPatches, processPatchState, replayPatchEntries } from "../patcher";

// States that carry data and support patching
export type TDataState<TArgs, TData> =
    TSuccessState<TArgs, TData> | TInvalidatingState<TArgs, TData> | TInvalidateErrorState<TArgs, TData>;

export function isDataState<TArgs, TData>(state: TMachineState<TArgs, TData>): state is TDataState<TArgs, TData> {
    return state.status === "success" || state.status === "invalidating" || state.status === "invalidate-error";
}

/** No retry in flight: the shape of a first load or a plain invalidation. */
export const NOT_RETRYING: TRetrying<never> = { isRetrying: false, error: null };

/**
 * The retry bookkeeping of an in-flight machine state as the {@link TRetrying}
 * union, for the derived (clutch / entry) states. The cast is sound per the
 * mapError contract: the machine only holds errors already normalized to
 * `TError` at the queryFn boundary.
 */
export function retryingOf<TArgs, TData, TError>(
    state: TPendingState<TArgs> | TInvalidatingState<TArgs, TData>,
): TRetrying<TError> {
    return state.isRetrying ? { isRetrying: true, error: state.error as TError } : NOT_RETRYING;
}

export function buildDataState<TArgs, TData>(
    status: "success" | "invalidating" | "invalidate-error",
    base: TMachineState<TArgs, TData>,
    data: TData,
    patchState: TPatchState<TData> | null,
    updatedAt?: number,
): TDataState<TArgs, TData> {
    const resolvedUpdatedAt = updatedAt ?? (isDataState(base) ? base.updatedAt : Date.now());

    switch (status) {
        case "success": {
            const state: TSuccessState<TArgs, TData> = {
                status: "success",
                args: base.args,
                data,
                error: null,
                updatedAt: resolvedUpdatedAt,
                patchState,
            };
            return state;
        }
        case "invalidating": {
            // Patch operations rebuild the state in place: keep the retry
            // bookkeeping of a retrying invalidation.
            const retrying = base.status === "invalidating" && base.isRetrying;
            const state: TInvalidatingState<TArgs, TData> = {
                status: "invalidating",
                args: base.args,
                data,
                error: retrying ? base.error : null,
                updatedAt: resolvedUpdatedAt,
                patchState,
                isRetrying: retrying,
            };
            return state;
        }
        case "invalidate-error": {
            if (!isDataState(base)) {
                throw new Error("Cannot build invalidate-error from non-data state");
            }
            const state: TInvalidateErrorState<TArgs, TData> = {
                status: "invalidate-error",
                args: base.args,
                data,
                error: base.error,
                updatedAt: resolvedUpdatedAt,
                patchState,
            };
            return state;
        }
    }
}

export function withDataState<TArgs, TData>(
    currentState: TMachineState<TArgs, TData>,
    data: TData,
    patchState: TPatchState<TData> | null,
): TDataState<TArgs, TData> {
    if (!isDataState(currentState)) {
        throw new Error("withDataState called on non-data state");
    }
    return buildDataState(currentState.status, currentState, data, patchState);
}

export function consistencyViolation<TArgs, TData>(
    currentState: TMachineState<TArgs, TData>,
): TDataState<TArgs, TData> {
    if (!isDataState(currentState)) {
        throw new Error("Consistency violation in non-data state");
    }

    const newPatchState: TPatchState<TData> = {
        originalData: currentState.patchState?.originalData ?? currentState.data,
        patches: [],
        isConsistencyViolation: true,
    };

    return withDataState(currentState, currentState.data, newPatchState);
}

export function replayPatches<TArgs, TData>(
    currentState: TMachineState<TArgs, TData>,
    targetStatus: "success" | "invalidating" | "invalidate-error",
    baseData: TData,
    patches: TPatchEntry[],
    updatedAt?: number,
): TDataState<TArgs, TData> {
    const result = replayPatchEntries(baseData, patches);
    if (!result.ok) return consistencyViolation(currentState);
    return buildDataState(targetStatus, currentState, result.data, result.patchState, updatedAt);
}

export function processPatches<TArgs, TData>(
    currentState: TMachineState<TArgs, TData>,
    patchState: TPatchState<TData>,
): TDataState<TArgs, TData> {
    const result = processPatchState(patchState);
    if (!result.ok) return consistencyViolation(currentState);
    return withDataState(currentState, result.data, result.patchState);
}

export function processAllPatches<TArgs, TData>(
    currentState: TMachineState<TArgs, TData>,
    patchState: TPatchState<TData>,
): TDataState<TArgs, TData> {
    const result = processAllSettledPatches(patchState);
    if (!result.ok) return consistencyViolation(currentState);
    return withDataState(currentState, result.data, result.patchState);
}
