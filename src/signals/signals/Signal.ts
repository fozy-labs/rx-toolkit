import { BehaviorSubject } from "rxjs";
import { DevtoolsStateLike, StateDevtoolsOptions } from "@/common/devtools";
import { SignalFn } from "@/signals/types";
import { Computed, Effect } from "@/signals";
import { Batcher, DependencyTracker, Devtools } from "../base";

export class Signal<T> {
    private readonly _stateDevtools;
    private _rang = 0;
    protected readonly bs$;
    readonly obs;

    constructor(
        initialValue: T,
        options?: StateDevtoolsOptions,
    ) {
        this.bs$ = new BehaviorSubject<T>(initialValue);
        this.obs = this.bs$.asObservable();

        this._stateDevtools = Devtools.createState(initialValue, {
            base: Signal.name,
            ...(typeof options === 'string' ? { name: options } : options)
        });

        if (this._stateDevtools) {
            Signal._finalizationRegistry.register(this, this._stateDevtools);
        }
    }

    peek(): T {
        return this.bs$.getValue();
    }

    set(value: T) {
        return this._onChange(value);
    }

    get() {
        DependencyTracker.track({
            getRang: () => this._rang,
            obs: this.obs,
        });
        return this.bs$.getValue();
    }

    protected _onChange(value: T): void {
        Batcher.run(() => {
            this._stateDevtools?.(value);
            this.bs$.next(value);
        });
    }

    // === static ===

    private static _finalizationRegistry = new FinalizationRegistry((heldValue: DevtoolsStateLike) => {
        heldValue('$COMPLETED' as any);
    });

    static create<T>(initialValue: T, options?: StateDevtoolsOptions): SignalFn<T> {
        const ls = new Signal(initialValue, options);

        function signalFn() {
            return ls.get();
        }

        signalFn.peek = () => ls.peek();
        signalFn.set = (value: T) => ls.set(value);
        signalFn.get = () => ls.get();
        signalFn.obs = ls.obs;

        return signalFn;
    }

    static compute<T>(computeFn: () => T, options?: StateDevtoolsOptions) {
        return Computed.create(computeFn, options);
    }

    static effect(effectFn: () => void) {
        return Effect.create(effectFn);
    }
}
