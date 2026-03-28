import { finalize, Observable, ReplaySubject, share, Subject, timer } from "rxjs";

import type { ICacheEntry, ICacheEntryOptions } from "@/query-v2/types";
import { Signal, signalize } from "@/signals";
import type { SignalFn, SignalOptions } from "@/signals/types";

/**
 * Internal reactive container wrapping a Signal.state<TState>.
 * Implements ICacheEntry<TState>.
 */
export class CacheEntry<TState> implements ICacheEntry<TState> {
    private _state$: SignalFn<TState>;
    private _isCompleted = false;
    private _cacheLifetime: number | false = 60_000;

    readonly onClean$ = new Subject<void>();
    readonly obs;
    readonly state$;

    constructor(initialState: TState, options?: ICacheEntryOptions<TState>) {
        const signalOpts: SignalOptions<TState> = {
            key: options?.keyParts?.join(":"),
        };
        if (options?.beforeDevtoolsPush) {
            signalOpts.beforeDevtoolsPush = options.beforeDevtoolsPush;
        }
        this._state$ = Signal.state<TState>(initialState, signalOpts);

        if (options?.cacheLifetime !== undefined) {
            this._cacheLifetime = options.cacheLifetime;
        }

        this.obs = this._state$.obs.pipe(
            finalize(() => {
                this.complete();
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: this._getResetOnRefCountZero(),
                resetOnComplete: true,
            }),
        );

        this.state$ = signalize(this.obs);
    }

    /** Non-reactive read */
    peek(): TState {
        return this._state$.peek();
    }

    /** Update stored state (no-op if completed) */
    set(state: TState): void {
        if (this._isCompleted) return;
        this._state$.set(state);
    }

    /** Fire onClean$ and mark completed. Subsequent set() calls are no-ops. */
    complete(): void {
        if (this._isCompleted) return;
        this._isCompleted = true;
        this.onClean$.next();
        this.onClean$.complete();
    }

    private _getResetOnRefCountZero(): boolean | (() => Observable<number>) {
        if (this._cacheLifetime === false) return false;
        if (this._cacheLifetime <= 0) return true;
        const lifetime = this._cacheLifetime;
        return () => timer(lifetime);
    }
}
