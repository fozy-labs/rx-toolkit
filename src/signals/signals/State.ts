import { BehaviorSubject } from "rxjs";

import { normalizeSignalOptions, SignalFn, SignalLifecycleHook, SignalOptionsOrKey } from "@/signals/types";

import { Batcher, DependencyTracker, Devtools } from "../base";

export class State<T> {
    private _hooks: SignalLifecycleHook<T>[] | null;
    private _rang = 0;
    protected readonly bs$;
    readonly obs;

    constructor(initialValue: T, options?: SignalOptionsOrKey<T>) {
        this.bs$ = new BehaviorSubject<T>(initialValue);
        this.obs = this.bs$.asObservable();

        const opts = normalizeSignalOptions(options);

        const hooks: SignalLifecycleHook<T>[] = [];

        const devtoolsHook = Devtools.createSignalHooks<T>(initialValue, {
            ...opts,
            base: opts.base ?? State.name,
        });
        if (devtoolsHook) hooks.push(devtoolsHook);
        if (opts.hooks) hooks.push(...opts.hooks);

        this._hooks = hooks.length > 0 ? hooks : null;

        if (this._hooks) {
            State._finalizationRegistry.register(this, this._hooks);
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
            if (this._hooks) {
                for (const hook of this._hooks) {
                    hook.onChange?.(value);
                }
            }
            this.bs$.next(value);
        });
    }

    update(updater: (value: T) => T) {
        this.set(updater(this.peek()));
    }

    get() {
        DependencyTracker.track({
            getRang: () => this._rang,
            obs: this.obs,
            peek: () => this.peek(),
        });
        return this.bs$.getValue();
    }

    complete() {
        this.bs$.complete();

        if (this._hooks) {
            for (const hook of this._hooks) {
                hook.onDispose?.();
            }

            this._hooks = null;
        }
    }

    // === static ===

    private static _finalizationRegistry = new FinalizationRegistry((hooks: SignalLifecycleHook<any>[]) => {
        for (const hook of hooks) {
            hook.onDispose?.();
        }
    });

    static create<T>(initialValue: T, options?: SignalOptionsOrKey<T>): SignalFn<T> {
        const ls = new State(initialValue, options);

        function signalFn() {
            return ls.get();
        }

        signalFn.peek = () => ls.peek();
        signalFn.set = (value: T) => ls.set(value);
        signalFn.update = (updater: (value: T) => T) => ls.update(updater);
        signalFn.get = () => ls.get();
        signalFn.obs = ls.obs;

        return signalFn;
    }
}
