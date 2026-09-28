import { distinctUntilChanged, finalize, map, ReplaySubject, share } from "rxjs";

import { DisposableSignal, normalizeSignalOptions, SignalOptionsOrKey } from "@/signals/types";

import { ComputeCache, DependencyRecord, DependencyTracker, SignalCycleError } from "../base";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";

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
    // Стабильный record на инстанс (см. State): переиспользуется на каждом get()
    // вместо аллокации нового объекта с замыканиями.
    private readonly _depRecord: DependencyRecord;
    private readonly _label: string;
    private _isComputing = false;

    constructor(
        private _computeFn: () => T,
        options?: SignalOptionsOrKey<T>,
    ) {
        const opts = normalizeSignalOptions(options);
        this._label = opts.key ?? "<anonymous>";
        const stateOptions: SignalOptionsOrKey<symbol | T> = {
            key: opts.key,
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
            // Object.is (not the default ===): collapses the structural duplicate
            // initial emit for NaN, and lets a real +0 -> -0 change through —
            // consistent with State.set / ComputeCache dedupe across the engine.
            distinctUntilChanged((a, b) => Object.is(a, b)),
            finalize(() => {
                this._stop();
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: true,
                resetOnComplete: true,
            }),
        );

        this._depRecord = {
            getRang: () => {
                if (!this._effect) {
                    throw new Error("Effect in not started. Possibly maximum call stack size exceeded.");
                }
                return this._effect!._getRang();
            },
            obs: this.obs,
            peek: () => this.peek(),
        };
    }

    get() {
        // Before track(): tracking a computed that is still being computed
        // would subscribe to a half-built node.
        this._assertNotComputing();

        if (DependencyTracker.isTracking) {
            DependencyTracker.track(this._depRecord);
        }

        return this.peek();
    }

    peek() {
        this._assertNotComputing();

        const v = this._state$.peek();

        if (v === Computed._EMPTY) {
            // Используем кеш для вычисления без создания подписки
            return this._computeCache.getOrCompute(this._compute);
        }

        return v as T;
    }

    private _start(): T {
        let initialValue: T | symbol = Computed._EMPTY;

        this._effect = new Effect(() => {
            if (initialValue === Computed._EMPTY) {
                initialValue = this._compute();
                this._state$.set(initialValue);
                return;
            }

            this._state$.set(this._compute());
        });

        this._computeCache.clear();

        if (initialValue === Computed._EMPTY) {
            throw new Error("Computed value is not initialized");
        }

        return initialValue as T;
    }

    // Every run of computeFn goes through here, subscribed or not, so a read of
    // this computed from inside its own computeFn — directly or through other
    // computeds — is caught on every path instead of overflowing the stack.
    private readonly _compute = (): T => {
        this._isComputing = true;
        Computed._computing.push(this);
        try {
            return this._computeFn();
        } finally {
            Computed._computing.pop();
            this._isComputing = false;
        }
    };

    private _assertNotComputing() {
        if (!this._isComputing) return;

        const stack = Computed._computing;
        const chain = stack.slice(stack.indexOf(this)).map((computed) => computed._label);
        chain.push(this._label);

        throw new SignalCycleError(chain);
    }

    private _stop() {
        if (this._effect) {
            this._effect.unsubscribe();
            this._effect = null;
        }

        this._state$.set(Computed._EMPTY);
    }

    dispose() {
        this._stop();
        this._computeCache.clear();
        this._state$.dispose();
    }

    [SYMBOL_DISPOSE]() {
        this.dispose();
    }

    // === static ===

    private static _EMPTY = Symbol("empty");

    /** Computeds whose computeFn is running right now, outermost first. */
    private static _computing: Computed<unknown>[] = [];

    static create<T>(computeFn: () => T, options?: SignalOptionsOrKey<T>): DisposableSignal<T> {
        const lc = new Computed(computeFn, options);

        function computedFn() {
            return lc.get();
        }

        computedFn.peek = () => lc.peek();
        computedFn.get = () => lc.get();
        computedFn.obs = lc.obs;
        const dispose = () => lc.dispose();
        computedFn.dispose = dispose;
        computedFn[SYMBOL_DISPOSE] = dispose;

        return computedFn;
    }
}
