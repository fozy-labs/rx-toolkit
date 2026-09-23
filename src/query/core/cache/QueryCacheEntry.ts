import { isObservable, type Observable, type Subscription } from "rxjs";

import type {
    IPatchHandle,
    IQueryCacheEntry,
    IQueryCacheEntryOptions,
    TErrorContext,
    TInFlightPolicy,
    TInvalidateOptions,
    TKeyed,
    TMapError,
    TQueryEntryState,
} from "@/query/types";

import { abortReason } from "../../lib/abortReason";
import { CacheEntryRemovedError, EmptyStreamError, PreMappedError } from "../errors";
import { Machine } from "../machine/Machine";
import { isDataState, pendingEntryState } from "../machine/machine-helpers";
import type { MachineBase } from "../machine/MachineBase";

import { CacheEntry } from "./CacheEntry";

// ==================== QueryCacheEntry ====================

/**
 * Lets a run revalidate in place instead of being restarted — for a queryFn
 * whose open stream brings fresh data on its own (the projection resource).
 * When set, `invalidate()` never aborts or joins the run in flight: the mark
 * carries the policy, and when it turns into a revalidation (at once when
 * held, on the first hold when melting) the revalidation is handed to the run
 * — `signal` identifies it (the one its queryFn received), `policy` is the
 * in-flight policy to apply to the requests underneath. The entry moves
 * `success → invalidating` itself; the run's next emission settles it, a
 * stream error fails it. Returns `false` when the run cannot take the
 * revalidation over (it is no longer live) — the entry then restarts it as
 * usual.
 */
export type TRevalidateInRun = (signal: AbortSignal, policy: TInFlightPolicy) => boolean;

/**
 * Core-only wiring of a {@link QueryCacheEntry}: hooks the library's own
 * resources need and that are deliberately kept out of the public
 * {@link IQueryCacheEntryOptions}. Handed to the constructor separately.
 */
export interface TQueryCacheEntryInternals<TData = never> {
    /** See {@link TRevalidateInRun}. */
    revalidateInRun?: TRevalidateInRun;
    /**
     * Where the entry's cold load looks first — the other tabs' cache
     * (`beforeQuery`). Consulted by the first run only, and only when no
     * `initialState` is given: an answer settles the run (`sync`); `null` or
     * a rejection falls through to the queryFn within the same run. The whole
     * round-trip is that run in flight, so every in-flight policy applies to
     * it — `cancel` drops it (a late answer is ignored), `trail` waits for it
     * and whatever it falls through to, `join` takes its outcome.
     */
    coldLoad?: () => Promise<{ data: TData } | null>;
}

/** Outcome of matching an entry state in {@link QueryCacheEntry._awaitState}. */
type TSettled<TData> = { kind: "data"; data: TData } | { kind: "error"; error: unknown };

export class QueryCacheEntry<TArgs, TData>
    extends CacheEntry<TQueryEntryState<TArgs, TData>>
    implements IQueryCacheEntry<TArgs, TData>
{
    readonly keyedArgs: TKeyed<TArgs>;

    private _queryFn: (keyedArgs: TKeyed<TArgs>, signal: AbortSignal) => Promise<TData> | Observable<TData>;

    /**
     * Controller of the run in flight — a promise run that has not settled, or
     * a stream run whose subscription is open — and `null` between runs. Only
     * the run it belongs to may clear it on settle: a superseding run replaces
     * it before the old one is aborted (see {@link _abortRun}), and an aborted
     * run's handlers stand down without touching it.
     */
    private _runController: AbortController | null = null;

    /**
     * Controller of the run whose query stream is currently open (has an
     * active, non-terminated subscription); `null` when no stream is open.
     * Owner-tracked instead of a plain boolean so a superseded run's teardown
     * can tell whether the flag is still its own to reset (see
     * {@link _subscribeStream}).
     */
    private _streamController: AbortController | null = null;

    /** True while the current run's query stream has an active, non-terminated subscription. */
    private get _isStreamOpen(): boolean {
        return this._streamController !== null;
    }

    private readonly _mapError: TMapError;
    private readonly _errorSource: "query" | "command";
    private readonly _resourceKey: string | undefined;
    private readonly _onStreamPatch: (() => void) | undefined;
    private readonly _invalidateInFlight: TInFlightPolicy;
    private readonly _revalidateInRun: TRevalidateInRun | undefined;

    /** See {@link TQueryCacheEntryInternals.coldLoad}; consumed by the first run. */
    private _coldLoad: (() => Promise<{ data: TData } | null>) | undefined;

    /** First data ever seen (survives error+retry); rejected only if the entry is removed first. */
    private readonly _firstLoaded: Promise<TData>;

    /**
     * The entry owes a revalidation: it was invalidated while melting, or while
     * a run it was told to trail was in flight, or a run left flight without
     * landing the load the entry waits for (see {@link _onRunLeftFlight}). The
     * owed run starts at the first moment the entry is held with nothing in
     * flight (see {@link _maybeRevalidate}). Cleared by whatever starts a run
     * — any run that goes out after the mark brings data from after it — and
     * by the hand-over of an in-place revalidation (see {@link _revalidateInPlace}).
     */
    private _isInvalidated = false;

    /**
     * The in-flight policy the pending mark was set under: the strongest of
     * the calls since the last run started (`cancel` > `trail` > `join`).
     * `null` without a mark, and for a mark no call set (a stale snapshot) —
     * the entry's `invalidateInFlight` stands in then. Consumed when the mark
     * turns into a revalidation (see {@link _invalidationRunPolicy}).
     */
    private _markPolicy: TInFlightPolicy | null = null;

    /** Backing field of {@link _invalidationRunPolicy}. */
    private _runPolicy: TInFlightPolicy | null = null;

    constructor(options: IQueryCacheEntryOptions<TArgs, TData>, internals: TQueryCacheEntryInternals<TData> = {}) {
        const initialState = options.initialState ?? pendingEntryState<TArgs>(options.keyedArgs.value);

        const devtoolsKey = options.resourceKey
            ? `${options.resourceKey}:${options.keyedArgs.key}`
            : options.keyedArgs.key;

        // The retention policy is already a function of this entry's state, and
        // the state it would read belongs to the base class — so it is handed
        // over untouched and evaluated there, once per retention cycle.
        super(initialState, {
            retentionTime: options.retentionTime,
            devtoolsKey,
            beforeDevtoolsPush: options.beforeDevtoolsPush,
        });

        this.keyedArgs = options.keyedArgs;
        this._queryFn = options.queryFn;
        this._mapError = options.mapError ?? ((error) => error);
        this._errorSource = options.errorSource ?? "query";
        this._resourceKey = options.resourceKey;
        this._onStreamPatch = options.onStreamPatch;
        this._invalidateInFlight = options.invalidateInFlight ?? "cancel";
        this._revalidateInRun = internals.revalidateInRun;

        // The raw stream replays the current state, so hydrated entries settle
        // immediately. Suppress "nobody awaited" rejections (may never be read).
        this._firstLoaded = this._awaitState(
            (state) => (isDataState(state) ? { kind: "data", data: state.data } : null),
            {
                keepalive: false,
            },
        );
        void this._firstLoaded.catch(() => {});

        // A stale snapshot hydrates as data that owes a revalidation: the entry
        // is born melting and marked, and re-queries on its first hold. A mark
        // on a pending initial state is just as meaningful — nothing is in
        // flight, so the first hold runs the load it owes.
        this._isInvalidated = options.isInvalidated ?? false;

        // Auto-execute queryFn when no initialState is provided — through the
        // cold load, if there is one. An explicit initialState suppresses
        // auto-execute: a pending one is a load nobody started yet, a data
        // one is a snapshot.
        if (!options.initialState) {
            this._coldLoad = internals.coldLoad;
            this._execute();
        }
    }

    /**
     * Whether the entry owes a revalidation: invalidated while melting, or
     * while a run it was told to trail is in flight, or a run left flight
     * without landing the load the entry waits for. On an active entry it is
     * only ever `true` while such a run is in flight.
     */
    get isInvalidated(): boolean {
        return this._isInvalidated;
    }

    /** @internal Whether a query run is in flight: a promise not yet settled, or a stream still open. */
    get _isInFlight(): boolean {
        return this._runController !== null;
    }

    /**
     * @internal The in-flight policy of the invalidation the current run
     * answers, or `null` when it answers none. Set when a run is started by
     * `invalidate()` — at once, or as a mark honoured later — and when a run
     * takes a revalidation over in place (see
     * {@link TRevalidateInRun}); a retry keeps it, so a
     * cold load and its retries stay `null`. The status alone cannot tell: a
     * cold load cancelled by `invalidate()` restarts from `pending`. Read by
     * the projection runtime, whose run then loads its ids under that policy
     * instead of from its item cache.
     */
    get _invalidationRunPolicy(): TInFlightPolicy | null {
        return this._runPolicy;
    }

    /**
     * Re-check what the entry shows. Valid from every status: from error the
     * re-fetch lands in `pending` (the entry holds nothing, and the reader's
     * view may show data the entry does not know about).
     *
     * Lazy: the entry is marked, and the mark turns into a run the moment the
     * entry is held with nothing in flight — right here for a held, settled
     * entry; on the first hold for a melting one (nobody is looking). Marking
     * is idempotent. With a run in flight, `opts.inFlight` — else the entry's
     * `invalidateInFlight` — decides whether that run is aborted now (`cancel`)
     * or left to settle (`trail`) before the rule above applies, or taken as
     * the answer to this call (`join`: nothing is aborted or marked, the call
     * is a no-op); for a stream "in flight" means an open subscription,
     * `success` included. A run that revalidates in place
     * ({@link TRevalidateInRun}) is exempt from all
     * three: it is never aborted or joined here — the mark carries the policy
     * and turns into an in-place revalidation under the same lazy rule, at
     * once when held, on the first hold when melting. Either way this never
     * throws: a failed re-fetch lands in `invalidate-error` like any other. A
     * consistency violation (a patch that could not be replayed) re-queries
     * through this same call, under the entry's `invalidateInFlight`.
     *
     * Never valid on a command entry: a command result is not re-checked, it is
     * re-executed. That is what keeps `invalidating` / `invalidate-error`
     * unreachable for a command, so the command clutch can treat those statuses
     * as an exhaustive `never` branch.
     */
    invalidate(opts?: TInvalidateOptions): void {
        if (this._errorSource === "command") {
            console.warn("[QueryCacheEntry] invalidate() called on a command entry: not supported");
            return;
        }

        const inFlight = opts?.inFlight ?? this._invalidateInFlight;

        // A run that revalidates in place applies the policy itself, to the
        // requests underneath it — here the policy only goes with the mark.
        if (this._isInFlight && !this._revalidateInRun) {
            // Under `join` the caller accepts the run in flight as the answer:
            // nothing is aborted, nothing is marked, nothing follows its settle.
            if (inFlight === "join") return;

            // The run in flight was started before the invalidation: whatever
            // it brings is suspect. Under `cancel` it is dropped here — melting
            // or not: a socket kept open for data nobody trusts is not worth
            // keeping.
            if (inFlight === "cancel") this._abortRun();
        }

        this._isInvalidated = true;
        this._markPolicy = strongerPolicy(this._markPolicy, inFlight);
        this._maybeRevalidate("invalidate");
    }

    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh(): void {
        this.invalidate();
    }

    /**
     * Re-execute the query after a failure. Valid from error and invalidate-error.
     * Unlike {@link invalidate}, the failed error stays visible: in the resulting
     * in-flight state a non-null `error` is what marks the run as a retry.
     */
    retry(): void {
        const machine = this._machine;

        if (machine.status !== "error" && machine.status !== "invalidate-error") {
            console.warn(`[QueryCacheEntry] retry() called in invalid state: ${machine.status}`);
            return;
        }

        this._setMachine(machine.retry(), "retry");
        // The run that starts here settles fresh: it clears any pending mark.
        // A retry of a failed revalidation still answers that invalidation,
        // under the same policy.
        this._execute(this._runPolicy);
    }

    /** Create an optimistic patch. Returns null if state has no data. */
    createPatch(patchFn: (data: TData) => void): IPatchHandle | null {
        const machine = this._machine;

        if (
            machine.status !== "success" &&
            machine.status !== "invalidating" &&
            machine.status !== "invalidate-error"
        ) {
            console.warn(`[QueryCacheEntry] createPatch() called in invalid state: ${machine.status}`);
            return null;
        }

        const onSettle = () => {
            const current = this._machine;
            if (
                (current.status === "success" ||
                    current.status === "invalidating" ||
                    current.status === "invalidate-error") &&
                current.patchState
            ) {
                const finished = current.finishPatch();
                this._setMachine(finished, "patch-settled");

                if (finished.patchState?.isConsistencyViolation) {
                    this.invalidate();
                }
            }
        };

        const { machine: newMachine, handle } = machine.createPatch(patchFn, onSettle);

        this._setMachine(newMachine, "patch");

        // While a query stream is open, incoming emissions rebase over the patch
        // — let the owner surface that (e.g. the resource's one-time warning).
        if (this._isStreamOpen) this._onStreamPatch?.();

        return handle;
    }

    /**
     * Resolve as soon as the entry holds data (whether freshly loaded or already
     * cached / being invalidated), and reject on a terminal `error`. Used by
     * {@link Resource.ensure} / {@link Resource.prefetch}.
     *
     * Stale data (invalidating / invalidate-error) resolves immediately — the caller
     * gets whatever is available without waiting for a background invalidation.
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
                if (isDataState(state)) return { kind: "data", data: state.data };
                if (state.status === "error") return { kind: "error", error: state.error };
                return null;
            },
            { keepalive: true, signal },
        );
    }

    /**
     * Resolve when the entry settles with fresh data (`success`), rejecting on
     * `error` / `invalidate-error`. Unlike {@link whenLoaded}, transient stale data
     * (pending / invalidating) is awaited rather than resolved. Used by
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
     * @internal Backs `Resource.fetch` on an existing entry: make a run answer
     * the fetch under `policy`, and resolve with that run's result.
     *
     * With a run in flight: `join` awaits it (an open stream at `success`
     * already delivered — its data is the answer); `cancel` aborts it and
     * awaits a fresh run; `trail` marks the entry, lets the run settle and
     * awaits the fresh run the mark turns into — the trailed run's own
     * outcome is skipped, however it ends. An open stream counts as in flight
     * until it ends. A run that revalidates in place and has landed its load
     * (`success`) holds no pending result: like a settled entry, it is
     * revalidated under `policy`.
     *
     * With nothing in flight the policy only travels with the revalidation:
     * data is re-queried, a failure retried, and the fresh result awaited. An
     * entry `pending` / `invalidating` with nothing in flight — a hydrated or
     * marked state — starts a run of its own too: a fetch never only awaits a
     * load that may not come. A cold load's round-trip to other tabs
     * ({@link TQueryCacheEntryInternals.coldLoad}) is a run in flight.
     *
     * The wait holds the entry, so a mark turns into its run even on an entry
     * nobody else holds.
     */
    _fetch(policy: TInFlightPolicy, signal?: AbortSignal): Promise<TData> {
        const status = this._machine.status;
        const isRunPending = this._isInFlight && !(this._revalidateInRun && status === "success");

        if (isRunPending) {
            if (policy === "join") return this.whenFetched(signal);
            this.invalidate({ inFlight: policy });
            if (policy === "cancel") return this.whenFetched(signal);
            return this._whenRevalidated(signal);
        }

        // Nothing is pending: a failure is retried, anything else invalidated
        // — held by the wait below, the mark turns into the run at once.
        if (status === "error") {
            this.retry();
        } else {
            this.invalidate({ inFlight: policy });
        }
        return this.whenFetched(signal);
    }

    /**
     * @internal Resolve with the outcome of the first settled state the entry
     * reaches while it owes no revalidation — rejecting on `error` /
     * `invalidate-error` like {@link whenFetched}. Settled states seen while
     * a mark stands belong to a run the mark does not trust (a trailed run:
     * a stream's emissions while it is still open, the run's own settle) and
     * are skipped; the answer is the run the mark turns into.
     *
     * The wait holds the entry, so the mark turns into its run the moment the
     * trailed run leaves flight — even on an entry nobody else holds — and
     * the hold lasts until that run settles. Without a mark it is
     * {@link whenFetched}.
     */
    _whenRevalidated(signal?: AbortSignal): Promise<TData> {
        return this._awaitState((state) => (this._isInvalidated ? null : this._settleQueryOutcome(state)), {
            keepalive: true,
            signal,
        });
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
     * Resolve/reject with the outcome of the entry's next settled state — the
     * same transitions as {@link whenFetched}, but without a keepalive
     * subscription, so the caller owns the entry's lifecycle. Backs `Command.execute`.
     *
     * Entry-removal rejections (`CacheEntryRemovedError` from an eviction by a
     * newer execute or a `reset()`) pass through `mapError` here: this promise
     * feeds the typed `TTriggerResult` envelope, whose `error` is declared as
     * `TError`, so an unmapped escape would break that contract at runtime.
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
        this._abortRun();
        // Completing the state stream rejects all pending waiters with CacheEntryRemovedError.
        super.complete();
    }

    // ==================== Internal ====================

    /**
     * @internal The transition algebra over the entry's current state.
     *
     * The entry stores the flat {@link TQueryEntryState} record; everything that
     * needs a typed transition (`success`, `fail`, `invalidate`, `rebase`,
     * `createPatch`, …) goes through a machine rebuilt here and writes the
     * result back with {@link QueryCacheEntry._setMachine}. Not part of
     * `IQueryCacheEntry`: consumers read `state$` instead.
     */
    get _machine(): Machine<TArgs, TData> {
        return Machine.of(this.peek());
    }

    /** @internal Store the outcome of a transition (see {@link QueryCacheEntry._machine}). */
    _setMachine(machine: MachineBase<TArgs, TData>, actionName?: string): void {
        this.set(machine.state, actionName);
    }

    // ==================== Protected ====================

    /**
     * The `retention → active` transition: an entry marked while melting owes
     * a revalidation, and this is where it runs — unless a trailed run is still
     * in flight, in which case its settle takes over. Called by the retainer
     * before the first subscriber attaches, so its first state is the in-flight
     * one.
     */
    protected override onActive(): void {
        this._maybeRevalidate();
    }

    // ==================== Private ====================

    /**
     * The one rule behind lazy invalidation: the entry revalidates when it is
     * held, nothing is in flight and it owes a revalidation. Checked wherever
     * one of the three can change — `invalidate()` itself, the settle of any
     * run, and the first hold. A completed entry cannot be held, but the guard
     * keeps that explicit.
     *
     * A run that revalidates in place does not count as in flight here: the
     * revalidation is handed to it (see {@link _revalidateInPlace}); should
     * the run turn it down, it is restarted instead.
     */
    private _maybeRevalidate(actionName: "invalidate" | "revalidate" = "revalidate"): void {
        if (this.isCompleted || this.isMelting || !this._isInvalidated) return;

        const policy = this._markPolicy ?? this._invalidateInFlight;
        if (this._isInFlight) {
            // Without in-place revalidation, a run in flight here is a
            // trailed one: its settle takes over.
            if (!this._revalidateInRun) return;
            if (this._revalidateInPlace(actionName, policy)) return;
            this._abortRun();
        }
        this._revalidate(actionName, policy);
    }

    /**
     * Hand the owed revalidation to the run in flight, which re-fetches under
     * `policy` without being restarted. The entry shows it like any other
     * revalidation: `success` goes `invalidating`, and the run's next emission
     * settles it (rebase) or its failure lands in `invalidate-error`;
     * `pending` / `invalidating` already await that emission. The mark is
     * consumed — the revalidation starts here.
     *
     * @returns `false` when the run turned the revalidation down (it is no
     *   longer live) — the caller restarts it; the entry may already be
     *   `invalidating` then, which the restart runs from as it is.
     */
    private _revalidateInPlace(actionName: "invalidate" | "revalidate", policy: TInFlightPolicy): boolean {
        const controller = this._runController;
        const machine = this._machine;
        if (!controller || !this._revalidateInRun) return false;
        if (machine.status !== "pending" && machine.status !== "success" && machine.status !== "invalidating") {
            return false;
        }

        if (machine.status === "success") this._setMachine(machine.invalidate(), actionName);
        this._isInvalidated = false;
        this._markPolicy = null;
        this._runPolicy = policy;
        return this._revalidateInRun(controller.signal, policy);
    }

    /**
     * Re-fetch behind the entry's data: success / invalidate-error go
     * `invalidating`, error goes `pending` with the failure cleared. An entry
     * left `pending` / `invalidating` by a cancelled run is already where the
     * re-fetch starts from — {@link _execute} runs from both as they are.
     *
     * @param actionName - Devtools label: `invalidate` for the direct call,
     *   `revalidate` for a mark honoured later (a hold, a trailed run's settle).
     * @param policy - The in-flight policy the invalidation was made under
     *   (see {@link _invalidationRunPolicy}).
     */
    private _revalidate(actionName: "invalidate" | "revalidate", policy: TInFlightPolicy): void {
        const machine = this._machine;
        if (machine.status !== "pending" && machine.status !== "invalidating") {
            this._setMachine(machine.invalidate(), actionName);
        }
        this._execute(policy);
    }

    /**
     * Abort the run in flight, if any. Its settle handlers stand down (they
     * check the signal), a stream run's subscription is torn down by its abort
     * listener, and the entry is left with nothing in flight — the aborting
     * caller decides what comes next.
     */
    private _abortRun(): void {
        const controller = this._runController;
        if (!controller) return;
        this._runController = null;
        controller.abort();
    }

    /**
     * A run left flight on its own — settled, failed or ended; never aborted
     * (the aborting caller decides what comes next). An entry still waiting
     * for a load (`pending` / `invalidating`) with nothing in flight got
     * nothing from that run it can settle on: a discarded rebase the run did
     * not follow up, an in-place revalidation it did not answer. It owes the
     * run it is waiting for, exactly like a marked entry — re-queried at once
     * when held, on the first hold when melting — so it is never left waiting
     * with nothing in flight and nothing owed. The re-query answers the
     * invalidation the run did, under its policy.
     */
    private _onRunLeftFlight(): void {
        const status = this._machine.status;
        if (!this._isInFlight && !this._isInvalidated && (status === "pending" || status === "invalidating")) {
            this._isInvalidated = true;
            this._markPolicy = this._runPolicy;
        }
        this._maybeRevalidate();
    }

    /** A run reports itself settled: it stops being the run in flight, if it still is. */
    private _settleRun(controller: AbortController): void {
        if (this._runController === controller) {
            this._runController = null;
        }
    }

    /**
     * Universal state-driven waiter: observe the entry's transitions (starting
     * from the current state, which is replayed on subscribe) and settle on the
     * first state that `settle` maps to an outcome.
     *
     * Rejects with {@link CacheEntryRemovedError} if the entry completes before a
     * matching state, and with the signal's reason if `signal` aborts first.
     *
     * @param settle - Maps an entry state to a resolution/rejection outcome, or
     *   `null` to keep waiting.
     * @param opts.keepalive - When `true`, holds the entry for as long as the
     *   waiter is pending, so retention GC only resumes once it settles or
     *   detaches — and a marked entry revalidates on that hold. When `false`,
     *   the waiter does not affect the entry's lifecycle.
     * @param opts.mapRemoval - When `true`, the removal rejection passes through
     *   `mapError` — for waiters feeding a channel typed as `TError` (the
     *   command result envelope). Waiters on untyped channels (`ensure`/`fetch`
     *   rejections, `$cacheDataLoaded`) keep the raw `CacheEntryRemovedError`.
     */
    private _awaitState(
        settle: (state: TQueryEntryState<TArgs, TData>) => TSettled<TData> | null,
        opts: { keepalive: boolean; signal?: AbortSignal; mapRemoval?: boolean },
    ): Promise<TData> {
        const { keepalive, signal } = opts;

        if (signal?.aborted) {
            return Promise.reject(abortReason(signal));
        }

        // Manual subscription (instead of firstValueFrom) so the promise settles in
        // the same microtask as the state transition — no extra `.then` hops.
        return new Promise<TData>((resolve, reject) => {
            let isSettled = false;
            let subscription: Subscription | null = null;

            // The hold is taken before the raw stream is observed: a marked
            // entry revalidates here, so the replayed first state is already
            // the in-flight one and `whenFetched` does not settle on stale data.
            const release = keepalive ? this.hold() : null;

            const finish = (fn: () => void): void => {
                if (isSettled) return;
                isSettled = true;
                signal?.removeEventListener("abort", onAbort);
                subscription?.unsubscribe();
                release?.();
                fn();
            };

            const onAbort = (): void => finish(() => reject(abortReason(signal!)));
            signal?.addEventListener("abort", onAbort, { once: true });

            subscription = this.rawObs.subscribe({
                next: (state) => {
                    const outcome = settle(state);
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

    /**
     * The single normalization boundary shared by the promise and stream
     * failure paths: a raw rejection becomes the api's TError exactly here. An
     * error arriving in a {@link PreMappedError} envelope already passed
     * `mapError` at an upstream entry's boundary (a projection run re-surfacing its
     * wrapped resource's rejection) — it is unwrapped instead of being mapped
     * a second time.
     */
    private _normalizeError(error: unknown): unknown {
        if (error instanceof PreMappedError) return error.error;
        return this._mapError(error, this._errorContext());
    }

    /** Settle matcher for a query run's outcome: fresh data or a failed run. */
    private _settleQueryOutcome(state: TQueryEntryState<TArgs, TData>): TSettled<TData> | null {
        if (state.status === "success") return { kind: "data", data: state.data };
        if (state.status === "error" || state.status === "invalidate-error")
            return { kind: "error", error: state.error };
        return null;
    }

    /**
     * @internal Start a run: the first one on creation, and every re-fetch
     * path in here. The first run goes through the cold load, if any (see
     * {@link TQueryCacheEntryInternals.coldLoad}). Aborts
     * the run in flight, if any, and clears the revalidation mark — the run
     * that starts here goes out after whatever set the mark.
     *
     * @param invalidationPolicy - The in-flight policy of the invalidation the
     *   run answers (see {@link _invalidationRunPolicy}); `null` — the
     *   default — for a cold load.
     */
    _execute(invalidationPolicy: TInFlightPolicy | null = null): void {
        // Abort any in-flight request (also tears down a previous run's stream
        // subscription via its abort listener).
        this._abortRun();

        const machine = this._machine;

        switch (machine.status) {
            case "success":
            case "invalidate-error":
                this._setMachine(machine.invalidate(), "refetch");
                break;
            case "pending":
            case "invalidating":
                break;
            // A failed run is only restarted through retry() / invalidate(), both
            // of which leave `error` before calling back in — a bare _execute()
            // here would lose the failure.
            case "error":
                return;
            default: {
                // Compiler-checked exhaustiveness: the union has no other status.
                const unexpected: never = machine;
                return unexpected;
            }
        }

        this._isInvalidated = false;
        this._markPolicy = null;
        this._runPolicy = invalidationPolicy;

        const controller = new AbortController();
        this._runController = controller;

        const coldLoad = this._coldLoad;
        this._coldLoad = undefined;
        if (coldLoad) {
            this._runColdLoad(coldLoad, controller);
            return;
        }
        this._runQuery(controller);
    }

    /**
     * The cold-load phase of a run (see {@link TQueryCacheEntryInternals.coldLoad}):
     * an answer settles the run, `null` or a rejection hands it on to the
     * queryFn under the same controller. The rejection handler covers the
     * cold load itself only — a throw while settling must not turn into a
     * fallback query.
     */
    private _runColdLoad(coldLoad: () => Promise<{ data: TData } | null>, controller: AbortController): void {
        // A synchronous throw of the cold load counts as its rejection.
        let answer: Promise<{ data: TData } | null>;
        try {
            answer = coldLoad();
        } catch (error) {
            answer = Promise.reject(error);
        }
        answer.then(
            (result) => {
                if (controller.signal.aborted) return;
                if (!result) {
                    this._runQuery(controller);
                    return;
                }
                this._settleRun(controller);

                const machine = this._machine;
                if (machine.status === "pending") {
                    this._setMachine(machine.success(result.data), "sync");
                } else {
                    console.warn(`[QueryCacheEntry] received cold-load data in unexpected state: ${machine.status}`);
                }
                this._onRunLeftFlight();
            },
            () => {
                if (controller.signal.aborted) return;
                this._runQuery(controller);
            },
        );
    }

    /** The query phase of a run: call the queryFn and settle the run from its result. */
    private _runQuery(controller: AbortController): void {
        const result = this._queryFn(this.keyedArgs, controller.signal);

        if (isObservable(result)) {
            this._subscribeStream(result, controller);
            return;
        }

        result
            .then((data) => {
                if (controller.signal.aborted) return;
                this._settleRun(controller);

                const machine = this._machine;

                switch (machine.status) {
                    case "pending":
                        this._setMachine(machine.success(data), "success");
                        break;
                    case "invalidating": {
                        const rebased = machine.rebase(data);
                        this._setMachine(rebased, "rebase");
                        this._rerunOnDiscardedRebase(rebased);
                        break;
                    }
                    default:
                        console.warn(`[QueryCacheEntry] received data in unexpected state: ${machine.status}`);
                }

                // Settled with nothing in flight: a mark set while this run was
                // trailing turns into the re-fetch now (if the entry is held).
                this._onRunLeftFlight();
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                this._settleRun(controller);

                const machine = this._machine;

                if (machine.status !== "pending" && machine.status !== "invalidating") {
                    console.warn(`[QueryCacheEntry] received error in unexpected state: ${machine.status}`);
                    this._onRunLeftFlight();
                    return;
                }

                // Single normalization boundary (see _normalizeError): the raw
                // rejection becomes the api's TError exactly here, as it enters the
                // entry's state, so every reader of that error — clutch state,
                // imperative-fetch rejections, the command result envelope, the
                // Suspense throw — observes the same mapped instance. Deliberately
                // upstream of this boundary: lifecycle hooks ($queryFulfilled) are
                // fed from the raw queryFn promise and see the raw error. Aborted
                // runs returned above and are never mapped.
                const mappedError = this._normalizeError(error);

                // Name the failure by the state it lands in: a failed background invalidation
                // keeps its data, a failed first load has none to keep.
                const failedAction = machine.status === "invalidating" ? "invalidate-error" : "error";

                this._setMachine(machine.fail(mappedError), failedAction);
                this._onRunLeftFlight();
            });
    }

    /**
     * Run a stream-returning queryFn: the first emission settles the run
     * (pending → success / invalidating → rebase), each subsequent emission
     * updates the data through the patch-rebase machinery (success → success),
     * a stream error after data lands in invalidate-error (data kept), and a
     * completion without a single emission fails the run with
     * {@link EmptyStreamError}. Completion after data leaves the entry as-is —
     * unless it still waits for a load (see {@link _onRunLeftFlight}).
     *
     * The subscription is tied to the run's abort controller: a newer
     * `_execute` (invalidate / retry), a cancelling `invalidate()` or entry
     * completion aborts it, which unsubscribes and thereby triggers the
     * producer's teardown.
     *
     * The run counts as in flight for as long as the subscription is open —
     * `success` with a live stream included — so a trailing invalidation waits
     * for completion or failure, never for an emission, and a joining one
     * leaves the stream as it is.
     */
    private _subscribeStream(stream: Observable<TData>, controller: AbortController): void {
        let hasEmitted = false;
        this._streamController = controller;

        // Only the run that opened the stream may declare it closed — a stale
        // run's teardown must not clobber a newer stream run's flag. Ownership
        // is tracked per controller: when a sync emission triggers a
        // re-execute mid-subscribe, the superseding run has already taken over
        // `_runController` (and, if it is itself a stream run,
        // `_streamController`) by the time the aborted run's teardown observes
        // the flags.
        const markClosed = (): void => {
            if (this._streamController === controller) {
                this._streamController = null;
            }
            this._settleRun(controller);
        };

        const subscription = stream.subscribe({
            next: (data) => {
                if (controller.signal.aborted) return;
                hasEmitted = true;
                this._applyStreamData(data);
            },
            error: (error: unknown) => {
                markClosed();
                if (controller.signal.aborted) return;
                this._failStreamRun(error);
                this._onRunLeftFlight();
            },
            complete: () => {
                markClosed();
                if (controller.signal.aborted) return;
                if (!hasEmitted) {
                    this._failStreamRun(new EmptyStreamError());
                }
                // With data delivered, completion simply ends the live phase —
                // the entry keeps the last emission like an ordinary success.
                // Unless that data never landed (a discarded rebase the stream
                // did not follow up, an in-place revalidation it did not
                // answer): the entry then owes the run it is waiting for.
                this._onRunLeftFlight();
            },
        });

        // A synchronous emission may have triggered a consistency-violation
        // invalidate (re-execute → abort) while `subscribe` was still running —
        // in that case the listener below was never attached: release the
        // subscription and this run's stream-open flag now. If the superseding
        // run is itself a stream run, it already owns `_streamController` and
        // `markClosed` is a no-op; if it is a promise run, nothing else would
        // ever reset the flag for this aborted run.
        if (controller.signal.aborted) {
            subscription.unsubscribe();
            markClosed();
            return;
        }

        controller.signal.addEventListener(
            "abort",
            () => {
                subscription.unsubscribe();
                markClosed();
            },
            { once: true },
        );
    }

    /**
     * Re-query when a rebase discarded its own result — a consistency
     * violation, handled like the one a patch settle raises: through
     * {@link invalidate}, so the lazy rule and the entry's in-flight policy
     * apply as they are. The entry is still `invalidating` (the run settled
     * nothing): a promise run has already left flight, so a held entry re-runs
     * at once and a melting one is marked; a stream run is still open, so
     * under `cancel` it is torn down and reopened, under `trail` it is marked
     * and lives on, under `join` it lives on unmarked — its next emission
     * rebases over the now empty patch list and lands in a clean `success`,
     * and so does the next run's first result. A joined stream that ends
     * without that emission leaves the entry owing the run (see
     * {@link _onRunLeftFlight}).
     */
    private _rerunOnDiscardedRebase(rebased: Machine<TArgs, TData>): void {
        if (rebased.status !== "invalidating") return;
        if (!rebased.state.patchState?.isConsistencyViolation) return;

        this.invalidate();
    }

    /** Apply a stream emission to the entry's state (see {@link _subscribeStream}). */
    private _applyStreamData(data: TData): void {
        const machine = this._machine;

        switch (machine.status) {
            case "pending":
                this._setMachine(machine.success(data), "success");
                break;
            case "invalidating": {
                const rebased = machine.rebase(data);
                this._setMachine(rebased, "rebase");
                this._rerunOnDiscardedRebase(rebased);
                break;
            }
            case "success": {
                const next = machine.next(data);
                this._setMachine(next, "stream-next");

                if (next.patchState?.isConsistencyViolation) {
                    this.invalidate();
                }
                break;
            }
            default:
                console.warn(`[QueryCacheEntry] received stream data in unexpected state: ${machine.status}`);
        }
    }

    /** Fail the current stream run; unlike the promise path, `success` is a valid failure origin. */
    private _failStreamRun(error: unknown): void {
        const machine = this._machine;

        if (machine.status !== "pending" && machine.status !== "invalidating" && machine.status !== "success") {
            console.warn(`[QueryCacheEntry] received stream error in unexpected state: ${machine.status}`);
            return;
        }

        // Same single normalization boundary as the promise path (see _execute).
        const mappedError = this._normalizeError(error);

        const failedAction = machine.status === "pending" ? "error" : "invalidate-error";

        this._setMachine(machine.fail(mappedError), failedAction);
    }
}

// ==================== Helpers ====================

/** How far each policy goes in distrusting a run in flight. */
const POLICY_STRENGTH: Record<TInFlightPolicy, number> = { join: 0, trail: 1, cancel: 2 };

/**
 * Merge the policy of another `invalidate()` call into a pending mark: the
 * stronger one wins — what a weaker call would accept, the stronger one has
 * already asked not to.
 */
function strongerPolicy(current: TInFlightPolicy | null, next: TInFlightPolicy): TInFlightPolicy {
    if (current === null) return next;
    return POLICY_STRENGTH[next] > POLICY_STRENGTH[current] ? next : current;
}
