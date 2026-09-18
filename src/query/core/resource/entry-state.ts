import type {
    TMachineState,
    TResourceEntryIdleState,
    TResourceEntryPendingNoneState,
    TResourceEntryState,
} from "@/query/types";

import { errorSlotOf } from "../machine/machine-helpers";

// ==================== Entry rows of the state matrix ====================
//
// The rows a single cache entry can produce: 1 (no entry), 2 / 10 (initial load
// with nothing to show), 5 (success), 6 / 12 (re-query behind the entry's own
// data), 7 (failed with nothing to show) and 9 (failed re-query). `dataSource`
// is only `none` or `current` here — previous and placeholder data belong to the
// clutch, not to the entry.
//
// Shared by both derivations so they cannot drift: `Resource.getState` returns
// these rows as they are, and `ResourceClutch` uses them for every row whose
// data comes from the entry itself, layering previous / placeholder data and the
// state methods on top.

/** Row 1 — no cache entry for these arguments. Carries no arguments of its own. */
export const IDLE_ENTRY_STATE: TResourceEntryIdleState = {
    status: "idle",
    dataSource: "none",
    data: null,
    dataArgs: null,
    args: null,
    error: null,
    hasData: false,
    hasError: false,
    isPending: false,
    isInitialLoading: false,
    isSwitching: false,
    isInvalidating: false,
};

/**
 * Rows 2 / 10 — a load is in flight with nothing to show. A non-null `error` is
 * the failure the load retries (row 10).
 *
 * Also the row a clutch reports before its cache entry exists: a started (or
 * `markPending`) clutch is loading, and the entry it is about to create starts
 * in exactly this state.
 */
export function buildPendingEntryState<TArgs, TError>(
    args: TArgs,
    error: unknown,
): TResourceEntryPendingNoneState<TArgs, TError> {
    return {
        status: "pending",
        dataSource: "none",
        data: null,
        dataArgs: null,
        args,
        hasData: false,
        ...errorSlotOf<TError>(error),
        isPending: true,
        isInitialLoading: true,
        isSwitching: false,
        isInvalidating: false,
    };
}

/**
 * The entry row of a machine state, for arguments `args`.
 *
 * `args` is what the reader observes and `dataArgs` what the data was loaded
 * for; on an entry read directly they are the same value, on a clutch they can
 * only differ once previous data is involved — which never reaches this builder.
 */
export function buildEntryState<TArgs, TData, TError>(
    args: TArgs,
    machineState: TMachineState<TArgs, TData>,
): TResourceEntryState<TArgs, TData, TError> {
    switch (machineState.status) {
        // Rows 2 / 10.
        case "pending":
            return buildPendingEntryState<TArgs, TError>(args, machineState.error);

        // Row 5 — fresh data of these arguments.
        case "success":
            return {
                status: "success",
                dataSource: "current",
                data: machineState.data,
                dataArgs: machineState.args,
                args,
                error: null,
                hasData: true,
                hasError: false,
                isPending: false,
                isInitialLoading: false,
                isSwitching: false,
                isInvalidating: false,
            };

        // Rows 6 / 12 — re-queried behind its own data; a non-null `error` is
        // the failure this run retries.
        case "invalidating":
            return {
                status: "pending",
                dataSource: "current",
                data: machineState.data,
                dataArgs: machineState.args,
                args,
                hasData: true,
                ...errorSlotOf<TError>(machineState.error),
                isPending: true,
                isInitialLoading: false,
                isSwitching: false,
                isInvalidating: true,
            };

        // Row 9 — the re-query failed, the entry keeps its data.
        case "invalidate-error":
            return {
                status: "error",
                dataSource: "current",
                data: machineState.data,
                dataArgs: machineState.args,
                args,
                hasData: true,
                hasError: true,
                // Sound per the mapError contract: the machine only ever holds
                // errors already normalized to TError at the queryFn boundary.
                error: machineState.error as TError,
                isPending: false,
                isInitialLoading: false,
                isSwitching: false,
                isInvalidating: false,
            };

        // Row 7 — the load failed with nothing to show.
        case "error":
            return {
                status: "error",
                dataSource: "none",
                data: null,
                dataArgs: null,
                args,
                hasData: false,
                hasError: true,
                // Sound per the mapError contract (see the invalidate-error branch).
                error: machineState.error as TError,
                isPending: false,
                isInitialLoading: false,
                isSwitching: false,
                isInvalidating: false,
            };

        default: {
            // Exhaustive: every machine status is mapped above.
            const unhandled: never = machineState;
            return unhandled;
        }
    }
}
