import { shallowEqual } from "@/common/utils/shallowEqual";
import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";
import { stableStringify } from "@/query-v2/lib/stableStringify";
import type { IResourceV2Agent } from "@/query-v2/types/agent.types";
import type { ICacheEntry } from "@/query-v2/types/cache.types";
import type { TOnCacheEntryAdded, TOnQueryStarted } from "@/query-v2/types/lifecycle.types";
import type { TMachine, TPatchFn } from "@/query-v2/types/machine.types";
import type { IResourceV2 } from "@/query-v2/types/resource.types";
import type { TBeforeDevtoolsPushFn, TCompareArgsFn, TQueryFn, TSerializeArgsFn } from "@/query-v2/types/shared.types";
import { Batcher } from "@/signals";

import { CacheEntry, type CacheEntryOptions } from "../common/CacheEntry";
import { CacheMap, type TCacheMapInstance } from "../common/CacheMap";
import { LifecycleHooks } from "../common/LifecycleHooks";
import type { TMachineInstance } from "../machines/Machine";
import { MachineIdle } from "../machines/MachineIdle";
import { MachineRefreshing } from "../machines/MachineRefreshing";
import { MachineSuccess } from "../machines/MachineSuccess";
import { MachineWithData } from "../machines/MachineWithData";
import { ResourceV2Agent } from "./ResourceV2Agent";

export interface ResourceV2Config<TArgs, TData, TError = Error> {
    key?: string;
    keyPrefix?: string;
    keyStrategy?: "serialize" | "compare";
    queryFn: TQueryFn<TArgs, TData>;
    onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>;
    onQueryStarted?: TOnQueryStarted<TArgs, TData>;
    serializeArgs?: TSerializeArgsFn;
    compareArg?: TCompareArgsFn;
    cacheLifetime?: number;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TMachine<TData, TError>>;
    maxSnapshotDataAge?: number;
    doCacheArgs?: boolean;
}

interface InFlightEntry<TData, TError> {
    promise: Promise<CacheEntry<TData, TError>>;
    abortController: AbortController;
}

/**
 * Cache-backed resource manager.
 * Orchestrates queries, caching, lifecycle hooks, GC, and optimistic patches for a single resource type.
 */
export class ResourceV2<TArgs, TData, TError = Error> implements IResourceV2<TArgs, TData, TError> {
    private readonly _cache: TCacheMapInstance<TArgs, TData, TError>;
    private readonly _queryFn: TQueryFn<TArgs, TData>;
    private readonly _lifecycleHooks: LifecycleHooks<TArgs, TData, TError>;
    private readonly _serializeArgs: TSerializeArgsFn;
    private readonly _compareArg: TCompareArgsFn;
    private readonly _keyStrategy: "serialize" | "compare";
    private readonly _cacheLifetime: number;
    private readonly _beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TMachine<TData, TError>>;
    private readonly _key?: string;
    private readonly _keyPrefix?: string;

    /** In-flight queries keyed by serialized args — for dedup + abort */
    private readonly _inFlight = new Map<string, InFlightEntry<TData, TError>>();

    /** Cache lifetime timers keyed by serialized args */
    private readonly _gcTimers = new Map<string, ReturnType<typeof setTimeout>>();

    /** Refresh error listeners (used by Agent for refreshError tracking) */
    private readonly _refreshErrorListeners = new Set<(args: TArgs, error: TError) => void>();

    constructor(config: ResourceV2Config<TArgs, TData, TError>) {
        this._queryFn = config.queryFn;
        this._serializeArgs = config.serializeArgs ?? stableStringify;
        this._compareArg = config.compareArg ?? shallowEqual;
        this._keyStrategy = config.keyStrategy ?? "serialize";
        this._cacheLifetime = config.cacheLifetime ?? 60_000;
        this._beforeDevtoolsPush = config.beforeDevtoolsPush;
        this._key = config.key;
        this._keyPrefix = config.keyPrefix;

        this._cache = CacheMap.create<TArgs, TData, TError>({
            keyStrategy: this._keyStrategy,
            serializeArgs: this._serializeArgs,
            compareArg: this._compareArg,
            doCacheArgs: config.doCacheArgs ?? false,
        });

        this._lifecycleHooks = new LifecycleHooks<TArgs, TData, TError>({
            onCacheEntryAdded: config.onCacheEntryAdded,
            onQueryStarted: config.onQueryStarted,
            serializeArgs: this._serializeArgs,
        });
    }

    /**
     * Create an agent that tracks a single cache entry with reactive state (SWR).
     *
     * @returns A new agent bound to this resource.
     */
    createAgent(): IResourceV2Agent<TArgs, TData, TError> {
        return new ResourceV2Agent<TArgs, TData, TError>(this);
    }

    /**
     * Execute a query for the given args, returning the cache entry.
     * Deduplicates concurrent calls for the same args unless `doForce` is set.
     *
     * @param args - Query arguments (used as cache key).
     * @param doForce - If true, bypass dedup and re-execute the query.
     * @returns The cache entry after query initiation.
     */
    async query(args: TArgs, doForce?: boolean): Promise<ICacheEntry<TData, TError>> {
        // SKIP check
        if ((args as unknown) === SKIP) {
            throw new Error("SKIP_TOKEN is not valid for direct query()");
        }

        const key = this._serializeArgs(args);

        // Cache hit — return existing entry (unless force)
        const existing = this._cache.get(args);
        if (existing && !doForce) {
            const machine = existing.peek();
            // If already success or pending or refreshing, return the entry
            if (machine.state.status !== "idle") {
                return existing as unknown as ICacheEntry<TData, TError>;
            }
        }

        // Query dedup — if already in-flight for same args, return same promise
        if (!doForce) {
            const flight = this._inFlight.get(key);
            if (flight) {
                return flight.promise as unknown as Promise<ICacheEntry<TData, TError>>;
            }
        }

        // Cancel existing in-flight for same args (ADR-4 Layer 1)
        const existingFlight = this._inFlight.get(key);
        if (existingFlight) {
            existingFlight.abortController.abort();
            this._inFlight.delete(key);
        }

        // Cancel any pending GC timer for these args
        this._cancelGcTimer(key);

        const abortController = new AbortController();
        const isNewEntry = !existing;

        // Create or reuse entry inside Batcher for atomic updates
        let cacheEntry: CacheEntry<TData, TError>;

        // Set up entry and pending state
        Batcher.run(() => {
            if (isNewEntry || doForce) {
                if (existing && doForce) {
                    cacheEntry = existing as unknown as CacheEntry<TData, TError>;
                    // Transition to refreshing or pending based on current state
                    const current = cacheEntry.peek();
                    if (current instanceof MachineSuccess) {
                        const refreshing = current.invalidate();
                        cacheEntry.set(refreshing as unknown as TMachineInstance<TData, TError>);
                    } else if (current instanceof MachineRefreshing) {
                        // Already refreshing — it'll be re-queried
                    } else {
                        const idle = MachineIdle.create();
                        const pending = idle.start(args);
                        cacheEntry.set(pending as unknown as TMachineInstance<TData, TError>);
                    }
                } else {
                    // New entry
                    const idle = MachineIdle.create();
                    const pending = idle.start(args);
                    cacheEntry = new CacheEntry<TData, TError>(
                        pending as unknown as TMachineInstance<TData, TError>,
                        this._buildCacheEntryOptions(args),
                    );
                    this._cache.set(args, cacheEntry as unknown as CacheEntry<TData, TError>);

                    // Fire onCacheEntryAdded for new entries
                    this._lifecycleHooks.fireCacheEntryAdded(args, () => cacheEntry.peek());
                }
            } else {
                cacheEntry = existing as unknown as CacheEntry<TData, TError>;
                const current = cacheEntry.peek();
                const pending = (current as MachineIdle).start(args);
                cacheEntry.set(pending as unknown as TMachineInstance<TData, TError>);
            }

            // Fire onQueryStarted
            this._lifecycleHooks.fireQueryStarted(args, () => cacheEntry);
        });

        // Execute queryFn
        const promise = this._executeQuery(args, key, cacheEntry!, abortController);

        this._inFlight.set(key, { promise: promise as Promise<CacheEntry<TData, TError>>, abortController });

        return promise as unknown as Promise<ICacheEntry<TData, TError>>;
    }

    /**
     * Reactive query — read machine state as a signal dependency.
     * Initiates the query if not already cached.
     *
     * @param args - Query arguments.
     * @returns Current machine state (registers a reactive subscription).
     */
    query$(args: TArgs, doForce?: boolean): TMachine<TData, TError> {
        if ((args as unknown) === SKIP) {
            return MachineIdle.create().state as TMachine<TData, TError>;
        }

        // Trigger query (fire-and-forget) and read entry signal reactively
        const entryResult = this._cache.get(args);
        if (!entryResult) {
            // Initiate query
            this.query(args, doForce);
            // Return idle while it's being initiated
            const newEntry = this._cache.get(args);
            if (newEntry) {
                return (newEntry.machine$() as TMachineInstance<TData, TError>).state as TMachine<TData, TError>;
            }
            return MachineIdle.create().state as TMachine<TData, TError>;
        }

        if (doForce) {
            this.query(args, true);
        }

        // Reactive read — registers signal dependency
        return (entryResult.machine$() as TMachineInstance<TData, TError>).state as TMachine<TData, TError>;
    }

    /**
     * Get the cache entry for the given args without initiating a query (unless `doInitiate` is set).
     *
     * @param args - Query arguments.
     * @returns The cache entry, or `null` if not cached.
     */
    entry(args: TArgs, doInitiate?: boolean): ICacheEntry<TData, TError> | null {
        const existing = this._cache.get(args);
        if (existing) {
            return existing as unknown as ICacheEntry<TData, TError>;
        }

        if (doInitiate) {
            // Fire-and-forget query initiation
            this.query(args);
            return (this._cache.get(args) as unknown as ICacheEntry<TData, TError>) ?? null;
        }

        return null;
    }

    entry$(args: TArgs, doInitiate?: boolean): TMachine<TData, TError> {
        if ((args as unknown) === SKIP) {
            return MachineIdle.create().state as TMachine<TData, TError>;
        }

        const existing = this._cache.get(args);
        if (!existing && doInitiate) {
            this.query(args);
            const created = this._cache.get(args);
            if (created) {
                return (created.machine$() as TMachineInstance<TData, TError>).state as TMachine<TData, TError>;
            }
        }
        if (existing) {
            return (existing.machine$() as TMachineInstance<TData, TError>).state as TMachine<TData, TError>;
        }
        return MachineIdle.create().state as TMachine<TData, TError>;
    }

    invalidate(args: TArgs): void {
        const existing = this._cache.get(args);
        if (!existing) return;

        const machine = existing.peek();

        // Only invalidate from success state
        if (!(machine instanceof MachineSuccess)) return;

        const key = this._serializeArgs(args);

        // Abort any existing in-flight for these args (ADR-4 Layer 1)
        const flight = this._inFlight.get(key);
        if (flight) {
            flight.abortController.abort();
            this._inFlight.delete(key);
        }

        const abortController = new AbortController();

        Batcher.run(() => {
            const refreshing = (machine as MachineSuccess<TData>).invalidate();
            existing.set(refreshing as unknown as TMachineInstance<TData, TError>);

            this._lifecycleHooks.fireQueryStarted(args, () => existing as unknown as CacheEntry<TData, TError>);
        });

        const promise = this._executeRefresh(
            args,
            key,
            existing as unknown as CacheEntry<TData, TError>,
            abortController,
        );

        this._inFlight.set(key, { promise, abortController });
    }

    compareArgs(a: TArgs, b: TArgs): boolean {
        if (this._keyStrategy === "compare") {
            return this._compareArg(a, b);
        }
        return this._serializeArgs(a) === this._serializeArgs(b);
    }

    /** Public key getter for API registry */
    get key(): string | undefined {
        return this._key;
    }

    /** Public keyStrategy getter for snapshot validation */
    get keyStrategy(): "serialize" | "compare" {
        return this._keyStrategy;
    }

    /** Serialize args to string key */
    getSerializedKey(args: TArgs): string {
        return this._serializeArgs(args);
    }

    /** Iterate cache entries — for snapshot */
    cacheEntries(): Iterable<[TArgs | string, CacheEntry<TData, TError>]> {
        return this._cache.entries() as Iterable<[TArgs | string, CacheEntry<TData, TError>]>;
    }

    /** Hydrate a cache entry from snapshot data */
    hydrateEntry(args: TArgs, machine: TMachineInstance<TData, TError>): void {
        const existing = this._cache.get(args);
        if (existing) return; // Don't overwrite existing entries

        const entry = new CacheEntry<TData, TError>(machine, this._buildCacheEntryOptions(args));
        this._cache.set(args, entry as unknown as CacheEntry<TData, TError>);

        // Fire lifecycle for hydrated entries
        this._lifecycleHooks.fireCacheEntryAdded(args, () => entry.peek());
        if (machine.state.status === "success") {
            this._lifecycleHooks.resolveCacheDataLoaded(args, machine.state.data as TData);
        }
    }

    /** Check if cache entry exists for given args */
    hasEntry(args: TArgs): boolean {
        return this._cache.has(args);
    }

    /** Pre-populate cache with data */
    populateEntry(args: TArgs, data: TData): void {
        const existing = this._cache.get(args);
        if (existing) {
            const success = MachineSuccess.create(data, args);
            (existing as unknown as CacheEntry<TData, TError>).set(
                success as unknown as TMachineInstance<TData, TError>,
            );
            return;
        }

        const success = MachineSuccess.create(data, args);
        const entry = new CacheEntry<TData, TError>(
            success as unknown as TMachineInstance<TData, TError>,
            this._buildCacheEntryOptions(args),
        );
        this._cache.set(args, entry as unknown as CacheEntry<TData, TError>);
    }

    /** Create an optimistic patch on a cache entry */
    createEntryPatch(args: TArgs, patchFn: TPatchFn<TData>): { commit: () => void; abort: () => void } | null {
        const entry = this._cache.get(args) as CacheEntry<TData, TError> | undefined;
        if (!entry) return null;

        const machine = entry.peek();
        if (!(machine instanceof MachineWithData)) return null;

        const { machine: patchedMachine, patch } = machine.createPatch(patchFn);
        entry.set(patchedMachine as unknown as TMachineInstance<TData, TError>);

        return {
            commit: () => {
                const current = entry.peek();
                if (current instanceof MachineWithData) {
                    const finished = current.finishPatch("commit", patch);
                    entry.set(finished as unknown as TMachineInstance<TData, TError>);
                }
            },
            abort: () => {
                const current = entry.peek();
                if (current instanceof MachineWithData) {
                    const finished = current.finishPatch("abort", patch);
                    entry.set(finished as unknown as TMachineInstance<TData, TError>);
                }
            },
        };
    }

    /** Lock a cache entry — prevent GC eviction. Returns unlock function. */
    lockEntry(args: TArgs): { unlock: () => void } {
        this.cancelGc(args);
        return {
            unlock: () => {
                // Re-schedule GC (will be cancelled again if still subscribed)
                this.scheduleGc(args);
            },
        };
    }

    /** Subscribe to refresh error events (used by Agent) */
    onRefreshError(listener: (args: TArgs, error: TError) => void): () => void {
        this._refreshErrorListeners.add(listener);
        return () => {
            this._refreshErrorListeners.delete(listener);
        };
    }

    /** Reset the entire cache — aborts in-flight requests, clears GC timers, completes all entries. */
    resetCache(): void {
        // Abort all in-flight requests
        for (const [, flight] of this._inFlight) {
            flight.abortController.abort();
        }
        this._inFlight.clear();

        // Clear all GC timers
        for (const [, timer] of this._gcTimers) {
            clearTimeout(timer);
        }
        this._gcTimers.clear();

        // Complete all cache entries
        for (const entry of this._cache.values()) {
            (entry as unknown as CacheEntry<TData, TError>).complete();
        }

        // Clear lifecycle hooks
        this._lifecycleHooks.clearAll();

        // Clear the cache map
        this._cache.clear();
    }

    /**
     * Schedule GC for a cache entry after cacheLifetime.
     * Called when subscriber count drops to 0.
     */
    scheduleGc(args: TArgs): void {
        const key = this._serializeArgs(args);
        this._cancelGcTimer(key);

        this._gcTimers.set(
            key,
            setTimeout(() => {
                this._gcTimers.delete(key);
                this._evictEntry(args, key);
            }, this._cacheLifetime),
        );
    }

    /**
     * Cancel pending GC for a cache entry.
     * Called when a new subscriber appears.
     */
    cancelGc(args: TArgs): void {
        const key = this._serializeArgs(args);
        this._cancelGcTimer(key);
    }

    // --- Private helpers ---

    private _cancelGcTimer(key: string): void {
        const timer = this._gcTimers.get(key);
        if (timer != null) {
            clearTimeout(timer);
            this._gcTimers.delete(key);
        }
    }

    private _evictEntry(args: TArgs, key: string): void {
        const entry = this._cache.get(args);
        if (!entry) return;

        // Abort in-flight if any
        const flight = this._inFlight.get(key);
        if (flight) {
            flight.abortController.abort();
            this._inFlight.delete(key);
        }

        // Fire lifecycle removal
        this._lifecycleHooks.fireCacheEntryRemoved(args);

        // Complete the entry (ADR-4 Layer 3)
        (entry as unknown as CacheEntry<TData, TError>).complete();

        // Remove from cache
        this._cache.delete(args);
    }

    private async _executeQuery(
        args: TArgs,
        key: string,
        cacheEntry: CacheEntry<TData, TError>,
        abortController: AbortController,
    ): Promise<CacheEntry<TData, TError>> {
        try {
            const data = await this._queryFn(args, {
                abortSignal: abortController.signal,
            });

            // If aborted after await, don't process result
            if (abortController.signal.aborted) {
                return cacheEntry;
            }

            Batcher.run(() => {
                const current = cacheEntry.peek();
                if (current.state.status === "pending") {
                    const success = (
                        current as unknown as import("../machines/MachinePending").MachinePending<TData>
                    ).successHappened(data);
                    cacheEntry.set(success as unknown as TMachineInstance<TData, TError>);
                } else if (current.state.status === "refreshing") {
                    const success = (current as unknown as MachineRefreshing<TData>).successHappened(data);
                    cacheEntry.set(success as unknown as TMachineInstance<TData, TError>);
                }
            });

            this._lifecycleHooks.resolveCacheDataLoaded(args, data);
            this._lifecycleHooks.resolveQueryFulfilled(data);
        } catch (error: unknown) {
            if (abortController.signal.aborted) {
                this._lifecycleHooks.rejectQueryFulfilled(error);
                return cacheEntry;
            }

            Batcher.run(() => {
                const current = cacheEntry.peek();
                if (current.state.status === "pending") {
                    const errorMachine = (
                        current as unknown as import("../machines/MachinePending").MachinePending<TData>
                    ).errorHappened(error as TError);
                    cacheEntry.set(errorMachine as unknown as TMachineInstance<TData, TError>);
                } else if (current.state.status === "refreshing") {
                    // ADR-2: Preserve stale data
                    const success = (current as unknown as MachineRefreshing<TData>).errorHappened(error);
                    cacheEntry.set(success as unknown as TMachineInstance<TData, TError>);

                    // Notify refresh error listeners (used by Agent)
                    for (const listener of this._refreshErrorListeners) {
                        listener(args, error as TError);
                    }
                }
            });

            this._lifecycleHooks.rejectQueryFulfilled(error);
        } finally {
            this._inFlight.delete(key);
        }

        return cacheEntry;
    }

    private async _executeRefresh(
        args: TArgs,
        key: string,
        cacheEntry: CacheEntry<TData, TError>,
        abortController: AbortController,
    ): Promise<CacheEntry<TData, TError>> {
        return this._executeQuery(args, key, cacheEntry, abortController);
    }

    private _buildCacheEntryOptions(args: TArgs): CacheEntryOptions {
        const parts: string[] = [];
        if (this._keyPrefix) parts.push(this._keyPrefix);
        if (this._key) parts.push(this._key);
        parts.push(this._serializeArgs(args));

        return {
            keyParts: parts.length > 0 ? parts : undefined,
            beforeDevtoolsPush: this._beforeDevtoolsPush as TBeforeDevtoolsPushFn<unknown> | undefined,
        };
    }
}
