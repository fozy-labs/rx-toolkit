// ==================== Hook State Types (for React consumers) ====================

// Agent states are discriminated unions: `status` is the primary discriminant,
// and every boolean flag is a literal per variant, so narrowing works through
// either — `state.isError` implies `state.error: TError`, `state.isSuccess`
// implies `state.data: TData`, and so on.

/** Methods present on every resource agent state variant. */
interface TResourceAgentStateMethods {
    /** Re-run the last failed query. No-op outside the error states. */
    retry: () => void;
    /** Force a background refresh of the current entry (SWR). */
    refresh: () => void;
}

/** No observation: the agent was given `SKIP` or has not received arguments yet. */
export interface TResourceAgentIdleState extends TResourceAgentStateMethods {
    status: "idle";
    data: null;
    error: null;
    args: null;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

/** Initial load in flight: no data yet (nothing cached, no SWR fallback). */
export interface TResourceAgentPendingState<TArgs> extends TResourceAgentStateMethods {
    status: "pending";
    data: null;
    error: null;
    args: TArgs;
    isLoading: true;
    isInitialLoading: true;
    isRefreshing: false;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

/** Query succeeded: `data` is present, no error. */
export interface TResourceAgentSuccessState<TArgs, TData> extends TResourceAgentStateMethods {
    status: "success";
    data: TData;
    error: null;
    args: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRefreshError: false;
    isSuccess: true;
    isError: false;
}

/**
 * Initial query failed. `data` is usually `null`, but preserves the previous
 * entry's stale data when the arguments changed under SWR.
 */
export interface TResourceAgentErrorState<TArgs, TData, TError = unknown> extends TResourceAgentStateMethods {
    status: "error";
    data: TData | null;
    error: TError;
    args: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRefreshError: false;
    isSuccess: false;
    isError: true;
}

/** Background refresh in flight; stale `data` stays available (SWR). */
export interface TResourceAgentRefreshingState<TArgs, TData> extends TResourceAgentStateMethods {
    status: "refreshing";
    data: TData;
    error: null;
    args: TArgs;
    isLoading: true;
    isInitialLoading: false;
    isRefreshing: true;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

/** Background refresh failed; stale `data` is preserved. */
export interface TResourceAgentRefreshErrorState<TArgs, TData, TError = unknown> extends TResourceAgentStateMethods {
    status: "refresh-error";
    data: TData;
    error: TError;
    args: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRefreshError: true;
    isSuccess: false;
    isError: true;
}

export type TResourceAgentState<TArgs, TData, TError = unknown> =
    | TResourceAgentIdleState
    | TResourceAgentPendingState<TArgs>
    | TResourceAgentSuccessState<TArgs, TData>
    | TResourceAgentErrorState<TArgs, TData, TError>
    | TResourceAgentRefreshingState<TArgs, TData>
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
    | TResourceAgentRefreshingState<TArgs, TData>
    | TResourceAgentRefreshErrorState<TArgs, TData, TError>
    | TSuspenseResourceErrorState<TArgs, TData, TError>;

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
