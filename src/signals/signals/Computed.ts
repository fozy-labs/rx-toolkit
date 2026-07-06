import { Observable, ReplaySubject, share } from "rxjs";

import { DisposableSignal, normalizeSignalOptions, SignalOptionsOrKey } from "@/signals/types";

import { ComputeCache, DependencyRecord, DependencyTracker } from "../base";
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

    constructor(
        private _computeFn: () => T,
        options?: SignalOptionsOrKey<T>,
    ) {
        const opts = normalizeSignalOptions(options);
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

        this.obs = new Observable<T>((subscriber) => {
            // Ленивый bootstrap: сначала создаём ведущий Effect (он вычисляет
            // начальное значение и пишет его в _state$), и только ПОТОМ подписываемся
            // на _state$.obs. На момент записи начального значения подписчиков у
            // _state$ ещё нет, поэтому запись не реэнтрится — значение доставляется
            // ровно один раз через replay BehaviorSubject ниже. Это устраняет
            // двойную эмиссию на bootstrap, ради подавления которой раньше
            // требовался distinctUntilChanged(). В установившемся режиме State.set
            // уже дедуплицирует по Object.is, так что distinctUntilChanged() был
            // избыточен на каждой эмиссии.
            this._start();

            const inner = this._state$.obs.subscribe({
                next: (value) => {
                    if (value !== Computed._EMPTY) {
                        subscriber.next(value as T);
                    }
                },
                error: (error) => subscriber.error(error),
                complete: () => subscriber.complete(),
            });

            return () => {
                inner.unsubscribe();
                this._stop();
            };
        }).pipe(
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
        if (DependencyTracker.isTracking) {
            DependencyTracker.track(this._depRecord);
        }

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
