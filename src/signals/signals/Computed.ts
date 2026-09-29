import { distinctUntilChanged, finalize, map, Observable, ReplaySubject, share } from "rxjs";

import { DisposableSignal, normalizeSignalOptions, SignalOptionsOrKey } from "@/signals/types";

import { ComputeCache, DependencyRecord, DependencyTracker, SignalCycleError } from "../base";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";

import { Effect } from "./Effect";
import { State } from "./State";

/**
 * An error thrown by computeFn, kept as the state of a subscribed computed:
 * reads rethrow it until a dependency changes. Allocated only on failure.
 */
class ComputedFailure {
    constructor(readonly error: unknown) {}
}

export class Computed<T> {
    private _state$;
    /**
     * Engine channel for dependents (Effect / other computeds): a failure
     * travels as a value, so it never ends their subscriptions.
     */
    private readonly _node$: Observable<T | ComputedFailure>;
    /** Public stream: a failure is delivered as an RxJS `error`. */
    readonly obs: Observable<T>;
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
        type Stored = symbol | T | ComputedFailure;
        const stateOptions: SignalOptionsOrKey<Stored> = {
            key: opts.key,
            base: opts.base ?? Computed.name,
            isDisabled: opts.isDisabled,
            beforeDevtoolsPush: (value: Stored, push: (v: Stored) => void) => {
                if (value !== Computed._EMPTY && !(value instanceof ComputedFailure)) {
                    push(value);
                }
            },
        };

        this._state$ = State.create<Stored>(Computed._EMPTY, stateOptions);

        this._node$ = this._state$.obs.pipe(
            map((value) => {
                if (value === Computed._EMPTY) {
                    return this._start();
                }

                return value as T | ComputedFailure;
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

        this.obs = this._node$.pipe(map(Computed._unwrap));

        this._depRecord = {
            getRang: () => {
                if (!this._effect) {
                    throw new Error("Effect in not started. Possibly maximum call stack size exceeded.");
                }
                return this._effect!._getRang();
            },
            obs: this._node$,
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

        if (v instanceof ComputedFailure) throw v.error;

        return v as T;
    }

    private _start(): T | ComputedFailure {
        let initialValue: T | ComputedFailure | symbol = Computed._EMPTY;

        // Never throws: a failing computeFn becomes the state, so the effect
        // keeps the dependencies read before the throw and recomputes on them.
        this._effect = new Effect(() => {
            const next = this._computeOrFail();

            if (initialValue === Computed._EMPTY) initialValue = next;

            this._state$.set(next);
        });

        this._computeCache.clear();

        if (initialValue === Computed._EMPTY) {
            throw new Error("Computed value is not initialized");
        }

        return initialValue as T | ComputedFailure;
    }

    private _computeOrFail(): T | ComputedFailure {
        try {
            return this._compute();
        } catch (error) {
            // The same error again is no new state: dependents are not woken.
            const current = this._state$.peek();
            if (current instanceof ComputedFailure && Object.is(current.error, error)) return current;
            return new ComputedFailure(error);
        }
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

    private static _unwrap<T>(value: T | ComputedFailure): T {
        if (value instanceof ComputedFailure) throw value.error;
        return value;
    }

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
