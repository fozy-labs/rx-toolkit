import type { Patch } from "immer";

import type { KEYED_BRAND, SKIP } from "../constants";

// ==================== Keyed Arguments ====================

export type TKeyed<T> = { value: T; key: string; readonly [KEYED_BRAND]: true };

export type TArgsOrKeyed<TArgs> = TArgs | TKeyed<TArgs>;

export type TArgsOrVoid<TArgs> = TArgs extends void ? void : TArgsOrKeyed<TArgs>;

export type TArgsOrVoidOrSkip<TArgs> = TArgs extends void ? void | typeof SKIP : TArgsOrKeyed<TArgs> | typeof SKIP;

// ==================== Query Entry State ====================

/**
 * Status of a single cache entry — the raw record a {@link IQueryCacheEntry}
 * stores and publishes through `state$`. Readers usually observe the derived
 * clutch / entry state instead (see `TClutchStatus`).
 */
export type TQueryEntryStatus = "pending" | "success" | "error" | "invalidating" | "invalidate-error";

// In the in-flight states (`pending`, `invalidating`) `error` is the failure the
// run retries: a load started by `retry()` carries it until the run settles,
// while a first load or a plain `invalidate()` has `error: null`. There is no
// separate retry flag — a retry in flight *is* `error !== null`.

export interface TQueryEntryPendingState<TArgs> {
    status: "pending";
    args: TArgs;
    data: null;
    error: unknown;
    updatedAt: null;
}

export interface TQueryEntrySuccessState<TArgs, TData> {
    status: "success";
    args: TArgs;
    data: TData;
    error: null;
    updatedAt: number;
    patchState: TPatchState<TData> | null;
}

export interface TQueryEntryErrorState<TArgs> {
    status: "error";
    args: TArgs;
    data: null;
    error: unknown;
    updatedAt: null;
}

export interface TQueryEntryInvalidatingState<TArgs, TData> {
    status: "invalidating";
    args: TArgs;
    data: TData;
    error: unknown;
    updatedAt: number;
    patchState: TPatchState<TData> | null;
}

export interface TQueryEntryInvalidateErrorState<TArgs, TData> {
    status: "invalidate-error";
    args: TArgs;
    data: TData;
    error: unknown;
    updatedAt: number;
    patchState: TPatchState<TData> | null;
}

/**
 * The state of one cache entry: a flat, immutable record. Every transition
 * produces a new record; the entry publishes it through
 * `IQueryCacheEntry.state$`.
 */
export type TQueryEntryState<TArgs, TData> =
    | TQueryEntryPendingState<TArgs>
    | TQueryEntrySuccessState<TArgs, TData>
    | TQueryEntryErrorState<TArgs>
    | TQueryEntryInvalidatingState<TArgs, TData>
    | TQueryEntryInvalidateErrorState<TArgs, TData>;

// ==================== Patch Types ====================

export interface TPatchEntry {
    forward: Patch[];
    inverse: Patch[];
    status: "pending" | "committed" | "aborted";
}

export interface TPatchState<TData> {
    originalData: TData;
    patches: TPatchEntry[];
    isConsistencyViolation: boolean;
}

export interface IPatchHandle {
    commit(): void;
    abort(): void;
}

// ==================== Clutch Types ====================

/**
 * Status of a clutch state. Unlike {@link TQueryEntryStatus} (the status of one
 * cache entry), it says only whether a query is in flight and how the last one
 * settled: a background invalidation is `pending`, a failed one is `error`.
 * What is on screen meanwhile is told by `dataSource`.
 */
export type TClutchStatus = "idle" | "pending" | "success" | "error";

// ==================== In-Flight Policy ====================

/**
 * What a call does to a query run that is in flight — a promise not yet
 * settled, or a stream whose subscription is open (`success` with a live
 * stream included). Taken by `invalidate()` (described below) and by `fetch` /
 * `prefetch({ force: true })`, which resolve with the run the policy leaves
 * as the answer (see `TResourceFetchOptions.inFlight`).
 *
 * For `invalidate()`:
 *
 * - `"cancel"` — the run is aborted and, when the entry is held, a new one
 *   starts at once; an entry nobody holds is marked and re-queries on its next
 *   hold. The data that finally lands is guaranteed to be from after the
 *   invalidation.
 * - `"trail"` — the run is left to settle; the entry is marked and re-queries
 *   when the run settles (held) or on its next hold (melting). A stream that
 *   never completes is trusted and never re-queried on this path.
 * - `"join"` — a no-op for the run in flight: it is not aborted, the entry is
 *   not marked and nothing re-queries after it settles — its result is taken
 *   as the answer to this invalidation. Beware: that run may have started
 *   before whatever made the data stale (e.g. a mutation), so pre-mutation
 *   data is accepted as fresh. Pick it only when a run in flight is known to
 *   be recent enough. An open stream is trusted as it is.
 *
 * Without a run in flight all values behave the same: the entry is marked
 * and re-queries lazily. A consistency violation (a patch that could not be
 * replayed) invalidates under the resource's value too, `join` included. Set per
 * resource with `invalidateInFlight` (defaults to `"cancel"`), overridden per
 * call. On a projection resource the id-set entry's own run is never
 * restarted: the policy applies to the wrapped resource's requests for the
 * set's ids (see `TProjectionResourceOptions.invalidateInFlight`).
 */
export type TInFlightPolicy = "cancel" | "trail" | "join";

/** Options of `invalidate()` on a resource, a clutch and a cache entry. */
export interface TInvalidateOptions {
    /** Overrides the resource's `invalidateInFlight` for this call. */
    inFlight?: TInFlightPolicy;
}

// ==================== Retention Time ====================

/**
 * How long a cache entry is kept once its last subscriber leaves: a fixed
 * number of milliseconds, `false` to keep it until an explicit reset, or a
 * function deciding per entry.
 *
 * The function is evaluated on the `active → retention` transition — that is,
 * synchronously inside the last subscriber's teardown — and its result governs
 * exactly one retention cycle: a new subscriber cancels the timer, and the next
 * loss of subscribers calls the function again with the state as it is then.
 * Keep it pure and cheap: it runs in a teardown.
 *
 * The result is normalized like a static value: `false`, `Infinity` and
 * anything above `setTimeout`'s 2_147_483_647 ms limit keep the entry; a
 * negative value or `NaN` evicts it immediately. A function that throws is
 * reported through `console.error` and treated as an immediate eviction — the
 * throw never escapes the teardown.
 *
 * @template TArgs - The entry's arguments.
 * @template TState - The entry's state row at the moment of evaluation. The
 *   entry exists whenever the function runs, so the `idle` row is excluded.
 */
export type TRetentionTime<TArgs, TState> = number | false | ((args: TArgs, state: TState) => number | false);

// ==================== Deprecated Aliases ====================

/**
 * @deprecated Renamed to {@link TKeyed} (type-prefix convention). Will be
 * removed in 0.14.0.
 */
export type Keyed<T> = TKeyed<T>;

/**
 * @deprecated Renamed to {@link TArgsOrKeyed} (type-prefix convention). Will be
 * removed in 0.14.0.
 */
export type Args<TArgs> = TArgsOrKeyed<TArgs>;

/**
 * @deprecated Renamed to {@link TArgsOrVoid} (type-prefix convention). Will be
 * removed in 0.14.0.
 */
export type ArgsOrVoid<TArgs> = TArgsOrVoid<TArgs>;

/**
 * @deprecated Renamed to {@link TArgsOrVoidOrSkip} (type-prefix convention).
 * Will be removed in 0.14.0.
 */
export type ArgsOrVoidOrSkip<TArgs> = TArgsOrVoidOrSkip<TArgs>;

/** @deprecated Renamed to {@link TClutchStatus}. Will be removed in 0.14.0. */
export type TAgentStatus = TClutchStatus;

/**
 * @deprecated Renamed to {@link TQueryEntryState}: the cache entry's state is no
 * longer wrapped in a machine class. Will be removed in 0.14.0.
 */
export type TMachineState<TArgs, TData> = TQueryEntryState<TArgs, TData>;

/** @deprecated Renamed to {@link TQueryEntryStatus}. Will be removed in 0.14.0. */
export type TMachineStatus = TQueryEntryStatus;

/** @deprecated Renamed to {@link TQueryEntryPendingState}. Will be removed in 0.14.0. */
export type TPendingState<TArgs> = TQueryEntryPendingState<TArgs>;

/** @deprecated Renamed to {@link TQueryEntrySuccessState}. Will be removed in 0.14.0. */
export type TSuccessState<TArgs, TData> = TQueryEntrySuccessState<TArgs, TData>;

/** @deprecated Renamed to {@link TQueryEntryErrorState}. Will be removed in 0.14.0. */
export type TErrorState<TArgs> = TQueryEntryErrorState<TArgs>;

/** @deprecated Renamed to {@link TQueryEntryInvalidatingState}. Will be removed in 0.14.0. */
export type TInvalidatingState<TArgs, TData> = TQueryEntryInvalidatingState<TArgs, TData>;

/** @deprecated Renamed to {@link TQueryEntryInvalidateErrorState}. Will be removed in 0.14.0. */
export type TInvalidateErrorState<TArgs, TData> = TQueryEntryInvalidateErrorState<TArgs, TData>;
