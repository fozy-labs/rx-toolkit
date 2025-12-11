import { distinctUntilChanged, ReplaySubject, share, map, finalize } from "rxjs";
import { StateDevtoolsOptions } from "@/common/devtools";
import { LazyComputedFn } from "@/signals/types";
import { LazySignal } from "@/signals";
import { FastEffect } from "./FastEffect";

export class LazyComputed<T> {
    private static _EMPTY = Symbol('empty');

    private _ls;
    readonly obsv$;
    private _effect: FastEffect | null = null;

    get isStarted() {
        return this._ls.peek() !== LazyComputed._EMPTY;
    }

    constructor(
        private _computeFn: () => T,
        options?: StateDevtoolsOptions
    ) {
        const lsOptions = {
            base: LazyComputed.name,
            ...(typeof options === 'string' ? { name: options } : options)
        };

        this._ls = new LazySignal<symbol | T>(LazyComputed._EMPTY, lsOptions);

        this.obsv$ = this._ls.obsv$.pipe(
            map((value) => {
                if (value === LazyComputed._EMPTY) {
                    return this._start();
                }

                return value as T;
            }),
            distinctUntilChanged(),
            finalize(() => {
                this._stop();
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: true,
                resetOnComplete: true,
            }),
        );
    }

    private _start(): T {
        let initialValue: T | symbol = LazyComputed._EMPTY;

        this._effect = new FastEffect(() => {
            if (initialValue === LazyComputed._EMPTY) {
                initialValue = this._computeFn();
                return;
            }

            this._ls.set(this._computeFn());
            this._ls._setRang(this._effect!._getRang());
        });

        if (initialValue === LazyComputed._EMPTY) {
            throw new Error('Computed value is not initialized');
        }

        return initialValue as T;
    }

    private _stop() {
        if (this._effect) {
            this._effect.unsubscribe();
            this._effect = null;
        }

        this._ls.set(LazyComputed._EMPTY);
    }

    get() {
        const v = this._ls.get();

        if (v === LazyComputed._EMPTY) {
            return this._computeFn();
        }

        return v as T;
    }

    peek() {
        const v = this._ls.peek();

        if (v === LazyComputed._EMPTY) {
            return this._computeFn();
        }

        return v as T;
    }

    /** @deprecated use get() instead. */
    get value(): T {
        return this.get();
    }

    static create<T>(computeFn: () => T, options?: StateDevtoolsOptions): LazyComputedFn<T> {
        const lc = new LazyComputed(computeFn, options);

        function computedFn() {
            return lc.get();
        }

        computedFn.peek = () => lc.peek();
        computedFn.get = () => lc.get();
        computedFn.obsv$ = lc.obsv$;

        return computedFn as (LazyComputed<T> & (() => T));
    }
}
