import { finalize, NEVER, Observable, ReplaySubject, share, Subject, timer } from "rxjs";

import { MAX_TIMEOUT_DELAY } from "@/common/utils";
import type { ICacheEntry, ICacheEntryOptions } from "@/query/types";
import { SourceSignal, State } from "@/signals";

// ==================== Retention normalization ====================

/**
 * Delay a retention option value asks for; `null` — no timer at all.
 *
 * Total on purpose. The option's type is `number | false`, but the boundary it
 * comes across is not always typed — a JS caller, an `any`, or a policy that
 * forgets to return — and the two failure modes sit on opposite behaviours:
 * `timer(undefined)` evicts at once while `null` is this function's own "keep
 * it" answer. Anything that is not a real number is therefore read the same way
 * as `NaN`: meaningless, so evict rather than guess a lifetime.
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

/**
 * Internal reactive container wrapping a Signal.state<TState>.
 * Implements ICacheEntry<TState>.
 */
export class CacheEntry<TState> implements ICacheEntry<TState> {
    private _state$;
    private _isCompleted = false;

    readonly completed$ = new Subject<void>();
    readonly obs;
    readonly state$;

    constructor(initialState: TState, options: ICacheEntryOptions<TState>) {
        this._state$ = new State<TState>(initialState, {
            key: options?.devtoolsKey,
            beforeDevtoolsPush: options?.beforeDevtoolsPush,
        });

        this.obs = this._state$.obs.pipe(
            finalize(() => {
                this.complete();
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: this._getResetOnRefCountZero(options.retentionTime, options.devtoolsKey),
                resetOnComplete: true,
            }),
        );

        this.state$ = SourceSignal.create<TState>((destination) => this.obs.subscribe(destination));
    }

    /**
     * Raw state stream without keepalive semantics: replays the current state on
     * subscribe and completes on {@link complete}. Unlike {@link obs}, subscribing
     * does not hold the share's refcount, so retention GC is unaffected.
     */
    protected get rawObs(): Observable<TState> {
        return this._state$.obs;
    }

    /** Whether {@link complete} has been called — the state is disposed and reads throw. */
    get isCompleted(): boolean {
        return this._isCompleted;
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
        this.completed$.next();
        this.completed$.complete();
        this._state$.dispose();
    }

    /**
     * The share's `resetOnRefCountZero`: what decides, on the `active →
     * retention` transition, whether the entry is kept or torn down.
     *
     * A function option is evaluated per cycle, against the entry's state as it
     * stands then, inside the teardown of the last subscriber. Its throw must
     * never escape: `share` calls the factory from that teardown, so it would
     * surface as an `UnsubscriptionError` on the unsubscribing consumer. A
     * failed policy falls back to immediate eviction.
     */
    private _getResetOnRefCountZero(
        retentionTime: ICacheEntryOptions<TState>["retentionTime"],
        entryKey: string,
    ): boolean | (() => Observable<unknown>) {
        if (typeof retentionTime !== "function") {
            const delay = normalizeRetentionTime(retentionTime);
            if (delay === null) return false;
            return () => timer(delay);
        }

        return () => {
            let delay: number | null;
            try {
                delay = normalizeRetentionTime(retentionTime(this.peek()));
            } catch (error) {
                console.error(`[CacheEntry] retentionTime threw for entry "${entryKey}"`, error);
                return timer(0);
            }
            return delay === null ? NEVER : timer(delay);
        };
    }
}
