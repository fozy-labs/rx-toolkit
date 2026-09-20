import type { TCommandEntryIdleState, TCommandEntryState, TQueryEntryState } from "@/query/types";

import { errorSlotOf } from "../machine/machine-helpers";

// ==================== Entry rows of the command state matrix ====================
//
// The rows a single command cache entry can produce: K1 (no entry), K2 / K5 (a
// run in flight), K3 (success) and K4 (error).
//
// Shared by both derivations so they cannot drift: `CommandClutch` returns these
// rows with `retry()` layered on top, and a command's `retentionTime` function
// receives them as they are.

/** Row K1 — nothing triggered and no cache entry bound. */
export const IDLE_COMMAND_ENTRY_STATE: TCommandEntryIdleState = {
    status: "idle",
    data: null,
    hasData: false,
    error: null,
    hasError: false,
    args: null,
    isPending: false,
};

/**
 * The command entry row of a query entry's state.
 *
 * The idle row is out of reach here: it says "no cache entry", and a raw entry
 * record only exists once one does. Callers that need it use
 * {@link IDLE_COMMAND_ENTRY_STATE} instead.
 */
export function buildCommandEntryState<TArgs, TData, TError>(
    entryState: TQueryEntryState<TArgs, TData>,
): Exclude<TCommandEntryState<TArgs, TData, TError>, TCommandEntryIdleState> {
    // Each entry status maps to one row of the command state matrix,
    // constructed per branch so the compiler verifies every field against the
    // discriminated union. The switch stays exhaustive over TQueryEntryStatus:
    // a new entry status makes this function fall off its end, which the
    // declared return type rejects.
    switch (entryState.status) {
        // Rows K2 / K5 — a run is in flight. A command never carries data into
        // pending: a repeated trigger creates a fresh entry, so there is no
        // stale value to show. `hasError` distinguishes a retry (K5, keeping
        // the failure it retries readable) from a first attempt (K2).
        case "pending": {
            return {
                status: "pending",
                data: null,
                hasData: false,
                ...errorSlotOf<TError>(entryState.error),
                args: entryState.args,
                isPending: true,
            };
        }

        // Row K3.
        case "success": {
            return {
                status: "success",
                data: entryState.data,
                hasData: true,
                error: null,
                hasError: false,
                args: entryState.args,
                isPending: false,
            };
        }

        // Row K4.
        case "error": {
            return {
                status: "error",
                data: null,
                hasData: false,
                // Sound per the mapError contract (see the pending branch above).
                error: entryState.error as TError,
                hasError: true,
                args: entryState.args,
                isPending: false,
            };
        }

        case "invalidating":
        case "invalidate-error": {
            // Unreachable. Invalidation is the only way into these statuses, and
            // QueryCacheEntry.invalidate() is a console.warn + no-op on every
            // entry created with `errorSource: "command"` — which is every entry
            // a Command creates. A repeated trigger does not reuse the entry
            // either: Command.execute() completes the old one and builds a fresh
            // pending entry under the same entry key.
            //
            // The branch is kept (rather than folded into `pending` with stale
            // data) so the invariant fails loudly instead of silently producing a
            // K2 / K5 state that violates its own `data: null` typing.
            throw new Error(
                `[Command] unreachable entry status "${entryState.status}": ` +
                    "a command cache entry never invalidates (see QueryCacheEntry.invalidate()).",
            );
        }
    }
}
