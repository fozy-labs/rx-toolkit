import { distinctUntilChanged, finalize, map, ReplaySubject, share } from "rxjs";

import { ComputeFn, normalizeSignalOptions, SignalOptionsOrKey } from "@/signals/types";

import { ComputeCache, DependencyTracker } from "../base";

import { Effect } from "./Effect";
import { State } from "./State";

export class Computed<T> {
    private _state$;
    readonly obs;
    private _effect: Effect | null = null;
    /**
     * Кеш для хранения вычисленного значения (без подписки) и его зависимостей
     */
    private _computeCache = new ComputeCache<T>();

    constructor(
        private _computeFn: () => T,
        options?: SignalOptionsOrKey<T>,
    ) {
        const opts = normalizeSignalOptions(options);
        const stateOptions: SignalOptionsOrKey<symbol | T> = {
            key: opts.key,
            name: opts.name,
            base: opts.base ?? Computed.name,
            isDisabled: opts.isDisabled,
            beforeDevtoolsPush: (value: symbol | T, push: (v: symbol | T) => void) => {
                if (value !== Computed._EMPTY) {
                    push(value);
                }
            },
        };

        this._state$ = State.create<symbol | T>(Computed._EMPTY, stateOptions);

        this.obs = this._state$.obs.pipe(
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
                    throw new Error("Effect in not started. Possibly maximum call stack size exceeded.");
                }
                return this._effect!._getRang();
            },
            obs: this.obs,
            peek: () => this.peek(),
        });

        return this.peek();
    }

    peek() {
        const v = this._state$.peek();

        if (v === Computed._EMPTY) {
            // Используем кеш для вычисления без создания подписки
            return this._computeCache.getOrCompute(this._computeFn);
        }

        return v as T;
    }

    private _start(): T {
        let initialValue: T | symbol = Computed._EMPTY;

        this._effect = new Effect(() => {
            if (initialValue === Computed._EMPTY) {
                initialValue = this._computeFn();
                this._state$.set(initialValue);
                return;
            }

            this._state$.set(this._computeFn());
        });

        this._computeCache.clear();

        if (initialValue === Computed._EMPTY) {
            throw new Error("Computed value is not initialized");
        }

        return initialValue as T;
    }

    private _stop() {
        if (this._effect) {
            this._effect.unsubscribe();
            this._effect = null;
        }

        this._state$.set(Computed._EMPTY);
    }

    // === static ===

    private static _EMPTY = Symbol("empty");

    static create<T>(computeFn: () => T, options?: SignalOptionsOrKey<T>): ComputeFn<T> {
        const lc = new Computed(computeFn, options);

        function computedFn() {
            return lc.get();
        }

        computedFn.peek = () => lc.peek();
        computedFn.get = () => lc.get();
        computedFn.obs = lc.obs;

        return computedFn;
    }
}
