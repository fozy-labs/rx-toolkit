import type {
    TMachineState,
    TPatchEntry,
    TPatchState,
    TPendingState,
    TRefreshErrorState,
    TRefreshingState,
    TRetrying,
    TSuccessState,
} from "@/query/types";

import { processAllSettledPatches, processPatchState, replayPatchEntries } from "../patcher";

// States that carry data and support patching
export type TDataState<TArgs, TData> =
    TSuccessState<TArgs, TData> | TRefreshingState<TArgs, TData> | TRefreshErrorState<TArgs, TData>;

export function hasData<TArgs, TData>(state: TMachineState<TArgs, TData>): state is TDataState<TArgs, TData> {
    return state.status === "success" || state.status === "refreshing" || state.status === "refresh-error";
}

/** No retry in flight: the shape of a first load or a plain refresh. */
export const NOT_RETRYING: TRetrying<never> = { isRetrying: false, error: null };

/**
 * The retry bookkeeping of an in-flight machine state as the {@link TRetrying}
 * union, for the derived (agent / lite) states. The cast is sound per the
 * mapError contract: the machine only holds errors already normalized to
 * `TError` at the queryFn boundary.
 */
export function retryingOf<TArgs, TData, TError>(
    state: TPendingState<TArgs> | TRefreshingState<TArgs, TData>,
): TRetrying<TError> {
    return state.isRetrying ? { isRetrying: true, error: state.error as TError } : NOT_RETRYING;
}

export function buildDataState<TArgs, TData>(
    status: "success" | "refreshing" | "refresh-error",
    base: TMachineState<TArgs, TData>,
    data: TData,
    patchState: TPatchState<TData> | null,
    updatedAt?: number,
): TDataState<TArgs, TData> {
    const resolvedUpdatedAt = updatedAt ?? (hasData(base) ? base.updatedAt : Date.now());

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
        case "refreshing": {
            // Patch operations rebuild the state in place: keep the retry
            // bookkeeping of a retrying refresh.
            const retrying = base.status === "refreshing" && base.isRetrying;
            const state: TRefreshingState<TArgs, TData> = {
                status: "refreshing",
                args: base.args,
                data,
                error: retrying ? base.error : null,
                updatedAt: resolvedUpdatedAt,
                patchState,
                isRetrying: retrying,
            };
            return state;
        }
        case "refresh-error": {
            if (!hasData(base)) {
                throw new Error("Cannot build refresh-error from non-data state");
            }
            const state: TRefreshErrorState<TArgs, TData> = {
                status: "refresh-error",
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
    if (!hasData(currentState)) {
        throw new Error("withDataState called on non-data state");
    }
    return buildDataState(currentState.status, currentState, data, patchState);
}

export function consistencyViolation<TArgs, TData>(
    currentState: TMachineState<TArgs, TData>,
): TDataState<TArgs, TData> {
    if (!hasData(currentState)) {
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
    targetStatus: "success" | "refreshing" | "refresh-error",
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
