import type {
    TErrorSlot,
    TPatchEntry,
    TPatchState,
    TQueryEntryInvalidateErrorState,
    TQueryEntryInvalidatingState,
    TQueryEntryPendingState,
    TQueryEntryState,
    TQueryEntrySuccessState,
} from "@/query/types";

import { processAllSettledPatches, processPatchState, replayPatchEntries } from "../patcher";

// ==================== Initial states ====================

/**
 * The state a fresh cache entry starts in: a first load of `args`, with nothing
 * to show and no failure behind it.
 */
export function pendingEntryState<TArgs>(args: TArgs): TQueryEntryPendingState<TArgs> {
    return {
        status: "pending",
        args,
        data: null,
        error: null,
        updatedAt: null,
    };
}

/**
 * The state a cache entry hydrated from a snapshot starts in: its data, as a
 * settled `success`. Staleness is not a state — a stale snapshot hydrates the
 * same way and marks the entry for revalidation on its first hold (see the
 * `isInvalidated` entry option).
 */
export function snapshotEntryState<TArgs, TData>(snapshot: {
    args: TArgs;
    data: TData;
    updatedAt: number;
}): TQueryEntrySuccessState<TArgs, TData> {
    return {
        status: "success",
        args: snapshot.args,
        data: snapshot.data,
        error: null,
        updatedAt: snapshot.updatedAt,
        patchState: null,
    };
}

// ==================== State predicates ====================

// States that carry data and support patching
export type TDataState<TArgs, TData> =
    | TQueryEntrySuccessState<TArgs, TData>
    | TQueryEntryInvalidatingState<TArgs, TData>
    | TQueryEntryInvalidateErrorState<TArgs, TData>;

/** The statuses a data-bearing entry state can have. */
export type TDataStatus = TDataState<unknown, unknown>["status"];

/** The single data-bearing state of a given status. */
export type TDataStateOf<TArgs, TData, TStatus extends TDataStatus> = Extract<
    TDataState<TArgs, TData>,
    { status: TStatus }
>;

export function isDataState<TArgs, TData>(state: TQueryEntryState<TArgs, TData>): state is TDataState<TArgs, TData> {
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
    status: TDataStatus,
    base: TQueryEntryState<TArgs, TData>,
    data: TData,
    patchState: TPatchState<TData> | null,
    updatedAt?: number,
): TDataState<TArgs, TData> {
    const resolvedUpdatedAt = updatedAt ?? (isDataState(base) ? base.updatedAt : Date.now());

    switch (status) {
        case "success": {
            const state: TQueryEntrySuccessState<TArgs, TData> = {
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
            const state: TQueryEntryInvalidatingState<TArgs, TData> = {
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
            const state: TQueryEntryInvalidateErrorState<TArgs, TData> = {
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
    currentState: TQueryEntryState<TArgs, TData>,
    data: TData,
    patchState: TPatchState<TData> | null,
): TDataState<TArgs, TData> {
    if (!isDataState(currentState)) {
        throw new Error("withDataState called on non-data state");
    }
    return buildDataState(currentState.status, currentState, data, patchState);
}

/**
 * Give up on the pending patches: drop them and flag the patch state so the
 * owner re-queries.
 *
 * Everything else is left exactly as it is — including `status` and
 * `updatedAt`. A discarded replay is not a settled run: the entry keeps the
 * status it was in (an interrupted rebase stays `invalidating`) and the
 * timestamp of its last real settle, so no reader can mistake the optimistic
 * data it still shows for a fresh server answer.
 */
export function consistencyViolation<TArgs, TData, TState extends TDataState<TArgs, TData>>(
    currentState: TState,
): TState {
    return {
        ...currentState,
        patchState: {
            originalData: currentState.patchState?.originalData ?? currentState.data,
            patches: [],
            isConsistencyViolation: true,
        },
    };
}

/**
 * Outcome of replaying optimistic patches over freshly received data.
 *
 * `ok` — they applied, and the transition settles in `targetStatus`.
 * Otherwise the run is discarded: `state` is the caller's own state with the
 * patches dropped and {@link TPatchState.isConsistencyViolation} raised, and it
 * is up to the caller to start another run.
 */
export type TReplayOutcome<TArgs, TData, TStatus extends TDataStatus> =
    { ok: true; state: TDataStateOf<TArgs, TData, TStatus> } | { ok: false; state: TDataState<TArgs, TData> };

/**
 * Replay the pending patches over `baseData`, landing in `targetStatus` if they
 * apply.
 *
 * They may not: a patch can address a path the server data no longer has. The
 * server answer is then unusable — it would have to be presented either with
 * patches that do not fit it or without patches the caller believes are
 * applied — so the run is thrown away rather than settled. See
 * {@link consistencyViolation} for what the entry looks like meanwhile.
 */
export function replayPatches<TArgs, TData, TStatus extends TDataStatus>(
    currentState: TDataState<TArgs, TData>,
    targetStatus: TStatus,
    baseData: TData,
    patches: TPatchEntry[],
    updatedAt?: number,
): TReplayOutcome<TArgs, TData, TStatus> {
    const result = replayPatchEntries(baseData, patches);

    if (!result.ok) return { ok: false, state: consistencyViolation(currentState) };

    // `buildDataState` constructs exactly `targetStatus`; its union return type
    // cannot express that dependency on its own argument.
    const state = buildDataState(targetStatus, currentState, result.data, result.patchState, updatedAt);
    return { ok: true, state: state as TDataStateOf<TArgs, TData, TStatus> };
}

export function processPatches<TArgs, TData>(
    currentState: TDataState<TArgs, TData>,
    patchState: TPatchState<TData>,
): TDataState<TArgs, TData> {
    const result = processPatchState(patchState);
    if (!result.ok) return consistencyViolation(currentState);
    return withDataState(currentState, result.data, result.patchState);
}

export function processAllPatches<TArgs, TData>(
    currentState: TDataState<TArgs, TData>,
    patchState: TPatchState<TData>,
): TDataState<TArgs, TData> {
    const result = processAllSettledPatches(patchState);
    if (!result.ok) return consistencyViolation(currentState);
    return withDataState(currentState, result.data, result.patchState);
}
