import { randomUUID } from "@/common/utils/randomUUID";
import type {
    ICommand,
    ICommandClutch,
    ICommandConfig,
    IQueryCacheEntryOptions,
    TArgsOrKeyed,
    TBoundCommand,
    TCacheEntryAddedContext,
    TKeyed,
    TMapError,
    TQueryStartedContext,
} from "@/query/types";
import { Batcher, Signal, unstable_KeyedSignal } from "@/signals";
import { untracked } from "@/signals/base/untracked";

import { KEYED_BRAND } from "../../constants";
import { abortReason } from "../../lib/abortReason";
import { isKeyed } from "../../lib/toKeyed";
import { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { instrumentQueryRun, settleQueryRun, type TQueryRunLifecycle } from "../resource/instrumentQueryRun";

import { CommandClutch } from "./CommandClutch";
import { buildCommandEntryState } from "./entry-state";
import { LinkManager, type TLinkedPatch } from "./LinkManager";

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
export class Command<TArgs, TData, TError = unknown> implements ICommand<TArgs, TData, TError> {
    private readonly _cache = unstable_KeyedSignal.state<QueryCacheEntry<TArgs, TData>>();

    private readonly _queryFn;
    readonly _key;
    private readonly _linkManager;
    private readonly _retentionTime;
    private readonly _generateRequestId: (args: TArgs) => string | Promise<string>;
    private readonly _mapError: TMapError;
    private readonly _onCacheEntryAdded;
    private readonly _onQueryStarted;

    private _entryKeyCounter = 0;

    constructor(config: ICommandConfig<TArgs, TData>) {
        this._queryFn = config.queryFn;
        this._key = config.key;
        this._linkManager = new LinkManager(config.links);
        this._retentionTime = config.retentionTime;
        this._generateRequestId = config.generateRequestId ?? randomUUID;
        this._mapError = config.mapError ?? ((error) => error);
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
     * @param argsOrKeyed - Plain arguments or a {@link TKeyed} wrapper.
     * @param entryKey - Optional cache-entry key. Auto-generated when omitted.
     * @returns A promise that resolves with the mutation result. Every
     *   rejection is normalized via `mapError` — including the
     *   `CacheEntryRemovedError` produced when the entry is evicted mid-flight
     *   (re-execute with the same entry key, `reset()` / `resetAll()`).
     */
    execute(argsOrKeyed: TArgsOrKeyed<TArgs>, entryKey?: string): Promise<TData> {
        // execute() must never throw synchronously, and every rejection of the
        // returned promise must be normalized to the api's TError — the clutch /
        // hook envelope (wrapTrigger) casts on that guarantee. queryFn failures
        // are mapped at the entry's error boundary and removals inside currentResult;
        // this guard converts anything thrown before the entry takes over
        // (argument normalization, cache bookkeeping) into a mapped rejection.
        try {
            return this._execute(argsOrKeyed, entryKey);
        } catch (error) {
            return Promise.reject(
                this._mapError(error, {
                    source: "command",
                    args: isKeyed(argsOrKeyed) ? argsOrKeyed.value : argsOrKeyed,
                    // The throw may precede entry-key generation — best effort from the input.
                    entryKey: isKeyed(argsOrKeyed) ? argsOrKeyed.key : (entryKey ?? ""),
                    // The command's own key (identifier / cache-key prefix), not the entry key.
                    key: this._key,
                }),
            );
        }
    }

    private _execute(argsOrKeyed: TArgsOrKeyed<TArgs>, entryKey?: string): Promise<TData> {
        const keyed = this._toKeyed(argsOrKeyed, entryKey);
        const args = keyed.value;
        const resolvedEntryKey = keyed.key;

        const linkManager = this._linkManager;

        // Optimistic patches are applied inside wrappedQueryFn (first run only),
        // so a throwing optimisticUpdate enters the entry's state like any other
        // mutation failure — the entry exists and settles in `error`, state
        // observers (clutch / useCommand) see it, and mapError normalizes it at
        // the single fail() boundary. The handles belong to the first run: the
        // run that settles first takes them, any later one settles none.
        let patchHandles: TLinkedPatch[] = [];
        let optimisticApplied = false;

        const settleLinks = (outcome: PromiseSettledResult<TData>): void => {
            const handles = patchHandles;
            patchHandles = [];
            linkManager.settle(args, handles, outcome);
        };

        // Clean up existing entry for the same entry key, if any — it is
        // completed where the new entry is registered, inside one batch below.
        const existing = this._cache.get(resolvedEntryKey);

        // eslint-disable-next-line prefer-const -- read during the constructor below via wrappedQueryFn
        let entry!: QueryCacheEntry<TArgs, TData>;
        let initialRunLifecycle: TQueryRunLifecycle<TData> | null = null;

        // A mutation in flight keeps its entry: every run — the first one and
        // each retry() — holds it until the entry records the run's outcome.
        // Nobody may be subscribed (with the default retentionTime: 0 a fresh
        // entry, or one whose last subscriber left mid-retry, would be collected
        // out from under the mutation), so only an explicit removal —
        // re-execute, reset() / resetAll() — drops a mutation in flight. It also
        // means every `active → retention` transition happens on a settled
        // entry: a `retentionTime` policy sees `success` or `error`, never
        // `pending`. Returns the run's result (see `currentResult`).
        // `.then(f, f)` instead of `.finally()`: the promise `.finally()` derives
        // re-rejects with the run's error and nobody consumes it, so every
        // failed run would surface a global unhandled rejection.
        const holdUntilSettled = (): Promise<TData> => {
            const release = entry.hold();
            const result = entry.currentResult();
            void result.then(release, release);
            return result;
        };

        // Request id is minted once per cache entry and reused across retries, so a
        // failed-then-retried mutation carries the same idempotency token to the
        // backend. A fresh `execute` creates a new entry and therefore a new id.
        let requestId: string | undefined;
        let requestIdPromise: Promise<string> | undefined;

        // A run whose entry was removed while its id was being minted is
        // dropped before it is sent (see the abort handling in wrappedQueryFn).
        const sendOnceMinted = (id: string, signal: AbortSignal): Promise<TData> => {
            if (signal.aborted) return Promise.reject(abortReason(signal));
            return this._queryFn(args, id);
        };

        const runQueryFn = (signal: AbortSignal): Promise<TData> => {
            // Reuse an already-minted id across retries (same idempotency token).
            if (requestId !== undefined) {
                return this._queryFn(args, requestId);
            }

            // An async mint is already in flight: chain onto it rather than re-minting.
            if (requestIdPromise) {
                return requestIdPromise.then((id) => sendOnceMinted(id, signal));
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

            return pending.then((id) => sendOnceMinted(id, signal));
        };

        const wrappedQueryFn = (_keyedArgs: TKeyed<TArgs>, signal: AbortSignal): Promise<TData> => {
            // A throwing optimisticUpdate, a non-async queryFn, or a sync
            // generateRequestId can all throw *before* a promise exists. Convert
            // that synchronous throw into a rejected promise here — this is the
            // one point where the invariants converge: the rejection flows into
            // the settle handler below (rolling back the already-applied
            // optimistic patches) and back through `_execute` (transitioning the
            // entry to `error`), so execute() keeps its always-returns-a-Promise
            // contract instead of throwing out of the QueryCacheEntry
            // constructor and stranding the patches.
            let promise: Promise<TData>;
            try {
                // Applied once per execute, not per run: a retry runs after
                // the first failure already rolled the patches back and must not
                // re-apply them. A throwing optimisticUpdate rolls back its own
                // partial patches inside applyOptimisticPatches, leaving
                // patchHandles empty — the rejected settle below is then a no-op.
                if (!optimisticApplied) {
                    optimisticApplied = true;
                    patchHandles = linkManager.applyOptimisticPatches(args);
                }

                promise = runQueryFn(signal);
            } catch (error) {
                promise = Promise.reject(error);
            }

            // Link orchestration runs per execution; the result itself is surfaced by
            // the entry's native promise (`entry.currentResult()`), settled where the
            // entry transitions. This `.then` is registered before the one in
            // `_execute`, so `settle` runs before `execute()`'s promise resolves.
            // A retry that succeeds applies update patches and invalidation only;
            // one that fails has nothing to settle.
            //
            // A retry holds the entry like the first run does (see holdUntilSettled);
            // the first run is held once the entry exists.
            if (entry) void holdUntilSettled();

            // The entry aborts the run only when it is removed — a re-execute with
            // the same key, reset() / resetAll(). The mutation is then
            // dropped like a failed one: its optimistic patches roll back at once,
            // and a result that still arrives applies no link — the cache it would
            // write into may already belong to someone else (a reset on logout).
            signal.addEventListener("abort", () => settleLinks({ status: "rejected", reason: abortReason(signal) }), {
                once: true,
            });
            promise.then(
                (value) => {
                    if (!signal.aborted) settleLinks({ status: "fulfilled", value });
                },
                (reason: unknown) => {
                    if (!signal.aborted) settleLinks({ status: "rejected", reason });
                },
            );

            // Lifecycle: onQueryStarted
            if (this._onQueryStarted) {
                const { lifecycle } = instrumentQueryRun(promise, signal);
                if (entry) {
                    this._fireOnQueryStarted(entry, args, lifecycle);
                } else {
                    initialRunLifecycle = lifecycle;
                }
            }

            return promise;
        };

        // Create QueryCacheEntry — auto-executes wrappedQueryFn in constructor
        entry = new QueryCacheEntry<TArgs, TData>(
            {
                queryFn: wrappedQueryFn,
                retentionTime: this._entryRetentionTime(keyed),
                keyedArgs: keyed,
                resourceKey: this._key,
                mapError: this._mapError,
                errorSource: "command",
            },
            { onPromiseRunSettled: settleQueryRun },
        );

        // Mutation result = the entry's first run. Captured now (before any retry
        // replaces the current execution) so it reflects only the first attempt.
        const firstResult = holdUntilSettled();

        // Re-triggering under an entry key replaces its entry: the old one
        // completes (removing the key through its own completed$ subscription)
        // and the new one is set — inside one batch the entry-less state in
        // between is never published. An `idle` would otherwise flash between
        // `success` and `pending` on every repeat save.
        Batcher.run(() => {
            existing?.complete();
            this._cache.set(resolvedEntryKey, entry);
        });

        // Cleanup: remove entry from cache when it completes
        entry.completed$.subscribe(() => {
            // Guard: only remove if THIS entry is still the current one for the entry key
            if (this._cache.get(resolvedEntryKey) === entry) {
                this._cache.delete(resolvedEntryKey);
            }
        });

        // Fire onCacheEntryAdded lifecycle hook
        this._fireOnCacheEntryAdded(entry, keyed);

        // Fire onQueryStarted for the initial query (deferred from constructor)
        if (initialRunLifecycle) {
            this._fireOnQueryStarted(entry, keyed.value, initialRunLifecycle);
        }

        return firstResult;
    }

    /**
     * Synchronously retrieve a cache entry by its entry key.
     *
     * @param entryKey - The cache-entry key.
     * @returns The matching {@link QueryCacheEntry}, or `null` if none exists.
     */
    getEntry(entryKey: string): QueryCacheEntry<TArgs, TData> | null {
        return this._cache.get(entryKey) ?? null;
    }

    /**
     * Reactive variant of {@link getEntry}.
     *
     * Reads an internal signal so that callers in a reactive context
     * (e.g. `computed`, `effect`) re-evaluate when the cache changes.
     *
     * @param entryKey - The cache-entry key.
     * @returns The matching {@link QueryCacheEntry}, or `null` if none exists.
     */
    getEntry$(entryKey: string): QueryCacheEntry<TArgs, TData> | null {
        const signal$ = Signal.compute(() => this._cache.get$(entryKey) ?? null, { isDisabled: true });

        return signal$();
    }

    /**
     * Create a reactive clutch that observes this command's state.
     *
     * @param entryKey - Optional cache-entry key to bind the clutch to a specific cache entry.
     * @returns A new {@link ICommandClutch} instance.
     */
    createClutch(entryKey?: string): ICommandClutch<TArgs, TData, TError> {
        return new CommandClutch<TArgs, TData, TError>(this, entryKey);
    }

    /** @deprecated Renamed to {@link createClutch}. Will be removed in 0.14.0. */
    createAgent(entryKey?: string): ICommandClutch<TArgs, TData, TError> {
        return this.createClutch(entryKey);
    }

    /**
     * Bundle this command with arguments (and an optional cache-entry key) into an
     * inert {@link TBoundCommand} descriptor. Nothing is executed — the consumer
     * hands the descriptor back to the library, which can later run it
     * (e.g. `command.execute(args, entryKey)`).
     *
     * @param args - Mutation arguments (or a {@link TKeyed} wrapper).
     * @param entryKey - Optional cache-entry key, forwarded to {@link execute}.
     * @returns A `{ kind: "command", command, args, entryKey }` descriptor.
     */
    bind(args: TArgsOrKeyed<TArgs>, entryKey?: string): TBoundCommand<TArgs, TData, TError> {
        return { kind: "command", command: this, args, entryKey };
    }

    /** @deprecated Renamed to {@link bind}. Will be removed in 0.14.0. */
    pack(args: TArgsOrKeyed<TArgs>, entryKey?: string): TBoundCommand<TArgs, TData, TError> {
        return this.bind(args, entryKey);
    }

    /** Clear all cache entries. Called by createApi.resetAll(). */
    reset(): void {
        const entries = [...this._cache.values()];
        this._cache.clear();
        for (const entry of entries) {
            entry.complete();
        }
    }

    // ==================== Private — Entry Key Generation ====================

    private _generateEntryKey(): string {
        return `${Date.now()}-${this._entryKeyCounter++}`;
    }

    private _toKeyed(args: TArgsOrKeyed<TArgs>, entryKey?: string): TKeyed<TArgs> {
        if (isKeyed(args)) {
            return args;
        }

        return {
            value: args,
            key: entryKey ?? this._generateEntryKey(),
            [KEYED_BRAND]: true,
        } as TKeyed<TArgs>;
    }

    // ==================== Private — Retention ====================

    /**
     * The retention option bound to one entry: the function form is re-expressed
     * as a function of the entry's own raw record, which the entry evaluates on
     * every `active → retention` transition.
     */
    private _entryRetentionTime(keyed: TKeyed<TArgs>): IQueryCacheEntryOptions<TArgs, TData>["retentionTime"] {
        const configured = this._retentionTime;
        if (typeof configured !== "function") return configured;
        return (state) => configured(keyed.value, buildCommandEntryState<TArgs, TData, unknown>(state));
    }

    // ==================== Private — Lifecycle Hooks ====================

    private _fireOnCacheEntryAdded(entry: QueryCacheEntry<TArgs, TData>, keyed: TKeyed<TArgs>): void {
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
            // Untracked, like the queryFn (see QueryCacheEntry._runQuery): the
            // hook runs inside whatever called execute().
            const onCacheEntryAdded = this._onCacheEntryAdded;
            const result = untracked(() => onCacheEntryAdded(keyed.value, ctx));
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

        // Commands are promise-only: both stream milestones coincide with the
        // run's outcome (see instrumentQueryRun).
        const ctx: TQueryStartedContext<TArgs, TData> = {
            entry,
            $queryFulfilled: lifecycle.$queryFulfilled,
            $queryStream: lifecycle.$queryStream,
        };

        try {
            const onQueryStarted = this._onQueryStarted;
            const result = untracked(() => onQueryStarted(args, ctx));
            // Hook may be async — suppress unhandled rejection
            void Promise.resolve(result).catch(() => {});
        } catch {
            // Lifecycle errors are suppressed (per docs)
        }
    }
}
