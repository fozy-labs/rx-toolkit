import type { NO_VALUE } from "./shared.types";

/** Discriminated union of all machine statuses */
export type TMachineStatus = "idle" | "pending" | "success" | "error" | "refreshing";

/** Idle state — initial, no data */
export interface TResourceV2IdleState {
    status: "idle";
    args: null;
    data: null;
    error: null;
    updatedAt: null;
}

/** Pending state — query in progress, no data yet */
export interface TResourceV2PendingState<TArgs = unknown, TData = unknown> {
    status: "pending";
    args: TArgs;
    data: null;
    error: null;
    updatedAt: null;
    originalData: TData | NO_VALUE;
}

/** Success state — data loaded successfully */
export interface TResourceV2SuccessState<TArgs = unknown, TData = unknown> {
    status: "success";
    args: TArgs;
    data: TData;
    error: null;
    updatedAt: number;
    originalData: TData | NO_VALUE;
    patches: TResourceV2Patch[] | null;
}

/** Error state — query failed */
export interface TResourceV2ErrorState<TArgs = unknown> {
    status: "error";
    args: TArgs;
    data: null;
    error: unknown;
    updatedAt: null;
}

/** Refreshing state — re-fetching while holding stale data */
export interface TResourceV2RefreshingState<TArgs = unknown, TData = unknown> {
    status: "refreshing";
    args: TArgs;
    data: TData;
    error: null;
    updatedAt: number;
    originalData: TData | NO_VALUE;
    patches: TResourceV2Patch[] | null;
}

/** Patch record in the queue (Immer-based) */
export interface TResourceV2Patch {
    patches: unknown[];
    inversePatches: unknown[];
    status: "pending" | "committed" | "aborted";
}

/** Patch function (Immer recipe) */
export type TPatchFn<TData> = (draft: TData) => void;

/**
 * Discriminated union of all machine states (flat state shapes).
 */
export type TMachine<TArgs = unknown, TData = unknown> =
    | TResourceV2IdleState
    | TResourceV2PendingState<TArgs, TData>
    | TResourceV2SuccessState<TArgs, TData>
    | TResourceV2ErrorState<TArgs>
    | TResourceV2RefreshingState<TArgs, TData>;
