import { SubscriptionLike } from "rxjs";
import { ReadableSignalLike } from "./types";
import { Signal } from "./Signal";
import { Effect } from "./Effect";

export class Computed<T> extends Signal<T> implements SubscriptionLike, ReadableSignalLike<T> {
    private static _EMPTY = Symbol('empty');
    private _effect: Effect;

    constructor(
        computeFn: () => T,
        options?: { disableDevtools?: boolean, devtoolsName?: string }
    ) {
        let initialValue: T | Symbol = Computed._EMPTY;

        const effect = new Effect(() => {
            if (initialValue === Computed._EMPTY) {
                initialValue = computeFn();
                return;
            }

            this._rang = effect._rang;
            this.value = computeFn();
        });

        super(initialValue as T, {
            devtoolsName: 'Computed',
            ...options,
        });
        this._effect = effect;
    }

    unsubscribe() {
        this.complete();
    }

    complete() {
        this._effect.unsubscribe();
        super.complete();
    }
}
