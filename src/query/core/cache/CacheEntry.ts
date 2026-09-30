import { Observable, Subject } from "rxjs";

import { MAX_TIMEOUT_DELAY } from "@/common/utils";
import type { ICacheEntry, ICacheEntryOptions } from "@/query/types";
import { type ReadonlySignal, type SignalOptionsOrKey } from "@/signals";
import { untracked } from "@/signals/base/untracked";
import { StateNode } from "@/signals/signals/State";

import { Retainer } from "./Retainer";

/**
 * The entry's state node: a computed or an effect that observes it holds the
 * entry, as a subscriber of {@link CacheEntry.obs} does.
 */
class HeldState<T> extends StateNode<T> {
    private _release: (() => void) | null = null;

    constructor(
        initialValue: T,
        options: SignalOptionsOrKey<T>,
        private readonly _hold: () => () => void,
    ) {
        super(initialValue, options);
    }

    override _onObserved(): void {
        this._release = this._hold();
    }

    override _onUnobserved(): void {
        const release = this._release;
        this._release = null;
        release?.();
    }
}

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
    private readonly _state$: StateNode<TState>;
    private readonly _retainer: Retainer<TState>;
    private _isCompleted = false;

    readonly completed$ = new Subject<void>();
    /** The state stream. Replays the current state on subscribe; subscribing holds the entry. */
    readonly obs: Observable<TState>;
    /** The state as a signal: an observed `get()` holds the entry, `peek()` is a plain read. */
    readonly state$: ReadonlySignal<TState>;

    constructor(initialState: TState, options: ICacheEntryOptions<TState>) {
        this._state$ = new HeldState<TState>(
            initialState,
            {
                key: options.devtoolsKey,
                beforeDevtoolsPush: options.beforeDevtoolsPush,
            },
            () => this._retainer.hold(),
        );

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

        // A tracked read links the state node: the hold appears when the
        // reading Computed / Effect is itself observed, and a cold read only
        // validates against it — no `0 → 1 → 0` hold cycle per read.
        const read = (): TState => this._state$.get();
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

    /**
     * @internal Hold the entry for whoever holds it next, for `maxMs` at most
     * (see `Retainer.handOver`). A no-op on a completed entry.
     */
    _handOver(maxMs: number): void {
        this._retainer.handOver(maxMs);
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
