import { Subject } from "rxjs";

import type { TBeforeDevtoolsPushFn } from "@/query-v2/types/shared.types";
import { Signal } from "@/signals";
import type { SignalFn } from "@/signals";

import type { ICacheEntry } from "@/query-v2";

export interface CacheEntryOptions<TState> {
    keyParts?: string[];
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TState>;
}

/**
 * Cache entry wrapping a reactive signal over a state instance.
 * Represents a single cached query result with its full lifecycle (idle → pending → success/error).
 */
export class CacheEntry<TState> implements ICacheEntry<TState> {
    private readonly _signal: SignalFn<TState>;
    private readonly _onClean$ = new Subject<void>();
    private _completed = false;

    constructor(initialState: TState, options?: CacheEntryOptions<TState>) {
        this._signal = Signal.state<TState>(initialState, {
            key: options?.keyParts?.join("/"),
            beforeDevtoolsPush: options?.beforeDevtoolsPush,
        });
    }

    /** Reactive accessor for the current state — reading this registers a signal dependency. */
    get state$(): () => TState {
        return this._signal;
    }

    /** Non-reactive read of the current state (does not register a signal dependency). */
    peek(): TState {
        return this._signal.peek();
    }

    /** Transition to a new state. No-op if the entry has been completed. */
    set(state: TState): void {
        if (this._completed) return;
        this._signal.set(state);
    }

    get onClean$() {
        return {
            subscribe: (cb: () => void) => {
                const sub = this._onClean$.subscribe(cb);
                return { unsubscribe: () => sub.unsubscribe() };
            },
        };
    }

    /** Complete the entry. */
    complete(): void {
        if (this._completed) return;
        this._completed = true;
        this._onClean$.next();
        this._onClean$.complete();
    }
}
