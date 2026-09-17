// ==================== Hook State Types (for React consumers) ====================

import type { Args } from "./common";

// Agent states are discriminated unions: `status` is the primary discriminant,
// and every boolean flag is a literal per variant, so narrowing works through
// either — `state.isError` implies `state.error: TError`, `state.isSuccess`
// implies `state.data: TData`, and so on.
//
// `args` are the arguments the agent observes; `dataArgs` are the arguments
// `data` was loaded for. They differ only under SWR across an args change,
// when the previous entry's data is shown while the new one loads (or after it
// failed). `isSwitching` reports that load in flight.
//
// `isRetrying` reports a load started by `retry()` from `error` / `refresh-error`;
// the retried failure stays readable in `error` while it runs (`isError` is
// still `false`). A first load or a `refresh()` reports `isRetrying: false`.

/** Methods present on every resource agent state variant. */
interface TResourceAgentStateMethods {
    /**
     * Re-run the failed query: `error` → `pending`, `refresh-error` →
     * `refreshing`, both marked `isRetrying` with the failure kept in `error`.
     * No-op outside the error states.
     */
    retry: () => void;
    /** Force a background refresh of the current entry (SWR). */
    refresh: () => void;
}

/**
 * Retry bookkeeping of the loading variants: a load started by `retry()` keeps
 * the retried failure in `error`; any other load has none.
 */
export type TRetrying<TError> = { isRetrying: false; error: null } | { isRetrying: true; error: TError };

/** No observation: the agent was given `SKIP` or has not received arguments yet. */
export interface TResourceAgentIdleState extends TResourceAgentStateMethods {
    status: "idle";
    data: null;
    error: null;
    args: null;
    dataArgs: null;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isSwitching: false;
    isRetrying: false;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

interface TResourceAgentPendingBase<TArgs> extends TResourceAgentStateMethods {
    status: "pending";
    data: null;
    args: TArgs;
    dataArgs: null;
    isLoading: true;
    isInitialLoading: true;
    isRefreshing: false;
    isSwitching: false;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

/**
 * Initial load in flight: no data yet (nothing cached, no SWR fallback). With
 * `isRetrying`, it is a `retry()` of a failed initial load and `error` holds
 * that failure.
 */
export type TResourceAgentPendingState<TArgs, TError = unknown> = TResourceAgentPendingBase<TArgs> & TRetrying<TError>;

/** Query succeeded: `data` is present, no error. */
export interface TResourceAgentSuccessState<TArgs, TData> extends TResourceAgentStateMethods {
    status: "success";
    data: TData;
    error: null;
    args: TArgs;
    dataArgs: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isSwitching: false;
    isRetrying: false;
    isRefreshError: false;
    isSuccess: true;
    isError: false;
}

/**
 * Initial query failed. `data` is usually `null`, but preserves the previous
 * entry's stale data when the arguments changed under SWR — `dataArgs` then
 * holds that entry's arguments.
 */
export interface TResourceAgentErrorState<TArgs, TData, TError = unknown> extends TResourceAgentStateMethods {
    status: "error";
    data: TData | null;
    error: TError;
    args: TArgs;
    dataArgs: TArgs | null;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isSwitching: false;
    isRetrying: false;
    isRefreshError: false;
    isSuccess: false;
    isError: true;
}

interface TResourceAgentRefreshingBase<TArgs, TData> extends TResourceAgentStateMethods {
    status: "refreshing";
    data: TData;
    args: TArgs;
    dataArgs: TArgs;
    isLoading: true;
    isInitialLoading: false;
    isRefreshing: true;
    isSwitching: boolean;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

/**
 * A load is in flight behind stale `data` (SWR): either a background refresh of
 * the current entry, or — with `isSwitching` — the initial load of the new
 * arguments while the previous entry's data (`dataArgs`) is still shown. With
 * `isRetrying`, the load is a `retry()` of a failure that `error` still holds.
 */
export type TResourceAgentRefreshingState<TArgs, TData, TError = unknown> = TResourceAgentRefreshingBase<TArgs, TData> &
    TRetrying<TError>;

/** Background refresh failed; stale `data` is preserved. */
export interface TResourceAgentRefreshErrorState<TArgs, TData, TError = unknown> extends TResourceAgentStateMethods {
    status: "refresh-error";
    data: TData;
    error: TError;
    args: TArgs;
    dataArgs: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isSwitching: false;
    isRetrying: false;
    isRefreshError: true;
    isSuccess: false;
    isError: true;
}

export type TResourceAgentState<TArgs, TData, TError = unknown> =
    | TResourceAgentIdleState
    | TResourceAgentPendingState<TArgs, TError>
    | TResourceAgentSuccessState<TArgs, TData>
    | TResourceAgentErrorState<TArgs, TData, TError>
    | TResourceAgentRefreshingState<TArgs, TData, TError>
    | TResourceAgentRefreshErrorState<TArgs, TData, TError>;

/**
 * Error state as returned by the Suspense-enabled resource hook.
 *
 * Reachable only when stale SWR data exists — an initial error with nothing to
 * fall back on is thrown to the nearest Error Boundary instead — so `data` is
 * guaranteed non-null here.
 */
export interface TSuspenseResourceErrorState<TArgs, TData, TError = unknown> extends TResourceAgentErrorState<
    TArgs,
    TData,
    TError
> {
    data: TData;
    dataArgs: TArgs;
}

/**
 * State returned by the Suspense-enabled resource hook.
 *
 * The subset of {@link TResourceAgentState} variants with `data` guaranteed
 * non-null: the hook only returns once data is available (initial loading
 * suspends, an initial error with no fallback data is thrown to the nearest
 * Error Boundary). Background refreshes still surface through `isRefreshing` /
 * `isRefreshError` without suspending.
 */
export type TSuspenseResourceState<TArgs, TData, TError = unknown> =
    | TResourceAgentSuccessState<TArgs, TData>
    | TResourceAgentRefreshingState<TArgs, TData, TError>
    | TResourceAgentRefreshErrorState<TArgs, TData, TError>
    | TSuspenseResourceErrorState<TArgs, TData, TError>;

/**
 * State returned by the infinite projection-resource hook (`useInfiniteResource`).
 *
 * The feed is a list of *pages*: every page is an ordinary cache entry of the
 * projection resource with its own fixed args (an id-set), observed through its own
 * agent. `TData` is the page data type — the projection item array (`TItem[]`) —
 * and `data` flattens the pages' items in page order.
 */
export interface TInfiniteResourceState<TArgs, TData, TError = unknown> {
    /**
     * Items of every page that has data, flattened in page order; `null` until
     * the first page delivers data.
     */
    data: TData | null;
    /** Per-page agent states, in load order. Empty while the feed is idle. */
    pages: TResourceAgentState<TArgs, TData, TError>[];
    /** No pages observed — the initial args are `SKIP`. */
    isIdle: boolean;
    /** The first page's initial load is in flight and there is nothing to show yet. */
    isInitialLoading: boolean;
    /** Some page is loading (initial load or background refresh). */
    isLoading: boolean;
    /** A page beyond the first is doing its initial load. */
    isFetchingNext: boolean;
    /** `true` when some page holds an error (see {@link error}). */
    isError: boolean;
    /** The first error across pages, in page order. */
    error: TError | null;
    /**
     * Append the next page with the given args and start loading it. Passing
     * the args of an already-present page is a no-op (double-click safe),
     * except when that page previously failed — then it is retried.
     */
    fetchNext: (args: Args<TArgs>) => void;
    /** Re-validate the whole feed: refresh pages with data, retry failed ones. */
    refresh: () => void;
    /** Drop every page after the first one. */
    reset: () => void;
}

/** Methods present on every command agent state variant. */
interface TCommandAgentStateMethods {
    /** Re-execute the tracked mutation after it failed. No-op unless in the `error` state. */
    retry: () => void;
}

/** No observation: nothing triggered yet and no cache key bound. */
export interface TCommandAgentIdleState extends TCommandAgentStateMethods {
    status: "idle";
    data: null;
    error: null;
    args: null;
    isLoading: false;
    isSuccess: false;
    isError: false;
}

/**
 * Mutation in flight. `data` / `error` are normally `null`; they carry stale
 * values through when a manually refreshed command entry (machine `refreshing` /
 * `refresh-error`) is defensively remapped to `pending`.
 */
export interface TCommandAgentPendingState<TArgs, TData, TError = unknown> extends TCommandAgentStateMethods {
    status: "pending";
    data: TData | null;
    error: TError | null;
    args: TArgs;
    isLoading: true;
    isSuccess: false;
    isError: false;
}

/** Mutation succeeded: `data` is present, no error. */
export interface TCommandAgentSuccessState<TArgs, TData> extends TCommandAgentStateMethods {
    status: "success";
    data: TData;
    error: null;
    args: TArgs;
    isLoading: false;
    isSuccess: true;
    isError: false;
}

/** Mutation failed: `error` is present, no data. */
export interface TCommandAgentErrorState<TArgs, TError = unknown> extends TCommandAgentStateMethods {
    status: "error";
    data: null;
    error: TError;
    args: TArgs;
    isLoading: false;
    isSuccess: false;
    isError: true;
}

export type TCommandAgentState<TArgs, TData, TError = unknown> =
    | TCommandAgentIdleState
    | TCommandAgentPendingState<TArgs, TData, TError>
    | TCommandAgentSuccessState<TArgs, TData>
    | TCommandAgentErrorState<TArgs, TError>;
