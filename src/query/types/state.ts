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

export interface TCommandAgentState<TArgs, TData> {
    status: "idle" | "pending" | "success" | "error";
    data: TData | null;
    error: unknown;
    args: TArgs | null;
    isLoading: boolean;
    isSuccess: boolean;
    isError: boolean;
}
