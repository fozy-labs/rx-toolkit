import type { Observable, Subscriber, TeardownLogic } from "rxjs";

import {
    normalizeSignalOptions,
    type SignalLifecycleHook,
    type SignalOptionsOrKey,
    type StateSignal,
} from "@/signals/types";

import { Devtools } from "../base";
import { bumpVersion, NodeObservable, SourceNode, type ObsSource } from "../base/core";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";

/**
 * The engine node behind a {@link State}. Internal code that needs the
 * engine's hooks (a cache entry's hold) extends it; the rest uses `State`.
 */
export class StateNode<T> extends SourceNode<T> implements ObsSource<T> {
    private _hooks: SignalLifecycleHook<T>[] | null;
    private _isDisposed = false;
    private _obs: Observable<T> | null = null;

    constructor(initialValue: T, options?: SignalOptionsOrKey<T>) {
        super(initialValue);

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
            StateNode._finalizationRegistry.register(this, this._hooks, this);
        }
    }

    get obs(): Observable<T> {
        return (this._obs ??= new NodeObservable<T>(this));
    }

    _subscribeObs(subscriber: Subscriber<T>): TeardownLogic {
        return this._watchImmediate(subscriber, this._isDisposed);
    }

    set(value: T, actionName?: string) {
        if (Object.is(value, this._value)) {
            return;
        }
        if (this._isDisposed) {
            // A disposed state has no subscribers left: the value changes, nobody is told.
            this._value = value;
            bumpVersion(this);
            return;
        }

        const hooks = this._hooks;
        if (hooks === null) {
            this._write(value);
            return;
        }
        this._write(value, () => {
            for (const hook of hooks) {
                hook.onChange?.(value, actionName);
            }
        });
    }

    update(updater: (value: T) => T, actionName?: string) {
        this.set(updater(this.peek()), actionName);
    }

    dispose() {
        this._isDisposed = true;
        this._completeRecs();

        if (this._hooks) {
            StateNode._finalizationRegistry.unregister(this);

            for (const hook of this._hooks) {
                hook.onDispose?.();
            }

            this._hooks = null;
        }
    }

    // === static ===

    /** Hooks of a state collected by GC before `dispose()`: their `onDispose` runs then. */
    private static _finalizationRegistry = new FinalizationRegistry((hooks: SignalLifecycleHook[]) => {
        for (const hook of hooks) {
            hook.onDispose?.();
        }
    });
}

/** A writable signal; `Signal.state` is its functional form. */
export class State<T> {
    private readonly _node: StateNode<T>;
    /**
     * The value stream: the current value on subscribe, then every write at
     * the moment it happens — also inside `Batcher.run`. Completes on `dispose()`.
     */
    readonly obs: Observable<T>;

    constructor(initialValue: T, options?: SignalOptionsOrKey<T>) {
        this._node = new StateNode(initialValue, options);
        this.obs = this._node.obs;
    }

    peek(): T {
        return this._node.peek();
    }

    set(value: T, actionName?: string) {
        this._node.set(value, actionName);
    }

    update(updater: (value: T) => T, actionName?: string) {
        this._node.update(updater, actionName);
    }

    get(): T {
        return this._node.get();
    }

    dispose() {
        this._node.dispose();
    }

    [SYMBOL_DISPOSE]() {
        this.dispose();
    }

    // === static ===

    static create<T>(initialValue: T, options?: SignalOptionsOrKey<T>): StateSignal<T> {
        const ls = new StateNode(initialValue, options);

        function signalFn() {
            return ls.get();
        }

        signalFn.peek = () => ls.peek();
        signalFn.set = (value: T, actionName?: string) => ls.set(value, actionName);
        signalFn.update = (updater: (value: T) => T, actionName?: string) => ls.update(updater, actionName);
        signalFn.get = () => ls.get();
        signalFn.obs = ls.obs;
        const dispose = () => ls.dispose();
        signalFn.dispose = dispose;
        signalFn[SYMBOL_DISPOSE] = dispose;

        return signalFn;
    }
}
