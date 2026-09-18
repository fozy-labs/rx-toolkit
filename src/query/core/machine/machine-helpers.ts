import type {
    TErrorSlot,
    TInvalidateErrorState,
    TInvalidatingState,
    TMachineState,
    TPatchEntry,
    TPatchState,
    TSuccessState,
} from "@/query/types";

import { processAllSettledPatches, processPatchState, replayPatchEntries } from "../patcher";

// States that carry data and support patching
export type TDataState<TArgs, TData> =
    TSuccessState<TArgs, TData> | TInvalidatingState<TArgs, TData> | TInvalidateErrorState<TArgs, TData>;

export function isDataState<TArgs, TData>(state: TMachineState<TArgs, TData>): state is TDataState<TArgs, TData> {
    return state.status === "success" || state.status === "invalidating" || state.status === "invalidate-error";
}

/**
 * The error slot of a derived (clutch / entry) state built from a machine
 * state's `error`. In an in-flight state a non-null `error` is the failure the
 * run retries, and it survives into the next load — so `isPending && hasError`
 * is a retry in flight.
 *
 * The cast is sound per the mapError contract: the machine only ever holds
 * errors already normalized to `TError` at the queryFn boundary.
 */
export function errorSlotOf<TError>(error: unknown): TErrorSlot<TError> {
    return error !== null ? { hasError: true, error: error as TError } : { hasError: false, error: null };
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
            // Patch operations rebuild the state in place: a retry in flight is
            // `error !== null`, so rebuilding an invalidating state on top of an
            // invalidating one must not lose the retried failure.
            const state: TInvalidatingState<TArgs, TData> = {
                status: "invalidating",
                args: base.args,
                data,
                error: base.status === "invalidating" ? base.error : null,
                updatedAt: resolvedUpdatedAt,
                patchState,
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
