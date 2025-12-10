import { StateDevtoolsOptions } from "@/common/devtools";
import { SubscriptionLike } from "rxjs";
import { ReadableSignalLike } from "../base";
import { Signal } from "./Signal";
import { Effect } from "./Effect";

export class Computed<T> extends Signal<T> implements SubscriptionLike, ReadableSignalLike<T> {
    private static _EMPTY = Symbol('empty');
    private _effect: Effect;
    private _computedDebugName: string;

    constructor(
        computeFn: () => T,
        options?: StateDevtoolsOptions
    ) {
        const debugName = typeof options === 'string' ? options : options?.name || 'unnamed';

        let initialValue: T | Symbol = Computed._EMPTY;

        const effect = new Effect(() => {
            if (initialValue === Computed._EMPTY) {
                initialValue = computeFn();
                return;
            }

            const newValue = computeFn();
            this.value = newValue;
            const effectRang = effect._getRang();
            this._rang = effectRang;
        });

        super(initialValue as T, {
            base: 'Computed',
            ...(typeof options === 'string' ? { name: options } : options)
        });

        this._computedDebugName = debugName;
        this._effect = effect;
    }

    complete() {
        if (this.closed) {
            return;
        }
        this._effect.unsubscribe();
        super.complete();
    }

    /**
     * @deprecated use 'complete()' instead
     */
    unsubscribe() {
        this.complete();
    }
}
