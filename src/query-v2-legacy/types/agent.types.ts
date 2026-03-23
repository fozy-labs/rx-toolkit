import type { TMachineStatus, TPatchFn } from "./machine.types";

/** SKIP_TOKEN type alias for agent args */
type SKIP_TOKEN = typeof import("../lib/SKIP_TOKEN").SKIP;

/** Agent — observer with stale-while-revalidate */
export interface IResourceV2Agent<TArgs, TData, TError = Error> {
    /** Reactive state (computed signal) */
    readonly state$: () => IResourceV2AgentState<TArgs, TData, TError>;

    /** Start query with new args (returns promise) */
    start(args: TArgs | SKIP_TOKEN): Promise<void>;

    /** Compare previous and new args */
    compareArgs(a: TArgs, b: TArgs): boolean;
}

/** Agent's computed state shape */
export interface IResourceV2AgentState<TArgs, TData, TError = Error> {
    /** Current machine status */
    status: TMachineStatus;
    /** Current data (may be stale during loading) */
    data: TData | null;
    /** Current error */
    error: TError | null;
    /** Current args (fresh) */
    args: TArgs | null;
    /** Loading indicator */
    isLoading: boolean;
    /** True only on first load (no previous data) */
    isInitialLoading: boolean;
    /** True when refreshing existing data */
    isRefreshing: boolean;
    /** True when data is available */
    isSuccess: boolean;
    /** True when in error state */
    isError: boolean;
}

/** Ref — imperative access to a specific cache entry by args */
export interface IResourceV2Ref<_TArgs, TData, _TError = Error> {
    /** Check if cache entry exists */
    readonly has: boolean;
    /** Lock cache entry (prevent eviction) */
    lock(): { unlock: () => void };
    /** Invalidate (force re-fetch) */
    invalidate(): void;
    /** Create optimistic patch */
    createPatch(patchFn: TPatchFn<TData>): {
        commit: () => void;
        abort: () => void;
    } | null;
    /** Pre-populate cache with data */
    create(data: TData): void;
}
