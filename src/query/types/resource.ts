import type { Observable } from "rxjs";

import type { TArgsOrVoidOrSkip, TResourceSnapshot } from "@/query";
import type { ReadonlySignal } from "@/signals/types";

import type { TLifecycleHookOption, TMapError } from "./api";
import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { TArgsOrKeyed, TArgsOrVoid, TKeyed } from "./common";
import type { TResourceClutchState, TRetrying } from "./state";

// ==================== Resource Interface ====================

export interface IResource<TArgs, TData, TError = unknown> {
    /**
     * @deprecated Use {@link prefetch}: `trigger(args)` ≈ `prefetch(args)`,
     * `trigger(args, true)` ≈ `prefetch(args, { force: true })`. Not an exact
     * match on an `error`-state entry: `prefetch` retries it in both modes,
     * while `trigger` left it untouched. And unlike `trigger`, every
     * `prefetch` call — cache hits included — holds a keepalive subscription
     * until it settles and then restarts the entry's retention countdown.
     * Will be removed in a future release.
     */
    trigger(args: TArgsOrKeyed<TArgs>, doForce?: boolean): void;
    /** Mark the entry for these arguments stale and re-query it in the background. */
    invalidate(args: TArgsOrKeyed<TArgs>): void;
    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh(args: TArgsOrKeyed<TArgs>): void;
    getEntry(args: TArgsOrVoid<TArgs>, doInitiate: true): IQueryCacheEntry<TArgs, TData>;
    getEntry(args: TArgsOrVoid<TArgs>, doInitiate?: boolean): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(args: TArgsOrVoid<TArgs>, doInitiate?: boolean): ReadonlySignal<IQueryCacheEntry<TArgs, TData> | null>;
    getEntries(): IterableIterator<IQueryCacheEntry<TArgs, TData>>;
    createClutch(): IResourceClutch<TArgs, TData, TError>;
    /** @deprecated Renamed to {@link createClutch}. Will be removed in 0.14.0. */
    createAgent(): IResourceClutch<TArgs, TData, TError>;
    serialize(args: TArgsOrKeyed<TArgs>): string;
    toKeyed(args: TArgsOrKeyed<TArgs>): TKeyed<TArgs>;
    getState(args: TArgsOrVoid<TArgs>): TResourceEntryState<TArgs, TData, TError>;
    bind(args: TArgsOrKeyed<TArgs>): TBoundResource<TArgs, TData, TError>;
    /** @deprecated Renamed to {@link bind}. Will be removed in 0.14.0. */
    pack(args: TArgsOrKeyed<TArgs>): TBoundResource<TArgs, TData, TError>;
    /** Resolve with cached data, loading it first when absent. Rejects on failure/abort. */
    ensure(args: TArgsOrKeyed<TArgs>, options?: TResourceFetchOptions): Promise<TData>;
    /** Resolve with the result of a fresh query. Rejects on failure/abort. */
    fetch(args: TArgsOrKeyed<TArgs>, options?: TResourceFetchOptions): Promise<TData>;
    /** Fire-and-forget cache warm-up; creates the entry synchronously, never rejects. */
    prefetch(args: TArgsOrKeyed<TArgs>, options?: TResourcePrefetchOptions): Promise<void>;
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
     * invalidated (or retried after an error) instead of being reused as-is —
     * the fire-and-forget counterpart of {@link IResource.fetch}.
     */
    force?: boolean;
}

// ==================== Bound Descriptor ====================

/**
 * Inert descriptor binding a resource to a set of arguments. Produced by
 * {@link IResource.bind} — lets a consumer hand "what to read, with which args"
 * back to the library without executing anything. Discriminated by `kind`;
 * see {@link TBound} for the command counterpart.
 */
export interface TBoundResource<TArgs, TData, TError = unknown> {
    kind: "resource";
    resource: IResource<TArgs, TData, TError>;
    args: TArgsOrKeyed<TArgs>;
}

// The entry state (returned by {@link IResource.getState}) is a discriminated
// union like the clutch state, but without SWR: it reflects a single cache
// entry, so the `error` variant never carries stale data and there is no
// `retry` / `invalidate`. The loading variants share the clutch's retry
// bookkeeping ({@link TRetrying}).

/** No cache entry exists for the given arguments. */
export interface TResourceEntryIdleState {
    status: "idle";
    data: null;
    error: null;
    args: null;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRetrying: false;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

interface TResourceEntryPendingBase<TArgs> {
    status: "pending";
    data: null;
    args: TArgs;
    isLoading: true;
    isInitialLoading: true;
    isRefreshing: false;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

/** Initial load in flight: no data yet. With `isRetrying`, `error` holds the retried failure. */
export type TResourceEntryPendingState<TArgs, TError = unknown> = TResourceEntryPendingBase<TArgs> & TRetrying<TError>;

/** Query succeeded: `data` is present, no error. */
export interface TResourceEntrySuccessState<TArgs, TData> {
    status: "success";
    data: TData;
    error: null;
    args: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRetrying: false;
    isRefreshError: false;
    isSuccess: true;
    isError: false;
}

/** Initial query failed: `error` is present, no data. */
export interface TResourceEntryErrorState<TArgs, TError = unknown> {
    status: "error";
    data: null;
    error: TError;
    args: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRetrying: false;
    isRefreshError: false;
    isSuccess: false;
    isError: true;
}

interface TResourceEntryInvalidatingBase<TArgs, TData> {
    status: "invalidating";
    data: TData;
    args: TArgs;
    isLoading: true;
    isInitialLoading: false;
    isRefreshing: true;
    isRefreshError: false;
    isSuccess: false;
    isError: false;
}

/** Background invalidation in flight; stale `data` stays available. With `isRetrying`, `error` holds the retried failure. */
export type TResourceEntryInvalidatingState<TArgs, TData, TError = unknown> = TResourceEntryInvalidatingBase<
    TArgs,
    TData
> &
    TRetrying<TError>;

/** Background invalidation failed; stale `data` is preserved. */
export interface TResourceEntryInvalidateErrorState<TArgs, TData, TError = unknown> {
    status: "invalidate-error";
    data: TData;
    error: TError;
    args: TArgs;
    isLoading: false;
    isInitialLoading: false;
    isRefreshing: false;
    isRetrying: false;
    isRefreshError: true;
    isSuccess: false;
    isError: true;
}

export type TResourceEntryState<TArgs, TData, TError = unknown> =
    | TResourceEntryIdleState
    | TResourceEntryPendingState<TArgs, TError>
    | TResourceEntrySuccessState<TArgs, TData>
    | TResourceEntryErrorState<TArgs, TError>
    | TResourceEntryInvalidatingState<TArgs, TData, TError>
    | TResourceEntryInvalidateErrorState<TArgs, TData, TError>;

// ==================== Resource Clutch Interface ====================

/** Options of {@link IResourceClutch.switch}. */
export interface TClutchSwitchOptions {
    /**
     * Report `pending` instead of `idle` while the clutch has not been started
     * yet and no entry exists. React hooks set the args during render and start
     * the clutch in a layout effect; marking hides that gap.
     */
    markPending?: boolean;
}

export interface IResourceClutch<TArgs, TData, TError = unknown> {
    state$: ReadonlySignal<TResourceClutchState<TArgs, TData, TError>>;
    start(): void;
    /**
     * Engage the clutch on another set of arguments (or disengage it with
     * `SKIP`). The previous entry's data is kept as the SWR fallback while the
     * new one loads.
     */
    switch(args: TArgsOrVoidOrSkip<TArgs>, options?: TClutchSwitchOptions): void;
    /**
     * @deprecated Renamed to {@link switch}; the boolean `mark` argument became
     * `{ markPending: true }`. Will be removed in 0.14.0.
     */
    set(args: TArgsOrVoidOrSkip<TArgs>, mark?: boolean): void;
    /**
     * Take over `source`'s data as this clutch's SWR fallback — what `switch`
     * keeps from the previous args on a single clutch, for consumers that
     * replace the clutch instead (one clutch per args). Reads `source` once; it
     * is not kept.
     */
    adoptPrevious(source: IResourceClutch<TArgs, TData, TError>): void;
    retry(): void;
    invalidate(): void;
    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh(): void;
    /**
     * Promise resolving once the clutch leaves the initial-loading phase — data
     * became available (success / invalidating / invalidate-error / stale SWR) or the
     * query failed with nothing to fall back on. Never rejects. Used by the
     * Suspense hook to wake React after a suspended render.
     */
    whenSettled(): Promise<void>;
    get args(): TArgs | null;
}

// ==================== Resource Options ====================

/**
 * What a resource's queryFn may return.
 *
 * - `Promise<TData>` — a one-shot query: resolves once, settles the run.
 * - `Observable<TData>` — a streaming query: the first emission settles the
 *   run (pending → success), every subsequent emission updates the entry's
 *   data in place (active optimistic patches are rebased onto it), an error
 *   after data lands in `invalidate-error` with the data kept, and completion
 *   simply ends the live phase — the entry keeps the last emission. The
 *   subscription is torn down when the entry is evicted or the run is
 *   superseded (invalidate / retry resubscribe); completing without a single
 *   emission fails the run with `EmptyStreamError`.
 */
export type TQueryFnResult<TData> = Promise<TData> | Observable<TData>;

export interface TResourceOptions<TArgs, TData> {
    queryFn: (args: TArgs, abortSignal: AbortSignal) => TQueryFnResult<TData>;
    key?: string;
    retentionTime?: number | false;
    serializeArgs?: (args: TArgs) => string;
    /** See {@link TLifecycleHookOption} for the array form. */
    onCacheEntryAdded?: TLifecycleHookOption<(args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void>;
    /** See {@link TLifecycleHookOption} for the array form. */
    onQueryStarted?: TLifecycleHookOption<
        (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>
    >;
    snapshotValidTime?: number | false;
    /**
     * When `false`, the resource neither contributes entries to `getSnapshot()`
     * nor hydrates from `initialSnapshot`, regardless of its `key`. For derived
     * resources whose data is owned elsewhere (projection resources set this
     * automatically). Defaults to `true`.
     */
    snapshotable?: boolean;
    sync?: boolean;
    /**
     * Suppresses the one-time warning logged when an optimistic patch is
     * created while a query stream is open. While the stream lives, every
     * emission rebases over active patches and a committed patch dissolves
     * into the next emission's data — set this to `true` once that interplay
     * is intended. Defaults to `false`.
     */
    allowStreamPatches?: boolean;
}

// ==================== Resource Config (internal) ====================

export interface IResourceConfig<TArgs, TData> {
    queryFn: (args: TArgs, abortSignal: AbortSignal) => TQueryFnResult<TData>;
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
    /** Pre-populated entries from snapshot hydration (key → snapshot meta). */
    snapshot?: TResourceSnapshot;
    /** When `false`, the resource is skipped by `Snapshotter.getSnapshot`. Defaults to `true`. */
    snapshotable?: boolean;
    /** Cross-tab sync hook: called before queryFn to check if another tab has cached data. */
    beforeQuery?: (resourceKey: string, entryKey: string) => Promise<{ data: TData } | null>;
    /** See {@link TResourceOptions.allowStreamPatches}. Defaults to `false`. */
    allowStreamPatches?: boolean;
}

// ==================== Deprecated Aliases ====================

/** @deprecated Renamed to {@link IResourceClutch}. Will be removed in 0.14.0. */
export type IResourceAgent<TArgs, TData, TError = unknown> = IResourceClutch<TArgs, TData, TError>;

/** @deprecated Renamed to {@link TBoundResource}. Will be removed in 0.14.0. */
export type TPackedResource<TArgs, TData, TError = unknown> = TBoundResource<TArgs, TData, TError>;
