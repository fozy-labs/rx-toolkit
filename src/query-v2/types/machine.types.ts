import type { NO_VALUE } from './shared.types';

/** Discriminated union of all machine statuses */
export type TMachineStatus = 'idle' | 'pending' | 'success' | 'error' | 'refreshing';

/** Idle state — initial, no data */
export interface TResourceV2IdleState {
    status: 'idle';
    args: null;
    data: null;
    error: null;
    updatedAt: null;
}

/** Pending state — query in progress, no data yet */
export interface TResourceV2PendingState<TData = unknown> {
    status: 'pending';
    args: unknown;
    data: null;
    error: null;
    updatedAt: null;
    originalData: TData | NO_VALUE;
}

/** Success state — data loaded successfully */
export interface TResourceV2SuccessState<TData = unknown> {
    status: 'success';
    args: unknown;
    data: TData;
    error: null;
    updatedAt: number;
    originalData: TData | NO_VALUE;
    patches: TResourceV2Patch[] | null;
}

/** Error state — query failed */
export interface TResourceV2ErrorState<TError = Error> {
    status: 'error';
    args: unknown;
    data: null;
    error: TError;
    updatedAt: null;
}

/** Refreshing state — re-fetching while holding stale data */
export interface TResourceV2RefreshingState<TData = unknown> {
    status: 'refreshing';
    args: unknown;
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
    status: 'pending' | 'committed' | 'aborted';
}

/** Patch function (Immer recipe) */
export type TPatchFn<TData> = (draft: TData) => void;

/**
 * Discriminated union of all machine states.
 * Initially defined as state shape union; will be refined to class types in Phase 2.
 */
export type TMachine<TData, TError = Error> =
    | TResourceV2IdleState
    | TResourceV2PendingState<TData>
    | TResourceV2SuccessState<TData>
    | TResourceV2ErrorState<TError>
    | TResourceV2RefreshingState<TData>;
