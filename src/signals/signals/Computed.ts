import type { Observable } from "rxjs";

import { DisposableSignal, normalizeSignalOptions, SignalComputeOptions } from "@/signals/types";

import { Devtools, type TDevtoolsStateUpdater } from "../base";
import { ComputedNode, HAS_ERROR, REPORTS_STATE, TRACKING } from "../base/core";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";

/** Devtools placeholder before the first value: never pushed. */
const EMPTY = Symbol("empty");

/** Devtools entries of computeds collected by GC before `dispose()`: completed then. */
const finalizationRegistry = new FinalizationRegistry((devtools: TDevtoolsStateUpdater<any>) => {
    devtools.complete();
});

/** The engine node behind a {@link Computed}: a computed node that reports to devtools. */
export class ComputedSignalNode<T> extends ComputedNode<T> {
    private readonly _devtools: TDevtoolsStateUpdater<T | typeof EMPTY> | null;

    constructor(computeFn: () => T, options?: SignalComputeOptions<T> | string) {
        const opts: SignalComputeOptions<T> = normalizeSignalOptions(options);
        super(computeFn, opts.equals, opts.key ?? "<anonymous>");
        this._devtools = Devtools.createState<T | typeof EMPTY>(EMPTY, {
            key: opts.key,
            base: opts.base ?? Computed.name,
            isDisabled: opts.isDisabled,
            beforeDevtoolsPush: (value, push) => {
                if (value !== EMPTY) push(value);
            },
        });
        if (this._devtools) {
            this._flags |= REPORTS_STATE;
            finalizationRegistry.register(this, this._devtools, this);
        }
    }

    override _onNewState(): void {
        const devtools = this._devtools;
        if (devtools === null) return;
        // Pushed while observed, as the state of a live node; errors are not values.
        if ((this._flags & (TRACKING | HAS_ERROR)) === TRACKING) devtools(this._value as T);
    }

    dispose() {
        this._disposeNode();
        if (this._devtools) {
            finalizationRegistry.unregister(this);
            this._devtools.complete();
        }
    }
}

/**
 * A lazy value derived from the signals `computeFn` reads. Observed (by an
 * effect, an `.obs` subscriber or an observed computed) it stays linked to
 * its sources and recomputes when one of them changed and it is read;
 * unobserved it is validated on read by the versions of its sources.
 * `Signal.compute` is its functional form.
 */
export class Computed<T> {
    private readonly _node: ComputedSignalNode<T>;
    readonly obs: Observable<T>;

    constructor(computeFn: () => T, options?: SignalComputeOptions<T> | string) {
        this._node = new ComputedSignalNode(computeFn, options);
        this.obs = this._node.obs;
    }

    get(): T {
        return this._node.get();
    }

    peek(): T {
        return this._node.peek();
    }

    dispose() {
        this._node.dispose();
    }

    [SYMBOL_DISPOSE]() {
        this.dispose();
    }

    // === static ===

    static create<T>(computeFn: () => T, options?: SignalComputeOptions<T> | string): DisposableSignal<T> {
        const lc = new ComputedSignalNode(computeFn, options);

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
