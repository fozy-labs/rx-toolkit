import type {
    Args,
    ArgsOrVoid,
    IResource,
    IResourceAgent,
    IResourceConfig,
    IResourceLiteState,
    Keyed,
    TCacheEntryAddedContext,
    TPackedResource,
    TQueryStartedContext,
} from "@/query/types";
import { Signal, type ReadonlySignal } from "@/signals";

import { toKeyed as toKeyedUtil } from "../../lib/toKeyed";
import { CacheMap } from "../cache/CacheMap";
import { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { CacheEntryRemovedError } from "../errors";
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
export class Resource<TArgs, TData> implements IResource<TArgs, TData> {
    private readonly _cache = new CacheMap<QueryCacheEntry<TArgs, TData>>();

    /**
     * Хранит последний добавленный кэш-энтер, для возможности реактивной подписки (с помощью getEntry$)
     */
    private readonly _lastEntry$ = Signal.state<QueryCacheEntry<TArgs, TData> | null>(null, { isDisabled: true });

    /**
     * Определяет общий статус ресурса
     * - "idle": ресурса не активен, записей нет, getEntry$ возвращает null
     * - "running": ресурс активен, есть хотя бы одна запись, getEntry$ может возвращать записи
     */
    private readonly _status$ = Signal.state<"idle" | "running">("idle", { isDisabled: true });

    private readonly _queryFn: (args: TArgs, abortSignal: AbortSignal) => Promise<TData>;
    readonly _key: string | undefined;
    private readonly _retentionTime: number | false;
    private readonly _serializeArgs: (args: TArgs) => string;
    private readonly _onCacheEntryAdded;
    private readonly _onQueryStarted;
    private readonly _beforeQuery?;

    constructor(config: IResourceConfig<TArgs, TData>) {
        this._queryFn = config.queryFn;
        this._key = config.key;
        this._retentionTime = config.retentionTime;
        this._serializeArgs = config.serializeArgs;
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
     * @param doInitiate - When `true`, creates and starts the entry if absent.
     * @returns The cache entry, or `null` if not found and `doInitiate` is `false`.
     */
    getEntry(args: ArgsOrVoid<TArgs>, doInitiate = false): QueryCacheEntry<TArgs, TData> | null {
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
     * Reactive variant of {@link getEntry} — establishes a signal dependency
     * so that `Signal.compute` / `Signal.effect` callers re-evaluate when the
     * cache map changes (entry added or removed).
     *
     * @param args - Query arguments (or `void` when `TArgs` is `void`).
     * @param doInitiate - When `true`, creates and starts the entry if absent.
     * @returns The cache entry, or `null` if not found and `doInitiate` is `false`.
     */
    getEntry$(args: ArgsOrVoid<TArgs>, doInitiate: true): ReadonlySignal<QueryCacheEntry<TArgs, TData>>;
    getEntry$(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
    getEntry$(args: Keyed<TArgs>, doInitiate?: boolean): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
    getEntry$(
        args: ArgsOrVoid<TArgs> | Keyed<TArgs>,
        doInitiate = false,
    ): ReadonlySignal<QueryCacheEntry<TArgs, TData> | null> {
        return Signal.compute(
            () => {
                const keyed = this.toKeyed(args as Args<TArgs>);

                const status = this._status$();

                if (status === "idle" && !doInitiate) {
                    return null;
                }

                const lastEntry = this._lastEntry$();

                if (lastEntry?.keyedArgs.key === keyed.key) {
                    return lastEntry;
                }

                return this._cache.get(keyed.key) ?? null;
            },
            { isDisabled: true },
        );
    }

    /**
     * Create a reactive {@link ResourceAgent} that observes this resource
     * and provides SWR-aware state transitions.
     */
    createAgent(): IResourceAgent<TArgs, TData> {
        return new ResourceAgent<TArgs, TData>(this);
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
     * the library, which can later read `resource`/`args` (e.g. `resource.trigger(args)`).
     *
     * @param args - Query arguments (or a {@link Keyed} wrapper).
     * @returns A `{ kind: "resource", resource, args }` descriptor.
     */
    pack(args: Args<TArgs>): TPackedResource<TArgs, TData> {
        return { kind: "resource", resource: this, args };
    }

    /**
     * Get a simplified state object for the given arguments.
     */
    getState(args: ArgsOrVoid<TArgs>): IResourceLiteState<TArgs, TData> {
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

        if (machine.status === "refreshing" || machine.status === "refresh-error" || machine.status === "success") {
            return {
                status: machine.status,
                data: machine.state.data,
                error: machine.status === "refresh-error" ? machine.state.error : null,
                args: entry.keyedArgs.value,
                isLoading: machine.status === "refreshing" || machine.status === "refresh-error",
                isInitialLoading: false,
                isRefreshing: machine.status === "refreshing",
                isRefreshError: machine.status === "refresh-error",
                isSuccess: machine.status === "success",
                isError: false,
            };
        }

        if (machine.status === "error") {
            return {
                status: "error",
                data: null,
                error: machine.state.error,
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
        this._status$.set("idle");
        this._lastEntry$.set(null);
    }

    // ==================== Private ====================

    /**
     * Get an existing cache entry or create a new one.
     *
     * @internal Used by {@link ResourceAgent} and Command links.
     * @param args - Query arguments.
     * @param doForce - When `true`, forces a refresh on an existing entry.
     */
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
            const promise = this._queryFn(keyedArgs.value, signal);

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
            initialMachine,
            beforeDevtoolsPush: undefined,
        });

        // Register in cache
        this._cache.set(keyed.key, entry);
        this._status$.set("running");
        this._lastEntry$.set(entry);

        // Cleanup: remove entry from cache when it completes (retention expired)
        entry.completed$.subscribe(() => {
            this._cache.delete(keyed.key);
            if (this._cache.size === 0) this._status$.set("idle");
            if (this._lastEntry$() === entry) {
                this._lastEntry$.set(null);
            }
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
            const promise = this._queryFn(keyedArgs.value, signal);
            this._fireOnQueryStarted(entry, keyedArgs.value, promise);
            return promise;
        };

        // Create entry with an explicit pending Machine to PREVENT auto-execute
        const entry = new QueryCacheEntry<TArgs, TData>({
            queryFn: wrappedQueryFn,
            retentionTime: this._retentionTime,
            keyedArgs: keyed,
            resourceKey: this._key,
            initialMachine: Machine.pending<TArgs, TData>(keyed.value),
            beforeDevtoolsPush: undefined,
        });

        // Register in cache immediately (UI sees pending state)
        this._cache.set(keyed.key, entry);
        this._status$.set("running");
        this._lastEntry$.set(entry);

        entry.completed$.subscribe(() => {
            this._cache.delete(keyed.key);
            if (this._cache.size === 0) this._status$.set("idle");
            if (this._lastEntry$() === entry) {
                this._lastEntry$.set(null);
            }
        });

        this._fireOnCacheEntryAdded(entry, keyed);

        // Ask other tabs for data, fall back to queryFn
        this._beforeQuery!(this._key!, keyed.key)
            .then((result) => {
                if (result) {
                    const machine = entry.machine$.peek();
                    if (machine.status === "pending") {
                        entry.set(machine.success(result.data));
                    }
                } else {
                    entry._execute();
                }
            })
            .catch(() => {
                entry._execute();
            });

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
        // $cacheEntryRemoved: resolves when entry is removed from cache
        let resolveRemoved!: () => void;

        const $cacheEntryRemoved = new Promise<void>((resolve) => {
            resolveRemoved = resolve;
        });

        const $cacheDataLoaded = new Promise<TData>((resolve, reject) => {
            // Watch the entry's state for the first success
            const sub = entry.state$.obs.subscribe((machine: Machine<TArgs, TData>) => {
                if (machine.state.status === "success" || machine.state.status === "refreshing") {
                    resolve(machine.state.data);
                    sub.unsubscribe();
                }
            });

            // If the entry is cleaned up before success, reject
            entry.completed$.subscribe(() => {
                sub.unsubscribe();
                reject(new CacheEntryRemovedError("data loaded"));
            });
        });

        // When entry is cleaned up, resolve $cacheEntryRemoved
        entry.completed$.subscribe(() => {
            resolveRemoved();
        });

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
