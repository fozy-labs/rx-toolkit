import { SubscriptionLike } from "rxjs";
import { ReadableSignalLike } from "signal/base/types";
import { Signal } from "./Signal";
import { Effect } from "./Effect";

export class Computed<T> extends Signal<T> implements SubscriptionLike, ReadableSignalLike<T> {
    private static _EMPTY = Symbol('empty');
    private _effect: Effect;

    constructor(
        computeFn: () => T,
        doLog = false,
    ) {
        let initialValue: T | Symbol = Computed._EMPTY;

        const effect = new Effect(() => {
            if (initialValue === Computed._EMPTY) {
                initialValue = computeFn();
                return;
            }

            this.value = computeFn();
        }, doLog);

        super(initialValue as T);
        this._effect = effect;
    }

    unsubscribe() {
        this._effect.unsubscribe();
        super.unsubscribe();
    }

    public complete() {
        this._effect.unsubscribe();
        super.complete();
    }
}
