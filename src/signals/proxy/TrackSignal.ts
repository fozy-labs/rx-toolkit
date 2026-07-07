import { Observable } from "rxjs";

import { DependencyRecord, DependencyTracker } from "@/signals/base";
import { State } from "@/signals/signals/State";

/**
 * A source signal for a single node of the proxy tree, wrapping {@link State}
 * to inherit its proven `Object.is` dedupe, batched emission and (disabled)
 * devtools plumbing, and adding one thing {@link State} does not expose: an
 * observer count with an "went cold" callback.
 *
 * That callback is how the tree garbage-collects itself. Node signals are
 * created lazily on first reactive read and disposed once the last observer
 * (effect / computed / `obs` subscriber) drops — so a churning key space (e.g. a
 * cache) does not accumulate dead signals.
 *
 * Node signals are always leaf sources in the dependency graph, so `getRang`
 * is a constant `0`, exactly like {@link State}.
 */
export class TrackSignal<T> {
    private readonly _state: State<T>;
    private _observerCount = 0;
    private readonly _obs: Observable<T>;
    private readonly _dep: DependencyRecord;

    constructor(
        initialValue: T,
        private readonly _onWentCold: () => void,
    ) {
        // isDisabled keeps the (potentially very many) node signals out of
        // devtools and the FinalizationRegistry — they are internal machinery.
        this._state = new State<T>(initialValue, { isDisabled: true });

        this._obs = new Observable<T>((subscriber) => {
            this._observerCount += 1;
            const inner = this._state.obs.subscribe(subscriber);
            return () => {
                inner.unsubscribe();
                this._observerCount -= 1;
                if (this._observerCount === 0) {
                    this._onWentCold();
                }
            };
        });

        // Dependency record points at the ref-counting wrapper (not the raw
        // State.obs) so effect subscribe/unsubscribe drives the observer count.
        this._dep = {
            getRang: () => 0,
            obs: this._obs,
            peek: () => this._state.peek(),
        };
    }

    /** Whether at least one observer is currently subscribed. */
    get observed(): boolean {
        return this._observerCount > 0;
    }

    get obs(): Observable<T> {
        return this._obs;
    }

    /** Register this signal as a dependency of the active tracking context. */
    track(): void {
        DependencyTracker.track(this._dep);
    }

    peek(): T {
        return this._state.peek();
    }

    set(value: T): void {
        this._state.set(value);
    }

    dispose(): void {
        this._state.dispose();
    }
}
