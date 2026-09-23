import { firstValueFrom } from "rxjs";

import type {
    IQueryCacheEntryOptions,
    IResource,
    IResourceClutch,
    IResourceConfig,
    TArgsOrKeyed,
    TArgsOrVoid,
    TBoundResource,
    TCacheEntryAddedContext,
    TInFlightPolicy,
    TInvalidateOptions,
    TKeyed,
    TMapError,
    TQueryEntryState,
    TQueryFnResult,
    TQueryStartedContext,
    TResourceEnsureOptions,
    TResourceEntryState,
    TResourceFetchOptions,
    TResourcePrefetchOptions,
} from "@/query/types";
import { Signal, unstable_KeyedSignal, type ReadonlySignal } from "@/signals";

import { abortReason } from "../../lib/abortReason";
import { toKeyed as toKeyedUtil } from "../../lib/toKeyed";
import { QueryCacheEntry, type TQueryCacheEntryInternals } from "../cache/QueryCacheEntry";
import { snapshotEntryState } from "../machine/machine-helpers";

import { buildEntryState, IDLE_ENTRY_STATE } from "./entry-state";
import { instrumentQueryRun, type TQueryRunLifecycle } from "./instrumentQueryRun";
import { ResourceClutch } from "./ResourceClutch";

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

    private readonly _queryFn: (args: TArgs, abortSignal: AbortSignal) => TQueryFnResult<TData>;
    readonly _key: string | undefined;
    /** @internal Read by Snapshotter.getSnapshot to skip non-snapshotable resources. */
    readonly _snapshotable: boolean;
    private readonly _retentionTime: IResourceConfig<TArgs, TData>["retentionTime"];
    private readonly _serializeArgs: (args: TArgs) => string;
    private readonly _mapError: TMapError;
    private readonly _onCacheEntryAdded;
    private readonly _onQueryStarted;
    private readonly _beforeQuery?;
    private readonly _allowStreamPatches: boolean;
    private readonly _invalidateInFlight: TInFlightPolicy | undefined;
    /** Core-only wiring handed to every entry as is (see {@link TQueryCacheEntryInternals}). */
    private readonly _entryInternals: TQueryCacheEntryInternals;
    private _streamPatchWarned = false;
    /**
     * @internal Read by {@link ResourceClutch} to build its placeholder state.
     * See {@link TResourceOptions.placeholderData}.
     */
    readonly _placeholderData: IResourceConfig<TArgs, TData>["placeholderData"];

    /**
     * @param config - The resource's configuration.
     * @param entryInternals - Core-only wiring for the library's own resources
     *   (the projection resource's in-place revalidation), handed to every
     *   entry as is. Not part of the public {@link IResourceConfig}.
     */
    constructor(config: IResourceConfig<TArgs, TData>, entryInternals: TQueryCacheEntryInternals = {}) {
        this._queryFn = config.queryFn;
        this._key = config.key;
        this._snapshotable = config.snapshotable ?? true;
        this._retentionTime = config.retentionTime;
        this._serializeArgs = config.serializeArgs;
        this._mapError = config.mapError ?? ((error) => error);
        this._onCacheEntryAdded = config.onCacheEntryAdded;
        this._onQueryStarted = config.onQueryStarted;
        this._beforeQuery = config.beforeQuery;
        this._allowStreamPatches = config.allowStreamPatches ?? false;
        this._invalidateInFlight = config.invalidateInFlight;
        this._entryInternals = entryInternals;
        this._placeholderData = config.placeholderData;

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
     * Re-check what the entry shows and re-query it, clearing any failure it
     * holds: data is re-fetched behind itself (SWR), and a failed entry starts
     * over as a plain load. Lazy: an entry nobody holds is only marked and
     * re-queries on its next hold — a subscription, {@link ensure} or
     * {@link fetch}. With a query in flight, `opts.inFlight` — else the
     * resource's `invalidateInFlight` — decides whether that run is
     * cancelled, trailed or joined. No-op when no entry exists for these
     * arguments. Use
     * `getEntry(args)?.retry()` to re-run a failed query with the failure kept
     * on screen instead.
     *
     * @param args - Query arguments identifying the cache entry.
     * @param opts - See {@link TInvalidateOptions}.
     */
    invalidate(args: TArgsOrKeyed<TArgs>, opts?: TInvalidateOptions): void {
        const keyed = this.toKeyed(args);

        const entry = this._cache.get(keyed.key);

        if (entry) {
            entry.invalidate(opts);
        }
    }

    /**
     * @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0.
     * @param args - Query arguments identifying the cache entry.
     */
    refresh(args: TArgsOrKeyed<TArgs>): void {
        this.invalidate(args);
    }

    /**
     * Synchronously return the cache entry for the given arguments.
     *
     * @param args - Query arguments (or `void` when `TArgs` is `void`).
     * @param doInitiate - When `true`, creates and starts the entry if absent,
     *   so the result is never `null`.
     * @returns The cache entry, or `null` if not found and `doInitiate` is `false`.
     */
    getEntry(args: TArgsOrVoid<TArgs>, doInitiate: true): QueryCacheEntry<TArgs, TData>;
    getEntry(args: TArgsOrVoid<TArgs>, doInitiate?: boolean): QueryCacheEntry<TArgs, TData> | null;
    getEntry(args: TKeyed<TArgs>, doInitiate: true): QueryCacheEntry<TArgs, TData>;
    getEntry(args: TArgsOrVoid<TArgs> | TKeyed<TArgs>, doInitiate = false): QueryCacheEntry<TArgs, TData> | null {
        const keyed = this.toKeyed(args as TArgsOrKeyed<TArgs>);

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
    getEntry$(args: TArgsOrVoid<TArgs>, doInitiate: true): ReadonlySignal<QueryCacheEntry<TArgs, TData>>;
    getEntry$(args: TArgsOrVoid<TArgs>, doInitiate?: boolean): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
    getEntry$(args: TKeyed<TArgs>, doInitiate?: boolean): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
    getEntry$(
        args: TArgsOrVoid<TArgs> | TKeyed<TArgs>,
        doInitiate = false,
    ): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null> {
        const keyed = this.toKeyed(args as TArgsOrKeyed<TArgs>);

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
     * Create a reactive {@link ResourceClutch} that observes this resource
     * and provides SWR-aware state transitions.
     */
    createClutch(): IResourceClutch<TArgs, TData, TError> {
        return new ResourceClutch<TArgs, TData, TError>(this);
    }

    /** @deprecated Renamed to {@link createClutch}. Will be removed in 0.14.0. */
    createAgent(): IResourceClutch<TArgs, TData, TError> {
        return this.createClutch();
    }

    /**
     * Serialize arguments into a cache key string.
     *
     * @param args - Query arguments.
     * @returns The serialized key used for cache lookup.
     */
    serialize(args: TArgsOrKeyed<TArgs>): string {
        return this.toKeyed(args).key;
    }

    /**
     * Wrap arguments into a `{ value, key }` pair, avoiding repeated serialization.
     *
     * @param args - Query arguments.
     * @returns A {@link TKeyed} wrapper containing the original args and their cache key.
     */
    toKeyed(args: TArgsOrKeyed<TArgs>): TKeyed<TArgs> {
        return toKeyedUtil(args, this._serializeArgs);
    }

    /** Iterate over all cache entries. */
    getEntries(): IterableIterator<QueryCacheEntry<TArgs, TData>> {
        return this._cache.values();
    }

    /**
     * Bundle this resource with arguments into an inert {@link TBoundResource}
     * descriptor. Nothing is executed — the consumer hands the descriptor back to
     * the library, which can later read `resource`/`args` (e.g. `resource.prefetch(args)`).
     *
     * @param args - Query arguments (or a {@link TKeyed} wrapper).
     * @returns A `{ kind: "resource", resource, args }` descriptor.
     */
    bind(args: TArgsOrKeyed<TArgs>): TBoundResource<TArgs, TData, TError> {
        return { kind: "resource", resource: this, args };
    }

    /**
     * @deprecated Renamed to {@link bind}. Will be removed in 0.14.0.
     * @param args - Query arguments (or a {@link TKeyed} wrapper).
     * @returns A `{ kind: "resource", resource, args }` descriptor.
     */
    pack(args: TArgsOrKeyed<TArgs>): TBoundResource<TArgs, TData, TError> {
        return this.bind(args);
    }

    /**
     * Ensure data is available for the given arguments and resolve with it.
     *
     * If an entry already holds data (including stale data being invalidated) it
     * resolves immediately without a network round-trip. A cold entry is created
     * and its first load awaited; a failed entry is retried. Rejects if the
     * awaited query fails, the entry is removed, or `options.signal` aborts.
     *
     * Designed for router loaders (`ensureQueryData`-style): the consumer awaits
     * data, then a component mounts and subscribes within the retention window.
     *
     * @param args - Query arguments (or a {@link TKeyed} wrapper).
     * @param options - See {@link TResourceEnsureOptions}.
     */
    ensure(args: TArgsOrKeyed<TArgs>, options?: TResourceEnsureOptions): Promise<TData> {
        if (options?.signal?.aborted) {
            return Promise.reject(abortReason(options.signal));
        }

        // A user-supplied serializeArgs may throw synchronously; convert it into
        // a rejection so the promise contract holds (prefetch then swallows it,
        // keeping its never-rejects guarantee).
        let keyed: TKeyed<TArgs>;
        try {
            keyed = this.toKeyed(args);
        } catch (error) {
            return Promise.reject(error);
        }
        const existing = this._cache.get(keyed.key);

        if (!existing) {
            return this._getOrCreate(keyed).whenLoaded(options?.signal);
        }

        // A failed entry has no data to hand back — kick off a retry before
        // awaiting. A marked (lazily invalidated) entry resolves with the data
        // it has; the hold `whenLoaded` takes starts its revalidation behind.
        if (existing.peek().status === "error") {
            existing.retry();
        }

        return existing.whenLoaded(options?.signal);
    }

    /**
     * Fetch fresh data for the given arguments and resolve with it.
     *
     * Unlike {@link ensure}, this reflects the result of a fresh query: a
     * cached entry is invalidated (or retried) and the new result awaited. A
     * query run already in flight — a stream open at `success` included — is
     * handled by `options.inFlight`, `"cancel"` by default whatever the
     * resource's `invalidateInFlight`: aborted and replaced (`cancel`), left
     * to settle and followed by a fresh run (`trail`; an open stream is
     * waited out), or taken as the answer (`join`). Rejects if the query
     * fails, the entry is removed, or `options.signal` aborts — which only
     * detaches the caller. With cross-tab sync enabled, a cold entry may be
     * filled from another tab's cache (`beforeQuery`) instead of this tab's
     * own network round-trip; that round-trip is the entry's run in flight.
     *
     * @param args - Query arguments (or a {@link TKeyed} wrapper).
     * @param options - See {@link TResourceFetchOptions}.
     */
    fetch(args: TArgsOrKeyed<TArgs>, options?: TResourceFetchOptions): Promise<TData> {
        if (options?.signal?.aborted) {
            return Promise.reject(abortReason(options.signal));
        }

        // See ensure: a throwing serializeArgs must reject, not throw.
        let keyed: TKeyed<TArgs>;
        try {
            keyed = this.toKeyed(args);
        } catch (error) {
            return Promise.reject(error);
        }
        const existing = this._cache.get(keyed.key);

        if (!existing) {
            return this._getOrCreate(keyed).whenFetched(options?.signal);
        }

        // The in-flight policy is the call's own — `cancel` unless it says
        // otherwise — never the resource's `invalidateInFlight`: a fetch asks
        // for a fresh result. See `QueryCacheEntry._fetch`.
        return existing._fetch(options?.inFlight ?? "cancel", options?.signal);
    }

    /**
     * Warm the cache for the given arguments without surfacing the result.
     *
     * A fire-and-forget {@link ensure}: reuses cached data when present, creates
     * the entry synchronously, never rejects, and — unlike {@link ensure} — is
     * intentionally not abort-aware so speculative warm-ups survive navigation.
     * With `options.force` it warms with *fresh* data instead (a fire-and-forget
     * {@link fetch}, `options.inFlight` included): an existing entry is
     * invalidated, or retried after an error.
     *
     * @param args - Query arguments (or a {@link TKeyed} wrapper).
     * @param options - See {@link TResourcePrefetchOptions}.
     */
    prefetch(args: TArgsOrKeyed<TArgs>, options?: TResourcePrefetchOptions): Promise<void> {
        const settled = options?.force ? this.fetch(args, { inFlight: options.inFlight }) : this.ensure(args);
        return settled.then(
            () => undefined,
            () => undefined,
        );
    }

    /**
     * State of the cache entry for the given arguments.
     *
     * The clutch state of a single entry: the same fields and flags, with
     * `dataSource` narrowed to `none | current` (one entry has neither previous
     * nor placeholder data) and no methods. Its matrix rows are 1, 2, 5, 6, 7,
     * 9, 10 and 12 — see `docs/query/api/resource-clutch.md`.
     */
    getState(args: TArgsOrVoid<TArgs>): TResourceEntryState<TArgs, TData, TError> {
        const entry = this.getEntry(args, false);

        // Row 1 — no entry for these arguments.
        if (!entry) return IDLE_ENTRY_STATE;

        // A plain read of the stored record: no hold, so it neither counts as
        // a retention cycle nor starts the revalidation a marked entry owes.
        return buildEntryState<TArgs, TData, TError>(entry.keyedArgs.value, entry.peek());
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
     * `_execute` on invalidate()/retry() after the entry had already moved to
     * invalidating/pending, stranding it there. As a rejection it flows through
     * the entry's state (→ error / invalidate-error) like any other query failure.
     */
    private _callQueryFn(args: TArgs, signal: AbortSignal): TQueryFnResult<TData> {
        try {
            return this._queryFn(args, signal);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    /**
     * One-time warning for optimistic patches created while a query stream is
     * open (see `allowStreamPatches`). Wired into every entry as `onStreamPatch`.
     */
    private _warnStreamPatch = (): void => {
        if (this._streamPatchWarned) return;
        this._streamPatchWarned = true;
        console.warn(
            `[rx-toolkit] createPatch() on resource "${this._key ?? "<unnamed>"}" while its query stream is open: ` +
                "every emission rebases over active patches, and a committed patch dissolves into the next " +
                "emission's data. Set `allowStreamPatches: true` on the resource to acknowledge this and " +
                "suppress the warning.",
        );
    };

    /** Get the existing cache entry or create a new one. */
    private _getOrCreate(args: TArgsOrKeyed<TArgs>): QueryCacheEntry<TArgs, TData> {
        const keyed = this.toKeyed(args);
        return this._cache.get(keyed.key) ?? this._createEntry(keyed);
    }

    /**
     * The retention option bound to one entry: the function form is re-expressed
     * as a function of the entry's own raw record, which the entry evaluates on
     * every `active → retention` transition.
     */
    private _entryRetentionTime(keyed: TKeyed<TArgs>): IQueryCacheEntryOptions<TArgs, TData>["retentionTime"] {
        const configured = this._retentionTime;
        if (typeof configured !== "function") return configured;
        return (state) => configured(keyed.value, buildEntryState<TArgs, TData, unknown>(keyed.value, state));
    }

    private _createEntry(
        keyed: TKeyed<TArgs>,
        initialState?: TQueryEntryState<TArgs, TData>,
        isInvalidated = false,
    ): QueryCacheEntry<TArgs, TData> {
        // ── beforeQuery sync intercept ──
        // If beforeQuery is set AND there's no snapshot (initialState), intercept
        // to ask other tabs for data before executing queryFn.
        if (!initialState && this._beforeQuery && this._key) {
            return this._createEntryWithBeforeQuery(keyed);
        }

        return this._createEntryDirect(keyed, initialState, isInvalidated);
    }

    /** Standard entry creation: queryFn auto-executes in constructor (unless hydrated). */
    private _createEntryDirect(
        keyed: TKeyed<TArgs>,
        initialState?: TQueryEntryState<TArgs, TData>,
        isInvalidated = false,
    ): QueryCacheEntry<TArgs, TData> {
        // Capture the initial run's lifecycle context for onQueryStarted.
        // During the QueryCacheEntry constructor, _execute() fires synchronously,
        // calling wrappedQueryFn before `entry` is assigned. We save the context
        // in the `else` branch and fire onQueryStarted after construction.
        // eslint-disable-next-line prefer-const -- assigned after constructor; closure reads it
        let entry!: QueryCacheEntry<TArgs, TData>;
        let initialRunLifecycle: TQueryRunLifecycle<TData> | null = null;

        const wrappedQueryFn = (keyedArgs: TKeyed<TArgs>, signal: AbortSignal): TQueryFnResult<TData> => {
            const raw = this._callQueryFn(keyedArgs.value, signal);

            // No hook — hand the run to the entry untouched (streams stay uninstrumented).
            if (!this._onQueryStarted) return raw;

            const { result, lifecycle } = instrumentQueryRun(raw, signal);

            if (entry) {
                // Subsequent calls (invalidate / retry) — entry is already assigned
                this._fireOnQueryStarted(entry, keyedArgs.value, lifecycle);
            } else {
                // Initial call during constructor — defer
                initialRunLifecycle = lifecycle;
            }

            return result;
        };

        entry = new QueryCacheEntry<TArgs, TData>(
            {
                queryFn: wrappedQueryFn,
                retentionTime: this._entryRetentionTime(keyed),
                keyedArgs: keyed,
                resourceKey: this._key,
                mapError: this._mapError,
                errorSource: "query",
                initialState,
                isInvalidated,
                invalidateInFlight: this._invalidateInFlight,
                beforeDevtoolsPush: undefined,
                onStreamPatch: this._allowStreamPatches ? undefined : this._warnStreamPatch,
            },
            this._entryInternals,
        );

        // Register in cache
        this._cache.set(keyed.key, entry);

        // Cleanup: remove entry from cache when it completes (retention expired)
        entry.completed$.subscribe(() => {
            this._cache.delete(keyed.key);
        });

        // Fire onCacheEntryAdded lifecycle hook
        this._fireOnCacheEntryAdded(entry, keyed);

        // Fire onQueryStarted for the initial query (deferred from constructor)
        if (initialRunLifecycle) {
            this._fireOnQueryStarted(entry, keyed.value, initialRunLifecycle);
        }

        return entry;
    }

    /**
     * Entry creation with the beforeQuery intercept: the first run asks other
     * tabs first and falls back to queryFn. The round-trip is that run in
     * flight (see `TQueryCacheEntryInternals.coldLoad`), so `invalidate()`,
     * `fetch` and the other in-flight paths treat it as any run.
     */
    private _createEntryWithBeforeQuery(keyed: TKeyed<TArgs>): QueryCacheEntry<TArgs, TData> {
        // queryFn is only reached after the round-trip, never during the
        // constructor — `entry` is assigned by then.
        const wrappedQueryFn = (keyedArgs: TKeyed<TArgs>, signal: AbortSignal): TQueryFnResult<TData> => {
            const raw = this._callQueryFn(keyedArgs.value, signal);

            if (!this._onQueryStarted) return raw;

            const { result, lifecycle } = instrumentQueryRun(raw, signal);
            this._fireOnQueryStarted(entry, keyedArgs.value, lifecycle);
            return result;
        };

        const beforeQuery = this._beforeQuery!;
        const resourceKey = this._key!;

        const entry: QueryCacheEntry<TArgs, TData> = new QueryCacheEntry<TArgs, TData>(
            {
                queryFn: wrappedQueryFn,
                retentionTime: this._entryRetentionTime(keyed),
                keyedArgs: keyed,
                resourceKey: this._key,
                mapError: this._mapError,
                errorSource: "query",
                invalidateInFlight: this._invalidateInFlight,
                beforeDevtoolsPush: undefined,
                onStreamPatch: this._allowStreamPatches ? undefined : this._warnStreamPatch,
            },
            { ...this._entryInternals, coldLoad: () => beforeQuery(resourceKey, keyed.key) },
        );

        // Register in cache immediately (UI sees pending state)
        this._cache.set(keyed.key, entry);

        entry.completed$.subscribe(() => {
            this._cache.delete(keyed.key);
        });

        this._fireOnCacheEntryAdded(entry, keyed);

        return entry;
    }

    /**
     * Revive a snapshot entry as settled data. A stale one is marked instead of
     * re-queried: hydration creates entries nobody holds yet, and the query
     * goes out with the first hold — a subscription, `ensure` or `fetch`.
     */
    private _hydrateEntry(key: string, meta: { args: TArgs; data: TData; updatedAt: number; isStale: boolean }): void {
        const initialState = snapshotEntryState<TArgs, TData>(meta);

        const keyed = toKeyedUtil<TArgs>(meta.args as TArgsOrKeyed<TArgs>, this._serializeArgs);

        // Verify key matches
        if (keyed.key !== key) {
            console.warn(
                `[rx-toolkit] Snapshot hydration skipped: expected key "${key}" but serialized args produced key "${keyed.key}".`,
            );
            return;
        }

        this._createEntry(keyed, initialState, meta.isStale);
    }

    private _fireOnCacheEntryAdded(entry: QueryCacheEntry<TArgs, TData>, keyed: TKeyed<TArgs>): void {
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

    private _fireOnQueryStarted(
        entry: QueryCacheEntry<TArgs, TData>,
        args: TArgs,
        lifecycle: TQueryRunLifecycle<TData>,
    ): void {
        if (!this._onQueryStarted) return;

        const ctx: TQueryStartedContext<TArgs, TData> = {
            entry,
            $queryFulfilled: lifecycle.$queryFulfilled,
            $queryStream: lifecycle.$queryStream,
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
