import { firstValueFrom } from "rxjs";

import type {
    Args,
    ArgsOrVoid,
    IResource,
    IResourceAgent,
    IResourceConfig,
    IResourceLiteState,
    Keyed,
    TCacheEntryAddedContext,
    TMapError,
    TPackedResource,
    TQueryStartedContext,
    TResourceFetchOptions,
    TResourcePrefetchOptions,
} from "@/query/types";
import { Signal, unstable_KeyedSignal, type ReadonlySignal } from "@/signals";

import { abortReason } from "../../lib/abortReason";
import { toKeyed as toKeyedUtil } from "../../lib/toKeyed";
import { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { Machine } from "../machine/Machine";

import { ResourceAgent } from "./ResourceAgent";

// ==================== Resource ====================

/**
 * Data-fetching abstraction with caching and SWR.
 *
 * Each unique set of serialized arguments maps to a single {@link QueryCacheEntry}.
 * Entries are retained for `retentionTime` ms after the last subscriber unsubscribes.
 *
 * @template TArgs - Query argument type.
 * @template TData - Query return data type.
 */
export class Resource<TArgs, TData, TError = unknown> implements IResource<TArgs, TData, TError> {
    private readonly _cache = unstable_KeyedSignal.state<QueryCacheEntry<TArgs, TData>>();

    private readonly _queryFn: (args: TArgs, abortSignal: AbortSignal) => Promise<TData>;
    readonly _key: string | undefined;
    private readonly _retentionTime: number | false;
    private readonly _serializeArgs: (args: TArgs) => string;
    private readonly _mapError: TMapError;
    private readonly _onCacheEntryAdded;
    private readonly _onQueryStarted;
    private readonly _beforeQuery?;

    constructor(config: IResourceConfig<TArgs, TData>) {
        this._queryFn = config.queryFn;
        this._key = config.key;
        this._retentionTime = config.retentionTime;
        this._serializeArgs = config.serializeArgs;
        this._mapError = config.mapError ?? ((error) => error);
        this._onCacheEntryAdded = config.onCacheEntryAdded;
        this._onQueryStarted = config.onQueryStarted;
        this._beforeQuery = config.beforeQuery;

        if (config.snapshot) {
            for (const [key, snap] of Object.entries(config.snapshot.entries)) {
                this._hydrateEntry(key, {
                    args: snap.args as TArgs,
                    data: snap.data as TData,
                    updatedAt: snap.updatedAt,
                    isStale: snap.isStale ?? false,
                });
            }
        }
    }

    // ==================== Public API ====================

    /**
     * Execute a query with the given arguments.
     *
     * @deprecated Use {@link prefetch}: `trigger(args)` ≈ `prefetch(args)`,
     * `trigger(args, true)` ≈ `prefetch(args, { force: true })`. Not an exact
     * match on an `error`-state entry: `prefetch` retries it in both modes,
     * while `trigger` left it untouched (its force path went through
     * `refresh()`, which is a no-op from `error`). And unlike `trigger`,
     * every `prefetch` call — cache hits included — holds a keepalive
     * subscription until it settles and then restarts the entry's retention
     * countdown. Will be removed in a future release.
     * @param args - Query arguments.
     * @param doForce - When `true`, forces a refresh even if data is cached.
     */
    trigger(args: Args<TArgs>, doForce = false): void {
        this._getOrCreate(args, doForce);
    }

    /**
     * Mark the entry as stale and trigger a background SWR refresh.
     *
     * @param args - Query arguments identifying the cache entry.
     */
    refresh(args: Args<TArgs>): void {
        const keyed = this.toKeyed(args);

        const entry = this._cache.get(keyed.key);

        if (entry) {
            entry.refresh();
        }
    }

    /**
     * Synchronously return the cache entry for the given arguments.
     *
     * @param args - Query arguments (or `void` when `TArgs` is `void`).
     * @param doInitiate - When `true`, creates and starts the entry if absent,
     *   so the result is never `null`.
     * @returns The cache entry, or `null` if not found and `doInitiate` is `false`.
     */
    getEntry(args: ArgsOrVoid<TArgs>, doInitiate: true): QueryCacheEntry<TArgs, TData>;
    getEntry(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): QueryCacheEntry<TArgs, TData> | null;
    getEntry(args: Keyed<TArgs>, doInitiate: true): QueryCacheEntry<TArgs, TData>;
    getEntry(args: ArgsOrVoid<TArgs> | Keyed<TArgs>, doInitiate = false): QueryCacheEntry<TArgs, TData> | null {
        const keyed = this.toKeyed(args as Args<TArgs>);

        const entry = this._cache.get(keyed.key);

        if (entry) {
            return entry;
        }

        if (doInitiate) {
            return this._getOrCreate(keyed);
        }
        return null;
    }

    /**
     * Synchronously return the cache entry for an already-serialized key.
     *
     * Unlike {@link getEntry}, the key is used for a direct cache lookup without
     * serialization. Needed where only the serialized key is available — e.g.
     * cross-tab sync, where raw args never leave the requesting tab.
     *
     * @param key - Serialized cache key (as produced by {@link serialize}).
     * @returns The cache entry, or `null` if not found.
     */
    getEntryByKey(key: string): QueryCacheEntry<TArgs, TData> | null {
        return this._cache.get(key) ?? null;
    }

    /**
     * Reactive variant of {@link getEntry} — establishes a signal dependency
     * so that `Signal.compute` / `Signal.effect` callers re-evaluate when the
     * cache map changes (entry added or removed).
     *
     * @param args - Query arguments (or `void` when `TArgs` is `void`).
     * @param doInitiate - When `false` (default) the signal is a pure observer:
     *   reading it never mutates the cache and yields `null` while the entry is
     *   absent. When `true`, reading the signal creates and starts the entry if it
     *   is missing, so the signal always yields a non-null entry — re-creating it
     *   on read even after it was removed. Creation is lazy: it happens on first
     *   read (the underlying computed is lazy), not at call time, and that read
     *   therefore has a side effect — it starts the query and fires the
     *   `onCacheEntryAdded` / `onQueryStarted` hooks. Avoid `doInitiate: true`
     *   where a read must stay pure (e.g. inside React render).
     * @returns The cache entry, or `null` if not found and `doInitiate` is `false`.
     */
    getEntry$(args: ArgsOrVoid<TArgs>, doInitiate: true): ReadonlySignal<QueryCacheEntry<TArgs, TData>>;
    getEntry$(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
    getEntry$(args: Keyed<TArgs>, doInitiate?: boolean): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
    getEntry$(
        args: ArgsOrVoid<TArgs> | Keyed<TArgs>,
        doInitiate = false,
    ): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null> {
        const keyed = this.toKeyed(args as Args<TArgs>);

        return Signal.compute(
            () => {
                const entry = this._cache.get$(keyed.key);

                if (entry) {
                    return entry;
                }

                if (doInitiate) {
                    return this._getOrCreate(keyed);
                }

                return null;
            },
            { isDisabled: true },
        );
    }

    /**
     * Create a reactive {@link ResourceAgent} that observes this resource
     * and provides SWR-aware state transitions.
     */
    createAgent(): IResourceAgent<TArgs, TData, TError> {
        return new ResourceAgent<TArgs, TData, TError>(this);
    }

    /**
     * Serialize arguments into a cache key string.
     *
     * @param args - Query arguments.
     * @returns The serialized key used for cache lookup.
     */
    serialize(args: Args<TArgs>): string {
        return this.toKeyed(args).key;
    }

    /**
     * Wrap arguments into a `{ value, key }` pair, avoiding repeated serialization.
     *
     * @param args - Query arguments.
     * @returns A {@link Keyed} wrapper containing the original args and their cache key.
     */
    toKeyed(args: Args<TArgs>): Keyed<TArgs> {
        return toKeyedUtil(args, this._serializeArgs);
    }

    /** Iterate over all cache entries. */
    getEntries(): IterableIterator<QueryCacheEntry<TArgs, TData>> {
        return this._cache.values();
    }

    /**
     * Bundle this resource with arguments into an inert {@link TPackedResource}
     * descriptor. Nothing is executed — the consumer hands the descriptor back to
     * the library, which can later read `resource`/`args` (e.g. `resource.prefetch(args)`).
     *
     * @param args - Query arguments (or a {@link Keyed} wrapper).
     * @returns A `{ kind: "resource", resource, args }` descriptor.
     */
    pack(args: Args<TArgs>): TPackedResource<TArgs, TData, TError> {
        return { kind: "resource", resource: this, args };
    }

    /**
     * Ensure data is available for the given arguments and resolve with it.
     *
     * If an entry already holds data (including stale data being refreshed) it
     * resolves immediately without a network round-trip. A cold entry is created
     * and its first load awaited; a failed entry is retried. Rejects if the
     * awaited query fails, the entry is removed, or `options.signal` aborts.
     *
     * Designed for router loaders (`ensureQueryData`-style): the consumer awaits
     * data, then a component mounts and subscribes within the retention window.
     *
     * @param args - Query arguments (or a {@link Keyed} wrapper).
     * @param options - See {@link TResourceFetchOptions}.
     */
    ensure(args: Args<TArgs>, options?: TResourceFetchOptions): Promise<TData> {
        if (options?.signal?.aborted) {
            return Promise.reject(abortReason(options.signal));
        }

        // A user-supplied serializeArgs may throw synchronously; convert it into
        // a rejection so the promise contract holds (prefetch then swallows it,
        // keeping its never-rejects guarantee).
        let keyed: Keyed<TArgs>;
        try {
            keyed = this.toKeyed(args);
        } catch (error) {
            return Promise.reject(error);
        }
        const existing = this._cache.get(keyed.key);

        if (!existing) {
            return this._getOrCreate(keyed).whenLoaded(options?.signal);
        }

        // A failed entry has no data to hand back — kick off a retry before awaiting.
        if (existing.machine$.peek().state.status === "error") {
            existing.retry();
        }

        return existing.whenLoaded(options?.signal);
    }

    /**
     * Fetch fresh data for the given arguments and resolve with it.
     *
     * Unlike {@link ensure}, this always reflects the result of a fresh query: a
     * cached entry is refreshed (or retried) and the new result awaited; an
     * in-flight query is awaited rather than duplicated. Rejects if the query
     * fails, the entry is removed, or `options.signal` aborts. With cross-tab
     * sync enabled, a cold entry may be filled from another tab's cache
     * (`beforeQuery`) instead of this tab's own network round-trip.
     *
     * @param args - Query arguments (or a {@link Keyed} wrapper).
     * @param options - See {@link TResourceFetchOptions}.
     */
    fetch(args: Args<TArgs>, options?: TResourceFetchOptions): Promise<TData> {
        if (options?.signal?.aborted) {
            return Promise.reject(abortReason(options.signal));
        }

        // See ensure: a throwing serializeArgs must reject, not throw.
        let keyed: Keyed<TArgs>;
        try {
            keyed = this.toKeyed(args);
        } catch (error) {
            return Promise.reject(error);
        }
        const existing = this._cache.get(keyed.key);

        if (!existing) {
            return this._getOrCreate(keyed).whenFetched(options?.signal);
        }

        const status = existing.machine$.peek().state.status;
        if (status === "success" || status === "refresh-error") {
            existing.refresh();
        } else if (status === "error") {
            existing.retry();
        }
        // pending / refreshing → a query is already in flight; await its result.

        return existing.whenFetched(options?.signal);
    }

    /**
     * Warm the cache for the given arguments without surfacing the result.
     *
     * A fire-and-forget {@link ensure}: reuses cached data when present, creates
     * the entry synchronously, never rejects, and — unlike {@link ensure} — is
     * intentionally not abort-aware so speculative warm-ups survive navigation.
     * With `options.force` it warms with *fresh* data instead (a fire-and-forget
     * {@link fetch}): an existing entry is refreshed, or retried after an error.
     *
     * @param args - Query arguments (or a {@link Keyed} wrapper).
     * @param options - See {@link TResourcePrefetchOptions}.
     */
    prefetch(args: Args<TArgs>, options?: TResourcePrefetchOptions): Promise<void> {
        const settled = options?.force ? this.fetch(args) : this.ensure(args);
        return settled.then(
            () => undefined,
            () => undefined,
        );
    }

    /**
     * Get a simplified state object for the given arguments.
     */
    getState(args: ArgsOrVoid<TArgs>): IResourceLiteState<TArgs, TData, TError> {
        const entry = this.getEntry(args, false);

        if (!entry) {
            return {
                status: "idle",
                data: null,
                error: null,
                args: null,
                isLoading: false,
                isInitialLoading: false,
                isRefreshing: false,
                isRefreshError: false,
                isSuccess: false,
                isError: false,
            };
        }

        const machine = entry.machine$.peek();

        if (machine.status === "pending") {
            return {
                status: "pending",
                data: null,
                error: null,
                args: entry.keyedArgs.value,
                isLoading: true,
                isInitialLoading: true,
                isRefreshing: false,
                isRefreshError: false,
                isSuccess: false,
                isError: false,
            };
        }

        if (machine.status === "success") {
            return {
                status: "success",
                data: machine.state.data,
                error: null,
                args: entry.keyedArgs.value,
                isLoading: false,
                isInitialLoading: false,
                isRefreshing: false,
                isRefreshError: false,
                isSuccess: true,
                isError: false,
            };
        }

        if (machine.status === "refreshing") {
            return {
                status: "refreshing",
                data: machine.state.data,
                error: null,
                args: entry.keyedArgs.value,
                isLoading: true,
                isInitialLoading: false,
                isRefreshing: true,
                isRefreshError: false,
                isSuccess: false,
                isError: false,
            };
        }

        if (machine.status === "refresh-error") {
            return {
                status: "refresh-error",
                data: machine.state.data,
                // Sound per the mapError contract: any error the machine holds was
                // normalized to TError at the queryFn boundary before entering it.
                error: machine.state.error as TError,
                args: entry.keyedArgs.value,
                isLoading: false,
                isInitialLoading: false,
                isRefreshing: false,
                isRefreshError: true,
                isSuccess: false,
                isError: true,
            };
        }

        if (machine.status === "error") {
            return {
                status: "error",
                data: null,
                // Sound per the mapError contract (see refresh-error branch above).
                error: machine.state.error as TError,
                args: entry.keyedArgs.value,
                isLoading: false,
                isInitialLoading: false,
                isRefreshing: false,
                isRefreshError: false,
                isSuccess: false,
                isError: true,
            };
        }

        throw new Error(`Unknown machine status: ${(machine as any).status}`);
    }

    /** Clear all cache entries. */
    reset(): void {
        for (const entry of this._cache.values()) {
            entry.complete();
        }
        this._cache.clear();
    }

    // ==================== Private ====================

    /**
     * Run the user's queryFn, converting a synchronous throw (possible with a
     * non-async queryFn) into a rejected promise. Without this the throw would
     * escape the QueryCacheEntry constructor on the initial run — no entry
     * created, prefetch()/ensure()/fetch() throwing synchronously — and escape
     * `_execute` on refresh()/retry() after the machine had already moved to
     * refreshing/pending, stranding it there. As a rejection it flows through
     * the machine (→ error / refresh-error) like any other query failure.
     */
    private _callQueryFn(args: TArgs, signal: AbortSignal): Promise<TData> {
        try {
            return this._queryFn(args, signal);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    /** Get an existing cache entry (refreshing it when `doForce`) or create a new one. */
    private _getOrCreate(args: Args<TArgs>, doForce = false): QueryCacheEntry<TArgs, TData> {
        const keyed = this.toKeyed(args);
        const existing = this._cache.get(keyed.key);

        if (existing) {
            if (doForce) existing.refresh();
            return existing;
        }

        return this._createEntry(keyed);
    }

    private _createEntry(keyed: Keyed<TArgs>, initialMachine?: Machine<TArgs, TData>): QueryCacheEntry<TArgs, TData> {
        // ── beforeQuery sync intercept ──
        // If beforeQuery is set AND there's no snapshot (initialMachine), intercept
        // to ask other tabs for data before executing queryFn.
        if (!initialMachine && this._beforeQuery && this._key) {
            return this._createEntryWithBeforeQuery(keyed);
        }

        return this._createEntryDirect(keyed, initialMachine);
    }

    /** Standard entry creation: queryFn auto-executes in constructor. */
    private _createEntryDirect(
        keyed: Keyed<TArgs>,
        initialMachine?: Machine<TArgs, TData>,
    ): QueryCacheEntry<TArgs, TData> {
        // Capture initial query promise for onQueryStarted lifecycle hook.
        // During the QueryCacheEntry constructor, _execute() fires synchronously,
        // calling wrappedQueryFn before `entry` is assigned. We save the promise
        // in the `else` branch and fire onQueryStarted after construction.
        // eslint-disable-next-line prefer-const -- assigned after constructor; closure reads it
        let entry!: QueryCacheEntry<TArgs, TData>;
        let initialQueryPromise: Promise<TData> | null = null;

        const wrappedQueryFn = (keyedArgs: Keyed<TArgs>, signal: AbortSignal): Promise<TData> => {
            const promise = this._callQueryFn(keyedArgs.value, signal);

            if (entry) {
                // Subsequent calls (refresh / retry) — entry is already assigned
                this._fireOnQueryStarted(entry, keyedArgs.value, promise);
            } else {
                // Initial call during constructor — defer
                initialQueryPromise = promise;
            }

            return promise;
        };

        entry = new QueryCacheEntry<TArgs, TData>({
            queryFn: wrappedQueryFn,
            retentionTime: this._retentionTime,
            keyedArgs: keyed,
            resourceKey: this._key,
            mapError: this._mapError,
            errorSource: "query",
            initialMachine,
            beforeDevtoolsPush: undefined,
        });

        // Register in cache
        this._cache.set(keyed.key, entry);

        // Cleanup: remove entry from cache when it completes (retention expired)
        entry.completed$.subscribe(() => {
            this._cache.delete(keyed.key);
        });

        // Fire onCacheEntryAdded lifecycle hook
        this._fireOnCacheEntryAdded(entry, keyed);

        // Fire onQueryStarted for the initial query (deferred from constructor)
        if (initialQueryPromise) {
            this._fireOnQueryStarted(entry, keyed.value, initialQueryPromise);
        }

        return entry;
    }

    /** Entry creation with beforeQuery intercept: starts in pending, asks other tabs first. */
    private _createEntryWithBeforeQuery(keyed: Keyed<TArgs>): QueryCacheEntry<TArgs, TData> {
        const wrappedQueryFn = (keyedArgs: Keyed<TArgs>, signal: AbortSignal): Promise<TData> => {
            const promise = this._callQueryFn(keyedArgs.value, signal);
            this._fireOnQueryStarted(entry, keyedArgs.value, promise);
            return promise;
        };

        // Create entry with an explicit pending Machine to PREVENT auto-execute
        const entry = new QueryCacheEntry<TArgs, TData>({
            queryFn: wrappedQueryFn,
            retentionTime: this._retentionTime,
            keyedArgs: keyed,
            resourceKey: this._key,
            mapError: this._mapError,
            errorSource: "query",
            initialMachine: Machine.pending<TArgs, TData>(keyed.value),
            beforeDevtoolsPush: undefined,
        });

        // Register in cache immediately (UI sees pending state)
        this._cache.set(keyed.key, entry);

        entry.completed$.subscribe(() => {
            this._cache.delete(keyed.key);
        });

        this._fireOnCacheEntryAdded(entry, keyed);

        // Ask other tabs for data, fall back to queryFn. The rejection handler is
        // passed as the second `then` argument so it only covers beforeQuery
        // itself — a throw in the success path must not turn into a fallback run.
        this._beforeQuery!(this._key!, keyed.key).then(
            (result) => {
                // The entry may have been completed (reset / retention GC) while
                // the cross-tab request was in flight — its state is disposed and
                // must not be revived or re-executed.
                if (entry.isCompleted) return;

                if (result) {
                    const machine = entry.machine$.peek();
                    if (machine.status === "pending") {
                        entry.set(machine.success(result.data), "sync");
                    }
                } else {
                    entry._execute();
                }
            },
            () => {
                if (entry.isCompleted) return;
                entry._execute();
            },
        );

        return entry;
    }

    private _hydrateEntry(key: string, meta: { args: TArgs; data: TData; updatedAt: number; isStale: boolean }): void {
        const machine = Machine.fromSnapshot<TArgs, TData>(meta, meta.isStale);

        const keyed = toKeyedUtil<TArgs>(meta.args as Args<TArgs>, this._serializeArgs);

        // Verify key matches
        if (keyed.key !== key) {
            console.warn(
                `[rx-toolkit] Snapshot hydration skipped: expected key "${key}" but serialized args produced key "${keyed.key}".`,
            );
            return;
        }

        this._createEntry(keyed, machine);
    }

    private _fireOnCacheEntryAdded(entry: QueryCacheEntry<TArgs, TData>, keyed: Keyed<TArgs>): void {
        if (!this._onCacheEntryAdded) return;

        // $cacheDataLoaded: resolves with data on first success, rejects if entry removed first
        const $cacheDataLoaded = entry.whenFirstLoaded();

        // $cacheEntryRemoved: resolves when entry is removed from cache
        const $cacheEntryRemoved = firstValueFrom(entry.completed$).catch(() => undefined);

        const ctx: TCacheEntryAddedContext<TArgs, TData> = {
            entry,
            $cacheDataLoaded,
            $cacheEntryRemoved,
        };

        try {
            const result = this._onCacheEntryAdded(keyed.value, ctx);
            // Hook may be async — suppress unhandled rejection
            void Promise.resolve(result).catch(() => {});
        } catch {
            // Lifecycle errors are suppressed (per docs)
        }
    }

    private _fireOnQueryStarted(entry: QueryCacheEntry<TArgs, TData>, args: TArgs, queryPromise: Promise<TData>): void {
        if (!this._onQueryStarted) return;

        const $queryFulfilled = queryPromise.then((data) => ({ data }));
        // Derived promise: rejects with the query error even though the base
        // promise is consumed by _execute. Suppress "nobody awaited" rejections
        // (the hook may not consume it); awaiting hooks still see the rejection.
        void $queryFulfilled.catch(() => {});

        const ctx: TQueryStartedContext<TArgs, TData> = {
            entry,
            $queryFulfilled,
        };

        try {
            const result = this._onQueryStarted(args, ctx);
            // Hook may be async — suppress unhandled rejection
            void Promise.resolve(result).catch(() => {});
        } catch {
            // Lifecycle errors are suppressed (per docs)
        }
    }
}
