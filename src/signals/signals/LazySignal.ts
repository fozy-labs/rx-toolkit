import { BehaviorSubject } from "rxjs";
import { DevtoolsStateLike, StateDevtoolsOptions } from "@/common/devtools";
import { LazySignalFn } from "@/signals/types";
import { Batcher, DependencyTracker, Devtools } from "../base";

export class LazySignal<T> {
    private readonly _stateDevtools;
    private _rang = 0;
    protected readonly bs$;
    readonly obsv$;

    get closed() {
        return this.bs$.closed;
    }

    constructor(initialValue: T, options?: StateDevtoolsOptions) {
        this.bs$ = new BehaviorSubject<T>(initialValue);
        this.obsv$ = this.bs$.asObservable();

        this._stateDevtools = Devtools.createState(initialValue, {
            base: LazySignal.name,
            ...(typeof options === 'string' ? { name: options } : options)
        });

        if (this._stateDevtools) {
            LazySignal._finalizationRegistry.register(this, this._stateDevtools);
        }
    }

    peek(): T {
        return this.bs$.value;
    }

    set(value: T) {
        return this._onChange(value);
    }

    get() {
        DependencyTracker.track({
            rang: this._rang,
            obsv$: this.obsv$,
        });
        return this.bs$.value;
    }

    _getRang(): number {
        return this._rang;
    }

    _setRang(rang: number): void {
        this._rang = rang;
    }

    /**
     * @deprecated use `peek()` or get() instead.
     */
    get value(): T {
        return this.get();
    }

    /**
     * @deprecated use `peek()` or get() instead.
     */
    getValue(): T {
        return this.bs$.getValue();
    }

    /**
     * @deprecated use `set(value)` instead.
     */
    set value(value: T) {
        this._onChange(value);
    }

    /**
     * @deprecated use `set(value)` instead.
     */
    next(value: T): void {
        this._onChange(value);
    }

    protected _onChange(value: T): void {
        Batcher.batch(() => {
            this._stateDevtools?.(value);
            this.bs$.next(value);
        });
    }

    private static _finalizationRegistry = new FinalizationRegistry((heldValue: DevtoolsStateLike) => {
        heldValue('$COMPLETED' as any);
    });

    static create<T>(initialValue: T, options?: StateDevtoolsOptions): LazySignalFn<T> {
        const ls = new LazySignal(initialValue, options);

        function signalFn() {
            return ls.get();
        }

        signalFn.peek = () => ls.peek();
        signalFn.set = (value: T) => ls.set(value);
        signalFn.get = () => ls.get();
        signalFn.obsv$ = ls.obsv$;
        signalFn._setRang = (rang: number) => ls._setRang(rang);

        return signalFn as (LazySignal<T> & (() => T));
    }
}
