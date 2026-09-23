import type { Observable } from "rxjs";

import type { TArgsOrVoidOrSkip, TResourceSnapshot } from "@/query";
import type { ReadonlySignal } from "@/signals/types";

import type { TLifecycleHookOption, TMapError } from "./api";
import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { TArgsOrKeyed, TArgsOrVoid, TInFlightPolicy, TInvalidateOptions, TKeyed, TRetentionTime } from "./common";
import type { TDataSlotCurrent, TDataSlotNone, TErrorSlot, TResourceClutchState } from "./state";

// ==================== Resource Interface ====================

export interface IResource<TArgs, TData, TError = unknown> {
    /**
     * Mark the entry for these arguments stale and re-query it: at once when
     * the entry is held, on its next hold otherwise. With a run in flight,
     * `opts.inFlight` (else the resource's `invalidateInFlight`) decides whether
     * it is cancelled, trailed or joined.
     */
    invalidate(args: TArgsOrKeyed<TArgs>, opts?: TInvalidateOptions): void;
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
    ensure(args: TArgsOrKeyed<TArgs>, options?: TResourceEnsureOptions): Promise<TData>;
    /** Resolve with the result of a fresh query. Rejects on failure/abort. */
    fetch(args: TArgsOrKeyed<TArgs>, options?: TResourceFetchOptions): Promise<TData>;
    /** Fire-and-forget cache warm-up; creates the entry synchronously, never rejects. */
    prefetch(args: TArgsOrKeyed<TArgs>, options?: TResourcePrefetchOptions): Promise<void>;
}

// ==================== Fetch Options ====================

/** Options for the imperative {@link IResource.ensure}. */
export interface TResourceEnsureOptions {
    /**
     * Detaches the caller from the awaited query when aborted: the returned
     * promise rejects with the signal's reason. The underlying query is left
     * running for any other consumers and is torn down by retention GC only once
     * no consumer remains — aborting one caller never cancels a shared in-flight
     * request. {@link IResource.prefetch} is intentionally not abort-aware.
     */
    signal?: AbortSignal;
}

/** Options for the imperative {@link IResource.fetch}. */
export interface TResourceFetchOptions extends TResourceEnsureOptions {
    /**
     * What `fetch` does with a query run already in flight for these args — a
     * promise not yet settled, or a stream whose subscription is open
     * (`success` included):
     *
     * - `"cancel"` — the run is aborted and `fetch` resolves with a fresh
     *   run's result;
     * - `"trail"` — the run is left to settle, then a fresh run goes out and
     *   `fetch` resolves with its result (on an open stream: once the stream
     *   ends);
     * - `"join"` — `fetch` resolves with the run in flight's result (an open
     *   stream at `success` already has it).
     *
     * With nothing in flight it makes no difference: the entry is re-queried
     * (or retried after an error) and the fresh result awaited. On a
     * projection resource an id-set whose load has landed has nothing in
     * flight: `fetch` reloads its ids under this policy, applied to the
     * wrapped resource's requests. Deliberately not the resource's
     * `invalidateInFlight`: a `fetch` asks for a fresh result.
     *
     * @default "cancel"
     */
    inFlight?: TInFlightPolicy;
}

/**
 * Options for {@link IResource.prefetch}: a warm-up that reuses cached data,
 * or — with `force: true` — one that warms with fresh data. Discriminated by
 * `force`, so `inFlight` only type-checks together with `force: true` (it
 * would be ignored otherwise). A `force` held in a `boolean` variable is
 * accepted without `inFlight`.
 */
export type TResourcePrefetchOptions = TResourcePrefetchCachedOptions | TResourcePrefetchForceOptions;

/** {@link TResourcePrefetchOptions} of a warm-up that reuses cached data. */
export interface TResourcePrefetchCachedOptions {
    /** Reuse cached data as-is (the default). */
    force?: false;
    /** Only valid with `force: true`: without it there is no in-flight decision to make. */
    inFlight?: never;
}

/** {@link TResourcePrefetchOptions} of a warm-up with fresh data. */
export interface TResourcePrefetchForceOptions {
    /**
     * Warm the cache with *fresh* data: an existing entry is invalidated (or
     * retried after an error) instead of being reused as-is — the
     * fire-and-forget counterpart of {@link IResource.fetch}.
     */
    force: true;
    /**
     * What happens to a query run already in flight — see
     * {@link TResourceFetchOptions.inFlight}.
     *
     * @default "cancel"
     */
    inFlight?: TInFlightPolicy;
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

// The entry state (returned by {@link IResource.getState}) is the clutch state
// of a single cache entry: the same fields and flags, `dataSource` narrowed to
// `none | current` (one entry has neither previous nor placeholder data) and no
// methods. Its matrix rows are 1, 2, 5, 6, 7, 9, 10 and 12.

/** Row 1 — no cache entry exists for the given arguments. */
export interface TResourceEntryIdleState extends TDataSlotNone {
    status: "idle";
    args: null;
    hasError: false;
    error: null;
    isPending: false;
    isInitialLoading: false;
    isSwitching: false;
    isInvalidating: false;
}

/** Rows 2 / 10 — initial load in flight; with `hasError`, a retry of a failed one. */
export type TResourceEntryPendingNoneState<TArgs, TError = unknown> = {
    status: "pending";
    args: TArgs;
    isPending: true;
    isInitialLoading: true;
    isSwitching: false;
    isInvalidating: false;
} & TDataSlotNone &
    TErrorSlot<TError>;

/** Rows 6 / 12 — the entry is being re-queried behind its own data. */
export type TResourceEntryPendingCurrentState<TArgs, TData, TError = unknown> = {
    status: "pending";
    args: TArgs;
    isPending: true;
    isInitialLoading: false;
    isSwitching: false;
    isInvalidating: true;
} & TDataSlotCurrent<TArgs, TData> &
    TErrorSlot<TError>;

/** A query is in flight for this entry (rows 2, 6, 10, 12). */
export type TResourceEntryPendingState<TArgs, TData, TError = unknown> =
    TResourceEntryPendingNoneState<TArgs, TError> | TResourceEntryPendingCurrentState<TArgs, TData, TError>;

/** Row 5 — the query succeeded: fresh data, no error. */
export interface TResourceEntrySuccessState<TArgs, TData> extends TDataSlotCurrent<TArgs, TData> {
    status: "success";
    args: TArgs;
    hasError: false;
    error: null;
    isPending: false;
    isInitialLoading: false;
    isSwitching: false;
    isInvalidating: false;
}

interface TEntryErrorBase<TArgs, TError> {
    status: "error";
    args: TArgs;
    hasError: true;
    error: TError;
    isPending: false;
    isInitialLoading: false;
    isSwitching: false;
    isInvalidating: false;
}

/**
 * Rows 7 / 9 — the query failed. A failed invalidation keeps the entry's data
 * (`dataSource: "current"`); a failed first load has none.
 */
export type TResourceEntryErrorState<TArgs, TData, TError = unknown> = TEntryErrorBase<TArgs, TError> &
    (TDataSlotNone | TDataSlotCurrent<TArgs, TData>);

export type TResourceEntryState<TArgs, TData, TError = unknown> =
    | TResourceEntryIdleState
    | TResourceEntryPendingState<TArgs, TData, TError>
    | TResourceEntrySuccessState<TArgs, TData>
    | TResourceEntryErrorState<TArgs, TData, TError>;

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
    /**
     * Re-query the current args and clear the failure. With a run in flight,
     * `opts.inFlight` (else the resource's `invalidateInFlight`) decides whether
     * it is cancelled, trailed or joined.
     */
    invalidate(opts?: TInvalidateOptions): void;
    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh(): void;
    /**
     * Promise resolving once the clutch has something to render: any data
     * became available (`hasData` — fresh, previous or placeholder) or the
     * query failed with nothing to show (`status === "error"`). Never rejects.
     * Used by the Suspense hook to wake React after a suspended render.
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
    /**
     * How long an entry of this resource is kept after its last subscriber
     * leaves; falls back to the api-level `resourceRetentionTime`. The function
     * form decides per entry — see {@link TRetentionTime} for when it runs and
     * how its result is normalized. `state` is the row {@link IResource.getState}
     * reports for those arguments; the entry exists whenever the function runs,
     * so the `idle` row is excluded.
     */
    retentionTime?: TRetentionTime<TArgs, Exclude<TResourceEntryState<TArgs, TData>, TResourceEntryIdleState>>;
    serializeArgs?: (args: TArgs) => string;
    /** See {@link TLifecycleHookOption} for the array form. */
    onCacheEntryAdded?: TLifecycleHookOption<(args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void>;
    /** See {@link TLifecycleHookOption} for the array form. */
    onQueryStarted?: TLifecycleHookOption<
        (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>
    >;
    /**
     * Data to show while the arguments have nothing cached yet — rendered as
     * `dataSource: "placeholder"` and never written to the cache.
     *
     * Called once per argument key: a retry or an invalidation of the same
     * arguments reuses the first result, and a cache hit never calls it at all.
     * `previous` is the SWR fallback at that moment (the data of the arguments
     * the clutch observed before, with those arguments), snapshotted together
     * with the result — a background update of the previous entry does not
     * recompute it.
     *
     * Return `{ data }` to show `data`, or `null` for the behaviour without the
     * option: the previous arguments' data if there is any, otherwise nothing.
     * A placeholder outranks previous data; returning `null` when `previous` is
     * present is how you keep the opposite order.
     */
    placeholderData?: (args: TArgs, previous: { data: TData; args: TArgs } | null) => { data: TData } | null;
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
    /**
     * What `invalidate()` does to a query run in flight — from a call, a
     * command link or a consistency violation — unless the call says otherwise.
     * See {@link TInFlightPolicy}.
     *
     * @default "cancel"
     */
    invalidateInFlight?: TInFlightPolicy;
}

// ==================== Resource Config (internal) ====================

export interface IResourceConfig<TArgs, TData> {
    queryFn: (args: TArgs, abortSignal: AbortSignal) => TQueryFnResult<TData>;
    key?: string;
    /** See {@link TResourceOptions.retentionTime}. The Api always supplies one. */
    retentionTime: TRetentionTime<TArgs, Exclude<TResourceEntryState<TArgs, TData>, TResourceEntryIdleState>>;
    serializeArgs: (args: TArgs) => string;
    /**
     * Normalizes raw query errors before they enter the entry's state. The Api always
     * supplies one (identity when the consumer configured no `mapError`);
     * defaults to identity if constructed directly. See {@link TMapError}.
     */
    mapError?: TMapError;
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
    /** See {@link TResourceOptions.placeholderData}. */
    placeholderData?: (args: TArgs, previous: { data: TData; args: TArgs } | null) => { data: TData } | null;
    /** Pre-populated entries from snapshot hydration (key → snapshot meta). */
    snapshot?: TResourceSnapshot;
    /** When `false`, the resource is skipped by `Snapshotter.getSnapshot`. Defaults to `true`. */
    snapshotable?: boolean;
    /** Cross-tab sync hook: called before queryFn to check if another tab has cached data. */
    beforeQuery?: (resourceKey: string, entryKey: string) => Promise<{ data: TData } | null>;
    /** See {@link TResourceOptions.allowStreamPatches}. Defaults to `false`. */
    allowStreamPatches?: boolean;
    /** See {@link TResourceOptions.invalidateInFlight}. Defaults to `"cancel"`. */
    invalidateInFlight?: TInFlightPolicy;
}

// ==================== Deprecated Aliases ====================

/** @deprecated Renamed to {@link IResourceClutch}. Will be removed in 0.14.0. */
export type IResourceAgent<TArgs, TData, TError = unknown> = IResourceClutch<TArgs, TData, TError>;

/** @deprecated Renamed to {@link TBoundResource}. Will be removed in 0.14.0. */
export type TPackedResource<TArgs, TData, TError = unknown> = TBoundResource<TArgs, TData, TError>;
