import { PromiseResolver } from "@/common/utils";
import type { IPatchHandle, IQueryCacheEntry, IQueryCacheEntryOptions, Keyed } from "@/query/types";
import type { ReadonlySignal } from "@/signals/types";

import { withAbort } from "../../lib/withAbort";
import { CacheEntryRemovedError } from "../errors";
import { Machine } from "../machine/Machine";

import { CacheEntry } from "./CacheEntry";

// ==================== QueryCacheEntry ====================

export class QueryCacheEntry<TArgs, TData>
    extends CacheEntry<Machine<TArgs, TData>>
    implements IQueryCacheEntry<TArgs, TData>
{
    readonly keyedArgs: Keyed<TArgs>;
    readonly machine$: ReadonlySignal<Machine<TArgs, TData>>;

    private _queryFn: (keyedArgs: Keyed<TArgs>, signal: AbortSignal) => Promise<TData>;
    private _abortController: AbortController | null = null;

    /** Result of the current query run; resolved/rejected where the machine transitions. */
    private _execution: PromiseResolver<TData> | null = null;
    /** First data ever seen (survives error+retry); rejected only if the entry is removed first. */
    private readonly _loaded = new PromiseResolver<TData>();
    private _loadedSettled = false;

    constructor(options: IQueryCacheEntryOptions<TArgs, TData>) {
        const machine = options.initialMachine ?? Machine.pending<TArgs, TData>(options.keyedArgs.value);

        const devtoolsKey = options.resourceKey
            ? `${options.resourceKey}:${options.keyedArgs.key}`
            : options.keyedArgs.key;

        super(machine, {
            retentionTime: options.retentionTime,
            devtoolsKey,
            beforeDevtoolsPush: options.beforeDevtoolsPush,
        });

        this.keyedArgs = options.keyedArgs;
        this._queryFn = options.queryFn;
        this.machine$ = this.state$;

        // Suppress "nobody awaited" unhandled rejections (the promise may never be read).
        void this._loaded.promise.catch(() => {});

        // Hydrated entries already carry data — settle the first-data promise immediately.
        const initial = machine.state;
        if (initial.status === "success" || initial.status === "refreshing" || initial.status === "refresh-error") {
            this._settleLoaded(initial.data);
        }

        // Auto-execute queryFn when no initial state is provided
        if (!options.initialMachine) {
            this._execute();
        }
    }

    /** Transition to refreshing and re-fetch data. Valid from success or refresh-error. */
    refresh(): void {
        const machine = this.machine$.peek();

        if (machine.status !== "success" && machine.status !== "refresh-error") {
            console.warn(`[QueryCacheEntry] refresh() called in invalid state: ${machine.status}`);
            return;
        }

        this.set(machine.refresh());
        this._execute();
    }

    /** Re-execute query after error. Valid from error state only. */
    retry(): void {
        const machine = this.machine$.peek();

        if (machine.status !== "error") {
            console.warn(`[QueryCacheEntry] retry() called in invalid state: ${machine.status}`);
            return;
        }

        this.set(machine.retry());
        this._execute();
    }

    /** Create an optimistic patch. Returns null if state has no data. */
    createPatch(patchFn: (data: TData) => void): IPatchHandle | null {
        const machine = this.machine$.peek();

        if (machine.status !== "success" && machine.status !== "refreshing" && machine.status !== "refresh-error") {
            console.warn(`[QueryCacheEntry] createPatch() called in invalid state: ${machine.status}`);
            return null;
        }

        const onSettle = () => {
            const current = this.machine$.peek();
            if (
                (current.status === "success" ||
                    current.status === "refreshing" ||
                    current.status === "refresh-error") &&
                current.patchState
            ) {
                const finished = current.finishPatch();
                this.set(finished);

                if (finished.patchState?.isConsistencyViolation) {
                    this.refresh();
                }
            }
        };

        const { machine: newMachine, handle } = machine.createPatch(patchFn, onSettle);

        this.set(newMachine);

        return handle;
    }

    /**
     * Resolve as soon as the entry holds data (whether freshly loaded or already
     * cached / being refreshed), and reject on a terminal `error`. Used by
     * {@link Resource.ensure} / {@link Resource.prefetch}.
     *
     * Stale data (refreshing / refresh-error) resolves immediately — the caller
     * gets whatever is available without waiting for a background refresh.
     *
     * @experimental Low-level primitive backing the imperative fetch API; may
     *   change before stabilization.
     * @param signal - Detaches the caller when aborted: the promise rejects with
     *   the signal's reason. The query itself is untouched and is only torn down
     *   by retention GC once no consumer remains.
     */
    whenLoaded(signal?: AbortSignal): Promise<TData> {
        const state = this.machine$.peek().state;
        switch (state.status) {
            case "success":
            case "refreshing":
            case "refresh-error":
                return Promise.resolve(state.data);
            case "error":
                return Promise.reject(state.error);
            default:
                return this._awaitExecution(signal);
        }
    }

    /**
     * Resolve when the in-flight query settles with fresh data, rejecting if it
     * fails. Unlike {@link whenLoaded}, transient stale data is awaited rather
     * than resolved. Used by {@link Resource.fetch} (which always (re)starts a run
     * before awaiting).
     *
     * @experimental Low-level primitive backing the imperative fetch API; may
     *   change before stabilization.
     * @param signal - See {@link whenLoaded}.
     */
    whenFetched(signal?: AbortSignal): Promise<TData> {
        return this._awaitExecution(signal);
    }

    /**
     * Promise resolving on the first data the entry ever holds (surviving an
     * initial error + retry), rejecting only if the entry is removed beforehand.
     * Backs the `$cacheDataLoaded` lifecycle context.
     */
    whenFirstLoaded(): Promise<TData> {
        return this._loaded.promise;
    }

    /**
     * The current run's result promise — resolves/rejects with this execution's
     * outcome. Unlike {@link whenFetched} it takes no keepalive subscription, so
     * the caller owns the entry's lifecycle. Backs `Command.trigger`.
     */
    currentResult(): Promise<TData> {
        return this._execution?.promise ?? Promise.reject(new CacheEntryRemovedError("data loaded"));
    }

    /** Abort any in-flight request before completing the entry. */
    override complete(): void {
        this._abortController?.abort();
        this._execution?.reject(new CacheEntryRemovedError("data loaded"));
        if (!this._loadedSettled) {
            this._loadedSettled = true;
            this._loaded.reject(new CacheEntryRemovedError("data loaded"));
        }
        super.complete();
    }

    // ==================== Private ====================

    /**
     * Await the current execution's native result promise, holding the entry alive
     * for the duration (so retention GC only resumes once the caller settles).
     */
    private _awaitExecution(signal?: AbortSignal): Promise<TData> {
        const execution = this._execution;
        if (!execution) return Promise.reject(new CacheEntryRemovedError("data loaded"));

        // Bare keepalive subscription: value comes from the native promise, this only
        // holds the share's refcount so the entry isn't GC'd mid-await.
        const keepalive = this.obs.subscribe();
        return withAbort(execution.promise, signal).finally(() => keepalive.unsubscribe());
    }

    private _settleLoaded(data: TData): void {
        if (this._loadedSettled) return;
        this._loadedSettled = true;
        this._loaded.resolve(data);
    }

    /** @internal Called by Resource when beforeQuery intercept needs to trigger the query. */
    _execute(): void {
        // Abort any in-flight request
        this._abortController?.abort();

        const controller = new AbortController();
        this._abortController = controller;
        const machine = this.machine$.peek();

        switch (machine.status) {
            case "success":
            case "refresh-error":
                this.set(machine.refresh());
                break;
            case "pending":
            case "refreshing":
                break;
            case "error":
                return;
            default:
                console.warn(`[QueryCacheEntry] executed in unexpected state: ${(machine as any).status}`);
        }

        // Per-execution result promise. A superseded in-flight run hands its awaiters
        // to this one; `catch` suppresses "nobody awaited" unhandled rejections.
        const execution = new PromiseResolver<TData>();
        const previous = this._execution;
        this._execution = execution;
        void execution.promise.catch(() => {});
        if (previous) {
            void execution.promise.then(
                (data) => previous.resolve(data),
                (error: unknown) => previous.reject(error),
            );
        }

        this._queryFn(this.keyedArgs, controller.signal)
            .then((data) => {
                if (controller.signal.aborted) return;

                const machine = this.machine$.peek();

                switch (machine.status) {
                    case "pending":
                        this.set(machine.success(data));
                        this._settleLoaded(data);
                        execution.resolve(data);
                        break;
                    case "refreshing": {
                        const rebased = machine.rebase(data);
                        this.set(rebased);

                        const fresh = rebased.state.status === "success" ? rebased.state.data : data;
                        this._settleLoaded(fresh);
                        execution.resolve(fresh);

                        if (rebased.patchState?.isConsistencyViolation) {
                            this.refresh();
                        }
                        break;
                    }
                    default:
                        console.warn(`[QueryCacheEntry] received data in unexpected state: ${machine.status}`);
                }
            })
            .catch((error) => {
                if (controller.signal.aborted) return;

                const machine = this.machine$.peek();

                switch (machine.status) {
                    case "pending":
                        this.set(machine.fail(error));
                        execution.reject(error);
                        break;
                    case "refreshing":
                        this.set(machine.fail(error));
                        execution.reject(error);
                        break;
                    default:
                        console.warn(`[QueryCacheEntry] received error in unexpected state: ${machine.status}`);
                }
            });
    }
}
