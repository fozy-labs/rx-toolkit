import { type Observable } from "rxjs";

import { type DisposableSignal, type SignalLifecycleHook } from "@/signals/types";

import { Devtools } from "../base";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";
import { ReceiverNode, type KeepAlive } from "../base/ReceiverNode";

export type { KeepAlive } from "../base/ReceiverNode";

const EMPTY = Symbol("EMPTY");

export interface SignalFromOptions<T> {
    /**
     * Value served while the source has not emitted (cold reads and
     * connected-but-silent reads). Presence is detected with the `in` operator,
     * so an explicit `undefined` is a valid default. Without a default such
     * reads throw `"No value emitted"`.
     */
    default?: T;
    /** @default "microtask" */
    keepAlive?: KeepAlive;
    /** DevTools key, as in `Signal.state` / `Signal.compute`. */
    key?: string;
}

/** The engine node behind a {@link FromSignal}: a receiver that reports to devtools. */
export class FromSignalNode<T> extends ReceiverNode<T> {
    private readonly _devtoolsHook: SignalLifecycleHook<T | symbol> | null;

    constructor(source: Observable<T>, options?: SignalFromOptions<T>) {
        super(
            source,
            options?.keepAlive ?? "microtask",
            options ? "default" in options : false,
            options?.default,
            options?.key,
        );
        this._devtoolsHook = Devtools.createSignalHooks<T | symbol>(EMPTY, {
            key: options?.key,
            base: FromSignal.name,
            beforeDevtoolsPush: (value, push) => {
                if (value !== EMPTY) {
                    push(value);
                }
            },
        });
    }

    protected override _onValue(value: T): void {
        this._devtoolsHook?.onChange?.(value);
    }

    override dispose() {
        const wasDisposed = this._isDisposedNode();
        super.dispose();
        if (!wasDisposed) this._devtoolsHook?.onDispose?.();
    }
}

/**
 * Read-only signal over an RxJS Observable. The upstream is subscribed once,
 * on the first observer or read, and released by `keepAlive` after the last
 * one; while subscribed, reads are served from the last emitted value.
 * `Signal.from` is its functional form.
 */
export class FromSignal<T> {
    private readonly _node: FromSignalNode<T>;
    readonly obs: Observable<T>;

    constructor(source: Observable<T>, options?: SignalFromOptions<T>) {
        this._node = new FromSignalNode(source, options);
        this.obs = this._node.obs;
    }

    get(): T {
        return this._node.get();
    }

    peek(): T {
        return this._node.peek();
    }

    /**
     * Freezes the last value, tears the upstream down and completes the
     * `.obs` subscribers. Later reads serve the frozen value (or the default).
     */
    dispose() {
        this._node.dispose();
    }

    [SYMBOL_DISPOSE]() {
        this.dispose();
    }

    // === static ===

    static create<T, D extends T | undefined>(
        source: Observable<T>,
        options: Omit<SignalFromOptions<T>, "default"> & { default: D },
    ): DisposableSignal<T | (undefined extends D ? undefined : never)>;
    static create<T>(source: Observable<T>, options?: SignalFromOptions<T>): DisposableSignal<T>;
    static create(source: Observable<unknown>, options?: SignalFromOptions<unknown>): DisposableSignal<unknown> {
        const fs = new FromSignalNode(source, options);

        function fromSignalFn() {
            return fs.get();
        }

        fromSignalFn.peek = () => fs.peek();
        fromSignalFn.get = () => fs.get();
        fromSignalFn.obs = fs.obs;
        const dispose = () => fs.dispose();
        fromSignalFn.dispose = dispose;
        fromSignalFn[SYMBOL_DISPOSE] = dispose;

        return fromSignalFn;
    }
}
