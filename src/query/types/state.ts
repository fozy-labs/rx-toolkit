import type { TAgentStatus } from "./common";

// ==================== Hook State Types (for React consumers) ====================

export interface TResourceAgentState<TArgs, TData> {
    status: TAgentStatus;
    data: TData | null;
    error: unknown;
    args: TArgs | null;
    isLoading: boolean;
    isInitialLoading: boolean;
    isRefreshing: boolean;
    isRefreshError: boolean;
    isSuccess: boolean;
    isError: boolean;
    retry: () => void;
    refresh: () => void;
}

/**
 * State returned by the Suspense-enabled resource hook.
 *
 * Identical to {@link TResourceAgentState}, but `data` is guaranteed non-null:
 * the hook only returns once data is available (initial loading suspends, an
 * initial error is thrown to the nearest Error Boundary). Background refreshes
 * still surface through `isRefreshing` / `isRefreshError` without suspending.
 */
export interface TSuspenseResourceState<TArgs, TData> extends Omit<TResourceAgentState<TArgs, TData>, "data"> {
    data: TData;
}

export interface TCommandAgentState<TArgs, TData> {
    status: "idle" | "pending" | "success" | "error";
    data: TData | null;
    error: unknown;
    args: TArgs | null;
    isLoading: boolean;
    isSuccess: boolean;
    isError: boolean;
    /** Re-execute the tracked mutation after it failed. No-op unless in the `error` state. */
    retry: () => void;
}
