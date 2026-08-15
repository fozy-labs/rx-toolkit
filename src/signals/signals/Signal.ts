import type { Observable } from "rxjs";

import type { DisposableSignal, SignalOptionsOrKey, StateSignal } from "@/signals/types";

import { Computed } from "./Computed";
import { Effect } from "./Effect";
import { FromSignal, type SignalFromOptions } from "./FromSignal";
import { State } from "./State";

export class Signal {
    static state<T>(initialValue: T, options?: SignalOptionsOrKey<T>): StateSignal<T> {
        return State.create(initialValue, options);
    }

    static compute<T>(computeFn: () => T, options?: SignalOptionsOrKey<T>): DisposableSignal<T> {
        return Computed.create(computeFn, options);
    }

    static effect(effectFn: () => void) {
        return Effect.create(effectFn);
    }

    /**
     * Wraps an RxJS Observable into a read-only signal with a shared upstream
     * subscription. While the subscription is hot, reads are free (served from
     * the replay cache); `options.keepAlive` controls how long the subscription
     * survives after the last consumer. Replaces the deprecated `signalize`.
     */
    static from<T>(source: Observable<T>, options?: SignalFromOptions<T>): DisposableSignal<T> {
        return FromSignal.create(source, options);
    }
}
