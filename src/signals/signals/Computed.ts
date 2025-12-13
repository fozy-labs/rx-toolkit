import { distinctUntilChanged, ReplaySubject, share, map, finalize } from "rxjs";
import { StateDevtoolsOptions } from "@/common/devtools";
import { ComputedFn } from "@/signals/types";
import { DependencyTracker, Signal } from "@/signals";
import { Effect } from "./Effect";

export class Computed<T> {
    private _ls;
    readonly obsv$;
    private _effect: Effect | null = null;

    constructor(
        private _computeFn: () => T,
        private options?: StateDevtoolsOptions
    ) {
        const lsOptions: StateDevtoolsOptions = {
            base: Computed.name,
            ...(typeof options === 'string' ? { name: options } : options),
            _skipValues: [Computed._EMPTY],
        };

        this._ls = new Signal<symbol | T>(Computed._EMPTY, lsOptions);

        this.obsv$ = this._ls.obsv$.pipe(
            map((value) => {
                if (value === Computed._EMPTY) {
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

    get() {
        DependencyTracker.track({
            getRang: () => {
                if (!this._effect) {
                    throw new Error('Effect in not started. Possibly maximum call stack size exceeded.');
                }
                return this._effect!._getRang();
            },
            obsv$: this.obsv$,
        });

        const v = this._ls.peek();

        if (v === Computed._EMPTY) {
            return this._computeFn();
        }

        return v as T;
    }

    peek() {
        const v = this._ls.peek();

        if (v === Computed._EMPTY) {
            return this._computeFn();
        }

        return v as T;
    }

    private _start(): T {
        let initialValue: T | symbol = Computed._EMPTY;

        this._effect = new Effect(() => {
            if (initialValue === Computed._EMPTY) {
                initialValue = this._computeFn();
                this._ls.set(initialValue);
                return;
            }

            this._ls.set(this._computeFn());
        });

        if (initialValue === Computed._EMPTY) {
            throw new Error('Computed value is not initialized');
        }

        return initialValue as T;
    }

    private _stop() {
        if (this._effect) {
            this._effect.unsubscribe();
            this._effect = null;
        }

        this._ls.set(Computed._EMPTY);
    }

    // === static ===

    private static _EMPTY = Symbol('empty');

    static create<T>(computeFn: () => T, options?: StateDevtoolsOptions): ComputedFn<T> {
        const lc = new Computed(computeFn, options);

        function computedFn() {
            return lc.get();
        }

        computedFn.peek = () => lc.peek();
        computedFn.get = () => lc.get();
        computedFn.obsv$ = lc.obsv$;

        return computedFn as (Computed<T> & (() => T));
    }
}
