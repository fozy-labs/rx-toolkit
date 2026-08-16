import type { Observable, Subscription } from "rxjs";

import type {
    IPatchHandle,
    IQueryCacheEntry,
    IQueryCacheEntryOptions,
    Keyed,
    TErrorContext,
    TMachineState,
    TMapError,
} from "@/query/types";
import type { ReadonlySignal } from "@/signals/types";

import { abortReason } from "../../lib/abortReason";
import { CacheEntryRemovedError } from "../errors";
import { Machine } from "../machine/Machine";
import { hasData } from "../machine/machine-helpers";

import { CacheEntry } from "./CacheEntry";

// ==================== QueryCacheEntry ====================

/** Outcome of matching a machine state in {@link QueryCacheEntry._awaitState}. */
type TSettled<TData> = { kind: "data"; data: TData } | { kind: "error"; error: unknown };

export class QueryCacheEntry<TArgs, TData>
    extends CacheEntry<Machine<TArgs, TData>>
    implements IQueryCacheEntry<TArgs, TData>
{
    readonly keyedArgs: Keyed<TArgs>;
    readonly machine$: ReadonlySignal<Machine<TArgs, TData>>;

    private _queryFn: (keyedArgs: Keyed<TArgs>, signal: AbortSignal) => Promise<TData>;
    private _abortController: AbortController | null = null;

    private readonly _mapError: TMapError;
    private readonly _errorSource: "query" | "command";
    private readonly _resourceKey: string | undefined;

    /** First data ever seen (survives error+retry); rejected only if the entry is removed first. */
    private readonly _firstLoaded: Promise<TData>;

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
        this._mapError = options.mapError ?? ((error) => error);
        this._errorSource = options.errorSource ?? "query";
        this._resourceKey = options.resourceKey;
        this.machine$ = this.state$;

        // The raw stream replays the current state, so hydrated entries settle
        // immediately. Suppress "nobody awaited" rejections (may never be read).
        this._firstLoaded = this._awaitState((state) => (hasData(state) ? { kind: "data", data: state.data } : null), {
            keepalive: false,
        });
        void this._firstLoaded.catch(() => {});

        // Auto-execute queryFn when no initial state is provided. An explicit
        // pending initialMachine suppresses auto-execute (beforeQuery intercept),
        // but a hydrated "refreshing" machine (stale snapshot) requires a real
        // run: the state means "query in flight" and, with refresh()/retry()
        // invalid from it, has no other way out.
        if (!options.initialMachine || options.initialMachine.status === "refreshing") {
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
        return this._awaitState(
            (state) => {
                if (hasData(state)) return { kind: "data", data: state.data };
                if (state.status === "error") return { kind: "error", error: state.error };
                return null;
            },
            { keepalive: true, signal },
        );
    }

    /**
     * Resolve when the machine settles with fresh data (`success`), rejecting on
     * `error` / `refresh-error`. Unlike {@link whenLoaded}, transient stale data
     * (pending / refreshing) is awaited rather than resolved. Used by
     * {@link Resource.fetch} (which always (re)starts a run before awaiting).
     *
     * @experimental Low-level primitive backing the imperative fetch API; may
     *   change before stabilization.
     * @param signal - See {@link whenLoaded}.
     */
    whenFetched(signal?: AbortSignal): Promise<TData> {
        return this._awaitState((state) => this._settleQueryOutcome(state), { keepalive: true, signal });
    }

    /**
     * Promise resolving on the first data the entry ever holds (surviving an
     * initial error + retry), rejecting only if the entry is removed beforehand.
     * Backs the `$cacheDataLoaded` lifecycle context.
     */
    whenFirstLoaded(): Promise<TData> {
        return this._firstLoaded;
    }

    /**
     * Resolve/reject with the outcome of the machine's next settled state — the
     * same transitions as {@link whenFetched}, but without a keepalive
     * subscription, so the caller owns the entry's lifecycle. Backs `Command.execute`.
     *
     * Entry-removal rejections (`CacheEntryRemovedError` from an eviction by a
     * newer execute or a `reset()`) pass through `mapError` here: this promise
     * is what typed consumers catch as `TError`, so an unmapped escape would
     * break that contract at runtime.
     */
    currentResult(): Promise<TData> {
        const result = this._awaitState((state) => this._settleQueryOutcome(state), {
            keepalive: false,
            mapRemoval: true,
        });
        // Suppress "nobody awaited" unhandled rejections (the promise may never be read).
        void result.catch(() => {});
        return result;
    }

    /** Abort any in-flight request before completing the entry. */
    override complete(): void {
        this._abortController?.abort();
        // Completing the state stream rejects all pending waiters with CacheEntryRemovedError.
        super.complete();
    }

    // ==================== Private ====================

    /**
     * Universal state-driven waiter: observe machine transitions (starting from
     * the current state, which is replayed on subscribe) and settle on the first
     * state that `settle` maps to an outcome.
     *
     * Rejects with {@link CacheEntryRemovedError} if the entry completes before a
     * matching state, and with the signal's reason if `signal` aborts first.
     *
     * @param settle - Maps a machine state to a resolution/rejection outcome, or
     *   `null` to keep waiting.
     * @param opts.keepalive - When `true`, observes the shared stream and thereby
     *   holds the share's refcount, so retention GC only resumes once the waiter
     *   settles or detaches. When `false`, observes the raw state stream without
     *   affecting the entry's lifecycle.
     * @param opts.mapRemoval - When `true`, the removal rejection passes through
     *   `mapError` — for waiters feeding a channel typed as `TError` (the
     *   command execute/trigger rejection). Waiters on untyped channels
     *   (`ensure`/`fetch` rejections, `$cacheDataLoaded`) keep the raw
     *   `CacheEntryRemovedError`.
     */
    private _awaitState(
        settle: (state: TMachineState<TArgs, TData>) => TSettled<TData> | null,
        opts: { keepalive: boolean; signal?: AbortSignal; mapRemoval?: boolean },
    ): Promise<TData> {
        const { keepalive, signal } = opts;

        if (signal?.aborted) {
            return Promise.reject(abortReason(signal));
        }

        const source: Observable<Machine<TArgs, TData>> = keepalive ? this.obs : this.rawObs;

        // Manual subscription (instead of firstValueFrom) so the promise settles in
        // the same microtask as the machine transition — no extra `.then` hops.
        return new Promise<TData>((resolve, reject) => {
            let isSettled = false;
            let subscription: Subscription | null = null;

            const finish = (fn: () => void): void => {
                if (isSettled) return;
                isSettled = true;
                signal?.removeEventListener("abort", onAbort);
                subscription?.unsubscribe();
                fn();
            };

            const onAbort = (): void => finish(() => reject(abortReason(signal!)));
            signal?.addEventListener("abort", onAbort, { once: true });

            subscription = source.subscribe({
                next: (machine) => {
                    const outcome = settle(machine.state);
                    if (!outcome) return;
                    finish(() => (outcome.kind === "data" ? resolve(outcome.data) : reject(outcome.error)));
                },
                error: (error: unknown) => finish(() => reject(error)),
                // Stream disposed without a matching state — the entry was removed.
                complete: () =>
                    finish(() => {
                        const removed = new CacheEntryRemovedError("data loaded");
                        reject(opts.mapRemoval ? this._mapError(removed, this._errorContext()) : removed);
                    }),
            });

            // The replayed current state can settle synchronously, before
            // `subscription` was assigned — release it now.
            if (isSettled) subscription.unsubscribe();
        });
    }

    /** Provenance handed to `mapError` for any failure surfaced by this entry. */
    private _errorContext(): TErrorContext {
        return {
            source: this._errorSource,
            args: this.keyedArgs.value,
            entryKey: this.keyedArgs.key,
            key: this._resourceKey,
        };
    }

    /** Settle matcher for a query run's outcome: fresh data or a failed run. */
    private _settleQueryOutcome(state: TMachineState<TArgs, TData>): TSettled<TData> | null {
        if (state.status === "success") return { kind: "data", data: state.data };
        if (state.status === "error" || state.status === "refresh-error") return { kind: "error", error: state.error };
        return null;
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

        this._queryFn(this.keyedArgs, controller.signal)
            .then((data) => {
                if (controller.signal.aborted) return;

                const machine = this.machine$.peek();

                switch (machine.status) {
                    case "pending":
                        this.set(machine.success(data));
                        break;
                    case "refreshing": {
                        const rebased = machine.rebase(data);
                        this.set(rebased);

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

                if (machine.status !== "pending" && machine.status !== "refreshing") {
                    console.warn(`[QueryCacheEntry] received error in unexpected state: ${machine.status}`);
                    return;
                }

                // Single normalization boundary: the raw rejection becomes the api's
                // TError exactly here, as it enters the machine, so every reader of
                // the machine's error — agent state, imperative-fetch rejections, the
                // command execute/trigger rejection, the Suspense throw — observes the same
                // mapped instance. Deliberately upstream of this boundary: lifecycle
                // hooks ($queryFulfilled) are fed from the raw queryFn promise and
                // see the raw error. Aborted runs returned above and are never mapped.
                const mappedError = this._mapError(error, this._errorContext());

                this.set(machine.fail(mappedError));
            });
    }
}
