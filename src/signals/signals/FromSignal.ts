import { distinctUntilChanged, Observable, of, race, ReplaySubject, share, takeUntil, tap, timer } from "rxjs";

import { type DisposableSignal, type SignalLifecycleHook } from "@/signals/types";

import { DependencyRecord, DependencyTracker, Devtools } from "../base";
import { SYMBOL_DISPOSE } from "../base/disposeSymbol";

const EMPTY = Symbol("EMPTY");

/**
 * How long the upstream subscription (and the cached value) survives after the
 * last consumer — a `.obs` subscriber or a pull read — is gone:
 *
 * - `"none"` — no retention: every read subscribes and immediately tears down
 *   (the legacy `signalize` behavior);
 * - `"microtask"` — until the current microtask queue drains: reads within one
 *   synchronous burst share a single upstream subscription;
 * - `"task"` — until the next macrotask;
 * - `"forever"` — from the first touch until `dispose()`;
 * - a `number` — a grace window in milliseconds, renewed by every consumer.
 */
export type KeepAlive = "none" | "microtask" | "task" | "forever" | number;

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

/**
 * Read-only signal over an RxJS Observable with a shared, keepAlive-managed
 * upstream subscription. While the subscription is hot, reads are served from
 * the replay cache; when the keepAlive window expires, the upstream is torn
 * down and the cache is dropped (the next read restarts the source cold).
 */
export class FromSignal<T> {
    readonly obs: Observable<T>;

    private readonly _shared: Observable<T>;
    // ReplaySubject(1): reset notifiers subscribed after dispose (e.g. the
    // resetOnComplete notifier triggered by the teardown itself) must still see
    // the destroy event and short-circuit immediately.
    private readonly _destroyed$ = new ReplaySubject<void>(1);
    private readonly _keepAlive: KeepAlive;
    private readonly _hasDefault: boolean;
    private readonly _defaultValue: T | undefined;
    private readonly _devtoolsHook: SignalLifecycleHook<T | symbol> | null;
    // Stable record per instance (see State): reused on every get() instead of
    // allocating a fresh object with closures per read.
    private readonly _depRecord: DependencyRecord;

    // True while a share cycle (connector subject + upstream connection, or a
    // terminal subject still replaying) is alive, i.e. while reading _shared is
    // guaranteed to be side-effect-free. Cleared by grace expiry and errors.
    private _cycleAlive = false;
    private _disposed = false;
    private _frozenValue: T | typeof EMPTY = EMPTY;

    constructor(source: Observable<T>, options?: SignalFromOptions<T>) {
        this._keepAlive = options?.keepAlive ?? "microtask";
        this._hasDefault = options ? "default" in options : false;
        this._defaultValue = options?.default;

        this._devtoolsHook = Devtools.createSignalHooks<T | symbol>(EMPTY, {
            key: options?.key,
            base: FromSignal.name,
            beforeDevtoolsPush: (value, push) => {
                if (value !== EMPTY) {
                    push(value);
                }
            },
        });

        const resetPolicy = this._keepAlive === "forever" ? false : () => this._createGraceNotifier();

        this._shared = source.pipe(
            takeUntil(this._destroyed$),
            // Object.is — consistent with State.set / ComputeCache dedupe across
            // the engine: identical consecutive values must not wake watchers.
            distinctUntilChanged((a, b) => Object.is(a, b)),
            share({
                connector: () => this._createCycle(),
                resetOnError: true,
                resetOnComplete: resetPolicy,
                resetOnRefCountZero: resetPolicy,
            }),
        );

        this.obs = new Observable<T>((subscriber) => {
            if (this._disposed) {
                subscriber.complete();
                return;
            }
            return this._shared.subscribe(subscriber);
        });

        this._depRecord = {
            getRang: () => 0,
            obs: this.obs,
            peek: () => this.peek(),
        };
    }

    get(): T {
        if (DependencyTracker.isTracking) {
            DependencyTracker.track(this._depRecord);
        }
        return this.peek();
    }

    peek(): T {
        if (this._disposed) {
            if (this._frozenValue !== EMPTY) {
                return this._frozenValue as T;
            }
            return this._defaultOrThrow();
        }

        const { value, error } = this._captureSync();

        if (error !== EMPTY) {
            throw error;
        }
        if (value === EMPTY) {
            return this._defaultOrThrow();
        }
        return value as T;
    }

    dispose() {
        if (this._disposed) return;

        // Snapshot BEFORE teardown: while a cycle is alive the shared replay is
        // side-effect-free to read; afterwards it would reconnect the source.
        if (this._cycleAlive) {
            const { value } = this._captureSync();
            if (value !== EMPTY) {
                this._frozenValue = value as T;
            }
        }

        this._disposed = true;
        this._destroyed$.next();
        this._devtoolsHook?.onDispose?.();
    }

    [SYMBOL_DISPOSE]() {
        this.dispose();
    }

    /** Subscribes to the shared stream, captures a synchronous emission (or error), unsubscribes. */
    private _captureSync(): { value: T | symbol; error: unknown } {
        let value: T | symbol = EMPTY;
        let error: unknown = EMPTY;

        this._shared
            .subscribe({
                next: (v) => {
                    value = v;
                },
                error: (e) => {
                    error = e;
                },
            })
            .unsubscribe();

        return { value, error };
    }

    private _defaultOrThrow(): T {
        if (this._hasDefault) {
            return this._defaultValue as T;
        }
        throw new Error("No value emitted");
    }

    private _createCycle(): ReplaySubject<T> {
        const subject = new ReplaySubject<T>(1);
        this._cycleAlive = true;
        // Internal mirror subscription: attaches to the subject directly, so it
        // bypasses share's refcount and cannot keep the upstream alive by itself.
        subject.subscribe({
            next: (value) => this._devtoolsHook?.onChange?.(value),
            error: () => {
                // resetOnError is immediate — the cache dies together with the cycle.
                this._cycleAlive = false;
            },
        });
        return subject;
    }

    private _createGraceNotifier(): Observable<unknown> {
        // dispose() (via _destroyed$) short-circuits a pending grace window, so
        // timer-based keepAlive never outlives the signal.
        return race(this._graceWindow(), this._destroyed$).pipe(
            tap(() => {
                this._cycleAlive = false;
            }),
        );
    }

    private _graceWindow(): Observable<unknown> {
        const keepAlive = this._keepAlive;
        if (keepAlive === "none") return of(null);
        if (keepAlive === "task") return timer(0);
        if (typeof keepAlive === "number") return timer(keepAlive);
        // "microtask": a subscriber unsubscribed by an incoming consumer ignores
        // next(), so no explicit cancellation bookkeeping is needed.
        return new Observable<void>((subscriber) => {
            queueMicrotask(() => subscriber.next());
        });
    }

    // === static ===

    static create<T>(source: Observable<T>, options?: SignalFromOptions<T>): DisposableSignal<T> {
        const fs = new FromSignal(source, options);

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
