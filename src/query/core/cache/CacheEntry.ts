import { Observable, Subject } from "rxjs";

import { MAX_TIMEOUT_DELAY } from "@/common/utils";
import type { ICacheEntry, ICacheEntryOptions } from "@/query/types";
import { DependencyTracker, State, type DependencyRecord, type ReadonlySignal } from "@/signals";

import { Retainer } from "./Retainer";

// ==================== Retention normalization ====================

/**
 * Delay a retention option value asks for; `null` — no timer at all.
 *
 * Total on purpose. The option's type is `number | false`, but the boundary it
 * comes across is not always typed — a JS caller, an `any`, or a policy that
 * forgets to return — and the two failure modes sit on opposite behaviours:
 * `setTimeout(fn, undefined)` evicts at once while `null` is this function's
 * own "keep it" answer. Anything that is not a real number is therefore read
 * the same way as `NaN`: meaningless, so evict rather than guess a lifetime.
 */
function normalizeRetentionTime(value: number | false): number | null {
    if (value === false) return null;
    // NaN compares false against every bound, so non-numbers go first.
    if (typeof value !== "number" || Number.isNaN(value)) return 0;
    // Above the setTimeout limit a timer fires immediately, which would evict
    // the entry instead of retaining it — so such values mean "keep it".
    if (value > MAX_TIMEOUT_DELAY) return null;
    if (value < 0) return 0;
    return value;
}

// ==================== Tracking isolation ====================

/**
 * Run `fn` outside the calling dependency-tracking scope.
 *
 * The retention hooks fire synchronously inside a consumer's subscribe or
 * teardown — for a `Computed` / `Effect` that is the middle of its run, with
 * the tracker collecting every signal read as that consumer's dependency. An
 * `onActive` that starts a query (a deferred revalidation) would otherwise
 * register whatever the `queryFn` / `onQueryStarted` reads as a dependency of
 * the subscribing consumer. A no-op handler swallows those reads.
 */
function untracked<T>(fn: () => T): T {
    const stopTracking = DependencyTracker.start(() => {});
    try {
        return fn();
    } finally {
        stopTracking();
    }
}

// ==================== CacheEntry ====================

/**
 * Internal reactive container wrapping a Signal.state<TState>, with a
 * {@link Retainer} deciding how long it outlives its last consumer.
 * Implements ICacheEntry<TState>.
 *
 * Two ways to read it:
 * - {@link obs} / {@link state$}`()` hold the entry: a subscriber, or a
 *   `Computed` / `Effect` that read the signal, keep it `active`;
 * - {@link peek} / {@link state$}`.peek()` read the stored value directly —
 *   no subscription, no retention cycle, no side effect.
 */
export class CacheEntry<TState> implements ICacheEntry<TState> {
    private readonly _state$: State<TState>;
    private readonly _retainer: Retainer<TState>;
    private _isCompleted = false;

    readonly completed$ = new Subject<void>();
    /** The state stream. Replays the current state on subscribe; subscribing holds the entry. */
    readonly obs: Observable<TState>;
    /** The state as a signal: `get()` tracks {@link obs} as its dependency, `peek()` is a plain read. */
    readonly state$: ReadonlySignal<TState>;

    constructor(initialState: TState, options: ICacheEntryOptions<TState>) {
        this._state$ = new State<TState>(initialState, {
            key: options.devtoolsKey,
            beforeDevtoolsPush: options.beforeDevtoolsPush,
        });

        // The hooks run inside a consumer's subscribe / teardown, which may be
        // a tracking scope: whatever they read must not become that
        // consumer's dependency.
        this._retainer = new Retainer<TState>(this._state$.obs, {
            retentionTime: () => untracked(() => this._resolveRetentionTime(options.retentionTime)),
            key: options.devtoolsKey,
            onActive: () => untracked(() => this.onActive()),
            onMelting: () => untracked(() => this.onMelting()),
            onExpire: () => this.complete(),
        });
        this.obs = this._retainer.obs;

        // Hand-built rather than `SourceSignal.create` / `Signal.from`: both
        // `peek()` through a transient subscription, which here would be a
        // `0 → 1 → 0` hold cycle on every read. This record makes `get()`
        // register the holding stream as the dependency — the subscription
        // appears when the reading Computed / Effect is itself subscribed —
        // while `peek()` stays a direct read of the State.
        const depRecord: DependencyRecord = {
            getRang: () => 0,
            obs: this.obs,
            peek: () => this._state$.peek(),
        };
        const read = (): TState => {
            if (DependencyTracker.isTracking) {
                DependencyTracker.track(depRecord);
            }
            return this._state$.peek();
        };
        this.state$ = Object.assign(read, {
            obs: this.obs,
            get: read,
            peek: (): TState => this._state$.peek(),
        });
    }

    /**
     * Raw state stream without keepalive semantics: replays the current state on
     * subscribe and completes on {@link complete}. Unlike {@link obs}, subscribing
     * does not hold the entry, so retention GC is unaffected.
     */
    protected get rawObs(): Observable<TState> {
        return this._state$.obs;
    }

    /** Whether {@link complete} has been called — the state is disposed and reads throw. */
    get isCompleted(): boolean {
        return this._isCompleted;
    }

    /** Whether nobody holds the entry — it is in retention. */
    get isMelting(): boolean {
        return this._retainer.isMelting;
    }

    /**
     * Keep the entry `active` without subscribing to its state. Returns the
     * release; idempotent, and a no-op on a completed entry.
     */
    hold(): () => void {
        return this._retainer.hold();
    }

    /** Non-reactive read */
    peek(): TState {
        return this._state$.peek();
    }

    /** Update stored state (no-op if completed). `actionName` labels the change in devtools. */
    set(state: TState, actionName?: string): void {
        if (this._isCompleted) return;
        this._state$.set(state, actionName);
    }

    /** Fire onClean$ and mark completed. Subsequent set() calls are no-ops. */
    complete(): void {
        if (this._isCompleted) return;
        this._isCompleted = true;
        this._retainer.dispose();
        this.completed$.next();
        this.completed$.complete();
        // Completes every subscriber of `obs` / `rawObs`: waiters reject with
        // CacheEntryRemovedError.
        this._state$.dispose();
    }

    // ==================== Protected ====================

    /** Holds went `0 → 1`: the entry became `active`. Called before the first subscriber attaches. */
    protected onActive(): void {}

    /** Holds went `1 → 0`: the entry entered retention. Called before the policy runs. */
    protected onMelting(): void {}

    // ==================== Private ====================

    /**
     * The delay of one retention cycle, evaluated on the `active → retention`
     * transition against the entry's state as it stands then. A function
     * option may throw; the {@link Retainer} catches it.
     */
    private _resolveRetentionTime(retentionTime: ICacheEntryOptions<TState>["retentionTime"]): number | null {
        return normalizeRetentionTime(typeof retentionTime === "function" ? retentionTime(this.peek()) : retentionTime);
    }
}
