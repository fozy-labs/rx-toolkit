import { BehaviorSubject } from "rxjs";
import { DevtoolsStateLike, StateDevtoolsOptions } from "@/common/devtools";
import { SignalFn } from "@/signals/types";
import { Batcher, DependencyTracker, Devtools } from "../base";

export class State<T> {
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
            base: State.name,
            ...(typeof options === 'string' ? { name: options } : options)
        });

        if (this._stateDevtools) {
            State._finalizationRegistry.register(this, this._stateDevtools);
        }
    }

    peek(): T {
        return this.bs$.getValue();
    }

    set(value: T) {
        if (value === this.bs$.value) {
            return;
        }

        Batcher.run(() => {
            this._stateDevtools?.(value);
            this.bs$.next(value);
        });
    }

    get() {
        DependencyTracker.track({
            getRang: () => this._rang,
            obs: this.obs,
            peek: () => this.peek(),
        });
        return this.bs$.getValue();
    }

    // === static ===

    private static _finalizationRegistry = new FinalizationRegistry((heldValue: DevtoolsStateLike) => {
        heldValue('$COMPLETED' as any);
    });

    static create<T>(initialValue: T, options?: StateDevtoolsOptions): SignalFn<T> {
        const ls = new State(initialValue, options);

        function signalFn() {
            return ls.get();
        }

        signalFn.peek = () => ls.peek();
        signalFn.set = (value: T) => ls.set(value);
        signalFn.get = () => ls.get();
        signalFn.obs = ls.obs;

        return signalFn;
    }
}
