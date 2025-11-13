import { SubscriptionLike } from "rxjs";
import { ReadableSignalLike } from "../base";
import { Signal } from "./Signal";
import { Effect } from "./Effect";
import { StateDevtoolsOptions } from "@/common/devtools";

export class Computed<T> extends Signal<T> implements SubscriptionLike, ReadableSignalLike<T> {
    private static _EMPTY = Symbol('empty');
    private _effect: Effect;

    constructor(
        computeFn: () => T,
        options?: StateDevtoolsOptions
    ) {
        let initialValue: T | Symbol = Computed._EMPTY;

        const effect = new Effect(() => {
            if (initialValue === Computed._EMPTY) {
                initialValue = computeFn();
                return;
            }

            this._rang = effect._rang;
            this.value = computeFn();
        }, () => {
            this.complete();
        });

        super(initialValue as T, {
            base: 'Computed',
            ...(typeof options === 'string' ? { name: options } : options)
        });
        this._effect = effect;
    }

    complete() {
        if (this.closed) return;
        this._effect.complete();
        super.complete();
    }

    /**
     * @deprecated use 'complete()' instead
     */
    unsubscribe() {
        this.complete();
    }
}
