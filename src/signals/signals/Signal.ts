import type { Observable } from "rxjs";

import type { DisposableSignal, SignalComputeOptions, SignalOptionsOrKey, StateSignal } from "@/signals/types";

import { Computed } from "./Computed";
import { Effect } from "./Effect";
import { FromSignal, type SignalFromOptions } from "./FromSignal";
import { State } from "./State";

export class Signal {
    static state<T>(initialValue: T, options?: SignalOptionsOrKey<T>): StateSignal<T> {
        return State.create(initialValue, options);
    }

    /**
     * A lazy value derived from the signals `computeFn` reads. `options.equals`
     * decides when a recomputed value counts as unchanged; the previous
     * reference is then kept.
     */
    static compute<T>(computeFn: () => T, options?: SignalComputeOptions<T> | string): DisposableSignal<T> {
        return Computed.create(computeFn, options);
    }

    /**
     * Runs `effectFn` now and again whenever a signal it read changes. A
     * function it returns is the teardown: called before the next run and on
     * `unsubscribe()`. If the first run throws, the effect is disposed and the
     * error rethrown; a later run that throws keeps the effect subscribed to
     * what it read before the throw, and the error surfaces from the write
     * that triggered it.
     */
    static effect(effectFn: () => void | (() => void)) {
        return Effect.create(effectFn);
    }

    /**
     * Wraps an RxJS Observable into a read-only signal with a shared upstream
     * subscription. While the subscription is hot, reads are free (served from
     * the replay cache); `options.keepAlive` controls how long the subscription
     * survives after the last consumer.
     */
    static from<T, D extends T | undefined>(
        source: Observable<T>,
        options: Omit<SignalFromOptions<T>, "default"> & { default: D },
    ): DisposableSignal<T | (undefined extends D ? undefined : never)>;
    static from<T>(source: Observable<T>, options?: SignalFromOptions<T>): DisposableSignal<T>;
    static from(source: Observable<unknown>, options?: SignalFromOptions<unknown>): DisposableSignal<unknown> {
        return FromSignal.create(source, options);
    }
}
