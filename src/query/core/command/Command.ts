import type {
    Args,
    ICommand,
    ICommandAgent,
    ICommandConfig,
    Keyed,
    TCacheEntryAddedContext,
    TPackedCommand,
    TQueryStartedContext,
} from "@/query/types";
import { Signal } from "@/signals";

import { KEYED_BRAND } from "../../constants";
import { isKeyed } from "../../lib/toKeyed";
import { CacheMap } from "../cache/CacheMap";
import { QueryCacheEntry } from "../cache/QueryCacheEntry";

import { CommandAgent } from "./CommandAgent";
import { LinkManager } from "./LinkManager";

// ==================== Command ====================

/**
 * Abstraction for write operations (mutations).
 *
 * Manages cache entries, link-based optimistic/update patches on related resources,
 * and lifecycle hooks (`onCacheEntryAdded`, `onQueryStarted`).
 *
 * @template TArgs - The argument type accepted by the mutation.
 * @template TData - The data type returned by the mutation.
 *
 * @see {@link https://github.com/AcademyCity/rx-toolkit/blob/main/docs/query/api/command.md | Command API docs}
 */
export class Command<TArgs, TData> implements ICommand<TArgs, TData> {
    private readonly _cache = new CacheMap<QueryCacheEntry<TArgs, TData>>();
    private readonly _lastEntry$ = Signal.state<QueryCacheEntry<TArgs, TData> | null>(null, { isDisabled: true });
    private readonly _status$ = Signal.state<"idle" | "running">("idle", { isDisabled: true });

    private readonly _queryFn;
    readonly _key;
    private readonly _linkManager;
    private readonly _retentionTime;
    private readonly _generateRequestId: (args: TArgs) => string | Promise<string>;
    private readonly _onCacheEntryAdded;
    private readonly _onQueryStarted;

    private _keyCounter = 0;

    constructor(config: ICommandConfig<TArgs, TData>) {
        this._queryFn = config.queryFn;
        this._key = config.key;
        this._linkManager = new LinkManager(config.links);
        this._retentionTime = config.retentionTime;
        this._generateRequestId = config.generateRequestId ?? (() => crypto.randomUUID());
        this._onCacheEntryAdded = config.onCacheEntryAdded;
        this._onQueryStarted = config.onQueryStarted;
    }

    // ==================== Public API (ICommand) ====================

    /**
     * Imperatively execute the mutation.
     *
     * Applies optimistic patches, runs `queryFn`, then commits/rolls-back
     * patches and invalidates linked resources on success/failure.
     *
     * @param argsOrKeyed - Plain arguments or a {@link Keyed} wrapper.
     * @param key - Optional cache-entry key. Auto-generated when omitted.
     * @returns A promise that resolves with the mutation result.
     */
    trigger(argsOrKeyed: Args<TArgs>, key?: string): Promise<TData> {
        const keyed = this._toKeyed(argsOrKeyed, key);
        const args = keyed.value;
        const entryKey = keyed.key;

        const linkManager = this._linkManager;

        // 1. Apply optimistic patches (synchronous, before queryFn)
        const patchHandles = linkManager.applyOptimisticPatches(args);

        // Clean up existing entry for the same key, if any
        const existing = this._cache.get(entryKey);
        if (existing) {
            existing.complete();
        }

        // eslint-disable-next-line prefer-const -- assigned after constructor; closure reads it
        let entry!: QueryCacheEntry<TArgs, TData>;
        let initialQueryPromise: Promise<TData> | null = null;
        let firstAttemptSettled = false;

        // Request id is minted once per cache entry and reused across retries, so a
        // failed-then-retried mutation carries the same idempotency token to the
        // backend. A fresh `trigger` creates a new entry and therefore a new id.
        let requestId: string | undefined;
        let requestIdPromise: Promise<string> | undefined;

        const runQueryFn = (): Promise<TData> => {
            // Reuse an already-minted id across retries (same idempotency token).
            if (requestId !== undefined) {
                return this._queryFn(args, requestId);
            }

            // An async mint is already in flight: chain onto it rather than re-minting.
            if (requestIdPromise) {
                return requestIdPromise.then((id) => this._queryFn(args, id));
            }

            const minted = this._generateRequestId(args);

            // Sync generator (incl. the default uuid): keep the call fully synchronous,
            // so command timing is unchanged when no async id generator is configured.
            if (!(minted instanceof Promise)) {
                requestId = minted;
                return this._queryFn(args, minted);
            }

            // Async generator: mint once and cache the resolved id. Don't cache a
            // rejection — a failed mint must not poison a later retry.
            const pending = minted.then((id) => {
                requestId = id;
                return id;
            });
            pending.catch(() => {
                if (requestIdPromise === pending) requestIdPromise = undefined;
            });
            requestIdPromise = pending;

            return pending.then((id) => this._queryFn(args, id));
        };

        const wrappedQueryFn = (_keyedArgs: Keyed<TArgs>, _signal: AbortSignal): Promise<TData> => {
            const promise = runQueryFn();

            // Link orchestration runs per execution; the result itself is surfaced by
            // the entry's native promise (`entry.currentResult()`), settled where the
            // machine transitions. This `.then` is registered before the one in
            // `_execute`, so `settle` runs before `trigger()`'s promise resolves.
            promise.then(
                (result) => {
                    if (!firstAttemptSettled) {
                        firstAttemptSettled = true;
                        linkManager.settle(args, patchHandles, { status: "fulfilled", value: result });
                    } else {
                        // Retry succeeded: optimistic patches were already rolled back on
                        // the first failure, so only apply update patches + invalidation.
                        linkManager.settle(args, [], { status: "fulfilled", value: result });
                    }
                },
                (error) => {
                    if (!firstAttemptSettled) {
                        firstAttemptSettled = true;
                        linkManager.settle(args, patchHandles, { status: "rejected", reason: error });
                    }
                    // Retry failed: nothing to settle — optimistic handles were already
                    // aborted and the original trigger promise already rejected. The
                    // machine stays in `error`, ready for another retry.
                },
            );

            // Lifecycle: onQueryStarted
            if (entry) {
                this._fireOnQueryStarted(entry, args, promise);
            } else {
                initialQueryPromise = promise;
            }

            return promise;
        };

        // 4. Create QueryCacheEntry — auto-executes wrappedQueryFn in constructor
        entry = new QueryCacheEntry<TArgs, TData>({
            queryFn: wrappedQueryFn,
            retentionTime: this._retentionTime,
            keyedArgs: keyed,
            resourceKey: this._key,
        });

        // Mutation result = the entry's first run. Captured now (before any retry
        // replaces the current execution) so it reflects only the first attempt.
        const firstResult = entry.currentResult();

        // Register in cache
        this._cache.set(entryKey, entry);
        this._status$.set("running");
        this._lastEntry$.set(entry);

        // Cleanup: remove entry from cache when it completes
        entry.completed$.subscribe(() => {
            // Guard: only remove if THIS entry is still the current one for the key
            if (this._cache.get(entryKey) === entry) {
                this._cache.delete(entryKey);
                if (this._cache.size === 0) this._status$.set("idle");
                if (this._lastEntry$() === entry) {
                    this._lastEntry$.set(null);
                }
            }
        });

        // Fire onCacheEntryAdded lifecycle hook
        this._fireOnCacheEntryAdded(entry, keyed);

        // Fire onQueryStarted for the initial query (deferred from constructor)
        if (initialQueryPromise) {
            this._fireOnQueryStarted(entry, keyed.value, initialQueryPromise);
        }

        return firstResult;
    }

    /**
     * Synchronously retrieve a cache entry by key.
     *
     * @param key - The cache-entry key.
     * @returns The matching {@link QueryCacheEntry}, or `null` if none exists.
     */
    getEntry(key: string): QueryCacheEntry<TArgs, TData> | null {
        return this._cache.get(key) ?? null;
    }

    /**
     * Reactive variant of {@link getEntry}.
     *
     * Reads an internal signal so that callers in a reactive context
     * (e.g. `computed`, `effect`) re-evaluate when the cache changes.
     *
     * @param key - The cache-entry key.
     * @returns The matching {@link QueryCacheEntry}, or `null` if none exists.
     */
    getEntry$(key: string): QueryCacheEntry<TArgs, TData> | null {
        let entry: QueryCacheEntry<TArgs, TData> | null = null;

        const signal$ = Signal.compute(
            () => {
                const status = this._status$();

                if (status === "idle") {
                    return null;
                }

                // Fast path: already found in a previous evaluation
                if (entry) {
                    return entry;
                }

                const lastEntry = this._lastEntry$();
                if (lastEntry?.keyedArgs.key === key) {
                    entry = lastEntry;
                    return entry;
                }

                return this._cache.get(key) ?? null;
            },
            { isDisabled: true },
        );

        return signal$();
    }

    /**
     * Create a reactive agent that observes this command's state.
     *
     * @param key - Optional key to bind the agent to a specific cache entry.
     * @returns A new {@link ICommandAgent} instance.
     */
    createAgent(key?: string): ICommandAgent<TArgs, TData> {
        return new CommandAgent<TArgs, TData>(this, key);
    }

    /**
     * Bundle this command with arguments (and an optional cache key) into an inert
     * {@link TPackedCommand} descriptor. Nothing is executed — the consumer hands
     * the descriptor back to the library, which can later run it
     * (e.g. `command.trigger(args, key)`).
     *
     * @param args - Mutation arguments (or a {@link Keyed} wrapper).
     * @param key - Optional cache-entry key, forwarded to {@link trigger}.
     * @returns A `{ kind: "command", command, args, key }` descriptor.
     */
    pack(args: Args<TArgs>, key?: string): TPackedCommand<TArgs, TData> {
        return { kind: "command", command: this, args, key };
    }

    /** Clear all cache entries. Called by createApi.resetAll(). */
    reset(): void {
        const entries = [...this._cache.values()];
        this._cache.clear();
        this._status$.set("idle");
        this._lastEntry$.set(null);
        for (const entry of entries) {
            entry.complete();
        }
    }

    // ==================== Private — Key Generation ====================

    private _generateKey(): string {
        return `${Date.now()}-${this._keyCounter++}`;
    }

    private _toKeyed(args: Args<TArgs>, key?: string): Keyed<TArgs> {
        if (isKeyed(args)) {
            return args;
        }

        return {
            value: args,
            key: key ?? this._generateKey(),
            [KEYED_BRAND]: true,
        } as Keyed<TArgs>;
    }

    // ==================== Private — Lifecycle Hooks ====================

    private _fireOnCacheEntryAdded(entry: QueryCacheEntry<TArgs, TData>, keyed: Keyed<TArgs>): void {
        if (!this._onCacheEntryAdded) return;

        let resolveRemoved!: () => void;

        const $cacheEntryRemoved = new Promise<void>((resolve) => {
            resolveRemoved = resolve;
        });

        const $cacheDataLoaded = entry.whenFirstLoaded();

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
