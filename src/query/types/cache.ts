import type { Observable, Subject } from "rxjs";

import type { ReadonlySignal, TBeforeDevtoolsPushFn } from "@/signals/types";

import type { TMapError } from "./api";
import type { IPatchHandle, TInFlightPolicy, TInvalidateOptions, TKeyed, TQueryEntryState } from "./common";

// ==================== Cache Interfaces ====================

export interface ICacheEntryOptions<TState> {
    /**
     * How long the entry survives its last subscriber. The function form is
     * evaluated on every `active → retention` transition — inside the last
     * subscriber's teardown — and is handed the entry's own state as it stands
     * then. Its result is normalized exactly like a static value (`false` /
     * `Infinity` / over the `setTimeout` limit keep the entry, a negative value
     * or `NaN` evicts it at once); a throw is caught, logged against
     * {@link devtoolsKey} and treated as an immediate eviction.
     */
    retentionTime: number | false | ((state: TState) => number | false);
    devtoolsKey: string;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TState>;
}

/**
 * Reactive container over a single state value. `TState` is both what the entry
 * stores and what it publishes: {@link IQueryCacheEntry} instantiates it with the
 * flat {@link TQueryEntryState} record.
 */
export interface ICacheEntry<TState> {
    readonly completed$: Subject<void>;
    /** The state as a signal: reading it in a `Computed` / `Effect` holds the entry, `peek()` does not. */
    readonly state$: ReadonlySignal<TState>;
    /** Whether nobody holds the entry — it is in retention, its `retentionTime` counting down. */
    readonly isMelting: boolean;
    /**
     * Keep the entry `active` without subscribing to its state. Returns the
     * release; idempotent, and a no-op on a completed entry.
     */
    hold(): () => void;
    peek(): TState;
    set(state: TState, actionName?: string): void;
    complete(): void;
}

// ==================== QueryCacheEntry Options & Interface ====================

export interface IQueryCacheEntryOptions<TArgs, TData> {
    queryFn: (keyedArgs: TKeyed<TArgs>, signal: AbortSignal) => Promise<TData> | Observable<TData>;
    /**
     * How long the entry survives its last subscriber. The function form is
     * evaluated on every `active → retention` transition and receives the
     * entry's own raw record as it stands then; the result is normalized like a
     * static value (see {@link ICacheEntryOptions.retentionTime}).
     */
    retentionTime: number | false | ((state: TQueryEntryState<TArgs, TData>) => number | false);
    keyedArgs: TKeyed<TArgs>;
    resourceKey?: string;
    /**
     * Normalizes a raw query rejection into the api's error type at the single
     * point it enters the entry's state. Defaults to identity.
     */
    mapError?: TMapError;
    /** Provenance forwarded to {@link mapError}'s context. Defaults to `"query"`. */
    errorSource?: "query" | "command";
    /**
     * State the entry starts in. Supplying it also suppresses the automatic
     * first run: a `pending` state is a load nobody has started yet (with
     * {@link isInvalidated} the first hold starts it), a data state is a
     * hydrated snapshot.
     */
    initialState?: TQueryEntryState<TArgs, TData>;
    /**
     * Start the entry marked for revalidation (a stale snapshot): it re-queries
     * on its first hold instead of at creation. Only meaningful together with
     * {@link initialState}: without it the automatic first run starts at
     * creation and clears the mark. Defaults to `false`.
     */
    isInvalidated?: boolean;
    /**
     * What `invalidate()` does to a run in flight when the call does not say.
     * See {@link TInFlightPolicy}. Defaults to `"cancel"`.
     */
    invalidateInFlight?: TInFlightPolicy;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TQueryEntryState<TArgs, TData>>;
    /**
     * Invoked on every `createPatch` made while a query stream is open. Lets
     * the owning resource surface the emissions-rebase-over-patches interplay
     * (a one-time warning unless `allowStreamPatches` is set).
     */
    onStreamPatch?: () => void;
}

export interface IQueryCacheEntry<TArgs, TData> extends ICacheEntry<TQueryEntryState<TArgs, TData>> {
    readonly keyedArgs: TKeyed<TArgs>;
    // state$ / peek() / set() are inherited from ICacheEntry<TQueryEntryState<TArgs, TData>>
    /**
     * Whether the entry owes a revalidation: it was invalidated while melting,
     * or while a run it was told to trail is in flight, or a run left flight
     * without landing the load the entry waits for. The owed run starts as
     * soon as the entry is held with nothing in flight — on the next hold, or
     * when the trailed run settles.
     */
    readonly isInvalidated: boolean;
    /**
     * Re-check what the entry shows: an active entry re-queries at once, a
     * melting one is marked and re-queries on its first hold. With a run in
     * flight, `opts.inFlight` (else the entry's `invalidateInFlight`) decides
     * whether that run is cancelled, trailed or joined — see
     * {@link TInFlightPolicy}.
     * Never throws.
     */
    invalidate(opts?: TInvalidateOptions): void;
    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh(): void;
    retry(): void;
    createPatch(patchFn: (data: TData) => void): IPatchHandle | null;
    /** @experimental Low-level primitive backing the imperative fetch API; may change before stabilization. */
    whenLoaded(signal?: AbortSignal): Promise<TData>;
    /** @experimental Low-level primitive backing the imperative fetch API; may change before stabilization. */
    whenFetched(signal?: AbortSignal): Promise<TData>;
}

// ==================== Lifecycle Contexts ====================

export interface TCacheEntryAddedContext<TArgs, TData> {
    entry: IQueryCacheEntry<TArgs, TData>;
    $cacheDataLoaded: Promise<TData>;
    $cacheEntryRemoved: Promise<void>;
}

/**
 * Fine-grained stream milestones of a single query run, available alongside
 * `$queryFulfilled` in the `onQueryStarted` context.
 *
 * For a promise-returning queryFn both promises settle together with the run's
 * result. For a stream-returning queryFn, `firstReceived` settles with the
 * first emission (≙ `$queryFulfilled`) and `allReceived` with the last
 * emission once the stream completes; both reject with the raw producer error.
 * If the run is torn down before the milestone (invalidate / retry / eviction),
 * the promise rejects with the teardown reason.
 */
export interface TQueryStreamContext<TData> {
    firstReceived: Promise<TData>;
    allReceived: Promise<TData>;
}

export interface TQueryStartedContext<TArgs, TData> {
    entry: IQueryCacheEntry<TArgs, TData>;
    $queryFulfilled: Promise<{ data: TData }>;
    $queryStream: TQueryStreamContext<TData>;
}
