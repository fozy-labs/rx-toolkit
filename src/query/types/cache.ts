import type { Observable, Subject } from "rxjs";

import type { Machine } from "@/query/core/machine";
import type { ReadonlySignal, TBeforeDevtoolsPushFn } from "@/signals/types";

import type { TMapError } from "./api";
import type { IPatchHandle, Keyed } from "./common";

// ==================== Cache Interfaces ====================

export interface ICacheEntryOptions<TState> {
    retentionTime: number | false;
    devtoolsKey: string;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TState>;
}

export interface ICacheEntry<TState> {
    readonly completed$: Subject<void>;
    readonly state$: ReadonlySignal<TState>;
    peek(): TState;
    set(state: TState, actionName?: string): void;
    complete(): void;
}

// ==================== QueryCacheEntry Options & Interface ====================

export interface IQueryCacheEntryOptions<TArgs, TData> {
    queryFn: (keyedArgs: Keyed<TArgs>, signal: AbortSignal) => Promise<TData> | Observable<TData>;
    retentionTime: number | false;
    keyedArgs: Keyed<TArgs>;
    resourceKey?: string;
    /**
     * Normalizes a raw query rejection into the api's error type at the single
     * point it enters the machine (`machine.fail`). Defaults to identity.
     */
    mapError?: TMapError;
    /** Provenance forwarded to {@link mapError}'s context. Defaults to `"query"`. */
    errorSource?: "query" | "command";
    initialMachine?: Machine<TArgs, TData>;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<Machine<TArgs, TData>>;
    /**
     * Invoked on every `createPatch` made while a query stream is open. Lets
     * the owning resource surface the emissions-rebase-over-patches interplay
     * (a one-time warning unless `allowStreamPatches` is set).
     */
    onStreamPatch?: () => void;
}

export interface IQueryCacheEntry<TArgs, TData> extends ICacheEntry<Machine<TArgs, TData>> {
    readonly keyedArgs: Keyed<TArgs>;
    // state$ is inherited from ICacheEntry<Machine<TArgs, TData>>
    readonly machine$: ReadonlySignal<Machine<TArgs, TData>>;
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
 * If the run is torn down before the milestone (refresh / retry / eviction),
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
