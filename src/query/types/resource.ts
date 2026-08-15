import type { ArgsOrVoidOrSkip, TResourceSnapshot } from "@/query";
import type { ReadonlySignal } from "@/signals/types";

import type { TMapError } from "./api";
import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { Args, ArgsOrVoid, Keyed } from "./common";
import type { TResourceAgentState } from "./state";

// ==================== Resource Interface ====================

export interface IResource<TArgs, TData, TError = unknown> {
    /**
     * @deprecated Use {@link prefetch}: `trigger(args)` ≡ `prefetch(args)`,
     * `trigger(args, true)` ≈ `prefetch(args, { force: true })`. Will be
     * removed in a future release.
     */
    trigger(args: Args<TArgs>, doForce?: boolean): void;
    refresh(args: Args<TArgs>): void;
    getEntry(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): ReadonlySignal<IQueryCacheEntry<TArgs, TData> | null>;
    getEntries(): IterableIterator<IQueryCacheEntry<TArgs, TData>>;
    createAgent(): IResourceAgent<TArgs, TData, TError>;
    serialize(args: Args<TArgs>): string;
    toKeyed(args: Args<TArgs>): Keyed<TArgs>;
    getState(args: ArgsOrVoid<TArgs>): IResourceLiteState<TArgs, TData, TError>;
    pack(args: Args<TArgs>): TPackedResource<TArgs, TData, TError>;
    /** Resolve with cached data, loading it first when absent. Rejects on failure/abort. */
    ensure(args: Args<TArgs>, options?: TResourceFetchOptions): Promise<TData>;
    /** Resolve with the result of a fresh query. Rejects on failure/abort. */
    fetch(args: Args<TArgs>, options?: TResourceFetchOptions): Promise<TData>;
    /** Fire-and-forget cache warm-up; creates the entry synchronously, never rejects. */
    prefetch(args: Args<TArgs>, options?: TResourcePrefetchOptions): Promise<void>;
}

// ==================== Fetch Options ====================

/**
 * Options for the imperative {@link IResource.ensure} / {@link IResource.fetch}
 * methods.
 */
export interface TResourceFetchOptions {
    /**
     * Detaches the caller from the awaited query when aborted: the returned
     * promise rejects with the signal's reason. The underlying query is left
     * running for any other consumers and is torn down by retention GC only once
     * no consumer remains — aborting one caller never cancels a shared in-flight
     * request. {@link IResource.prefetch} is intentionally not abort-aware.
     */
    signal?: AbortSignal;
}

/** Options for {@link IResource.prefetch}. */
export interface TResourcePrefetchOptions {
    /**
     * When `true`, warms the cache with *fresh* data: an existing entry is
     * refreshed (or retried after an error) instead of being reused as-is —
     * the fire-and-forget counterpart of {@link IResource.fetch}.
     */
    force?: boolean;
}

// ==================== Packed Descriptor ====================

/**
 * Inert descriptor binding a resource to a set of arguments. Produced by
 * {@link IResource.pack} — lets a consumer hand "what to read, with which args"
 * back to the library without executing anything. Discriminated by `kind`;
 * see {@link TPacked} for the command counterpart.
 */
export interface TPackedResource<TArgs, TData, TError = unknown> {
    kind: "resource";
    resource: IResource<TArgs, TData, TError>;
    args: Args<TArgs>;
}

// The lite state (returned by {@link IResource.getState}) is a discriminated
// union like the agent state, but without SWR: it reflects a single cache
// entry, so the `error` variant never carries stale data and there is no
// `retry` / `refresh`.

/** No cache entry exists for the given arguments. */
export interface TResourceLiteIdleState {
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

/** Initial load in flight: no data yet. */
export interface TResourceLitePendingState<TArgs> {
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
export interface TResourceLiteSuccessState<TArgs, TData> {
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

/** Initial query failed: `error` is present, no data. */
export interface TResourceLiteErrorState<TArgs, TError = unknown> {
    status: "error";
    data: null;
    error: TError;
    args: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRefreshError: false;
    isSuccess: false;
    isError: true;
}

/** Background refresh in flight; stale `data` stays available. */
export interface TResourceLiteRefreshingState<TArgs, TData> {
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
export interface TResourceLiteRefreshErrorState<TArgs, TData, TError = unknown> {
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

export type IResourceLiteState<TArgs, TData, TError = unknown> =
    | TResourceLiteIdleState
    | TResourceLitePendingState<TArgs>
    | TResourceLiteSuccessState<TArgs, TData>
    | TResourceLiteErrorState<TArgs, TError>
    | TResourceLiteRefreshingState<TArgs, TData>
    | TResourceLiteRefreshErrorState<TArgs, TData, TError>;

// ==================== Resource Agent Interface ====================

export interface IResourceAgent<TArgs, TData, TError = unknown> {
    state$: ReadonlySignal<TResourceAgentState<TArgs, TData, TError>>;
    start(): void;
    set(args: ArgsOrVoidOrSkip<TArgs>, mark?: boolean): void;
    retry(): void;
    refresh(): void;
    /**
     * Promise resolving once the agent leaves the initial-loading phase — data
     * became available (success / refreshing / refresh-error / stale SWR) or the
     * query failed with nothing to fall back on. Never rejects. Used by the
     * Suspense hook to wake React after a suspended render.
     */
    whenSettled(): Promise<void>;
    get args(): TArgs | null;
}

// ==================== Resource Options ====================

export interface TResourceOptions<TArgs, TData> {
    queryFn: (args: TArgs, abortSignal: AbortSignal) => Promise<TData>;
    key?: string;
    retentionTime?: number | false;
    serializeArgs?: (args: TArgs) => string;
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
    snapshotValidTime?: number | false;
    sync?: boolean;
    getDevtoolsKey?: (args: Keyed<TArgs>) => string;
}

// ==================== Resource Config (internal) ====================

export interface IResourceConfig<TArgs, TData> {
    queryFn: (args: TArgs, abortSignal: AbortSignal) => Promise<TData>;
    key?: string;
    retentionTime: number | false;
    serializeArgs: (args: TArgs) => string;
    /**
     * Normalizes raw query errors before they enter the machine. The Api always
     * supplies one (identity when the consumer configured no `mapError`);
     * defaults to identity if constructed directly. See {@link TMapError}.
     */
    mapError?: TMapError;
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
    getDevtoolsKey?: (args: Keyed<TArgs>) => string;
    /** Pre-populated entries from snapshot hydration (key → snapshot meta). */
    snapshot?: TResourceSnapshot;
    /** Cross-tab sync hook: called before queryFn to check if another tab has cached data. */
    beforeQuery?: (resourceKey: string, entryKey: string) => Promise<{ data: TData } | null>;
}
