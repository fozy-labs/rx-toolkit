import { finalize, Observable, ReplaySubject, share, Subject, timer } from "rxjs";

import type { ICacheEntry, ICacheEntryOptions } from "@/query/types";
import { Signal, signalize } from "@/signals";

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
        this._state$ = new Signal<TState>(initialState, {
            key: options?.devtoolsKey,
            beforeDevtoolsPush: options?.beforeDevtoolsPush,
        });

        this.obs = this._state$.obs.pipe(
            finalize(() => {
                this.complete();
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: this._getResetOnRefCountZero(options.retentionTime),
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
        this.completed$.next();
        this.completed$.complete();
        this._state$.complete();
    }

    private _getResetOnRefCountZero(retentionTime: number | false): boolean | (() => Observable<number>) {
        if (retentionTime === false) return false;
        if (retentionTime <= 0) return true;
        const lifetime = retentionTime;
        return () => timer(lifetime);
    }
}
