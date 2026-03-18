import type { SignalOptionsOrKey } from "@/signals/types";
import { SignalFn } from "@/signals/types";

import { Computed } from "./Computed";
import { Effect } from "./Effect";
import { State } from "./State";

/** @deprecated use `State` instead */
export class Signal<T> extends State<T> {
    /** @deprecated use `state` instead */
    static create<T>(initialValue: T, options?: SignalOptionsOrKey<T>): SignalFn<T> {
        return this.state(initialValue, options);
    }

    static state<T>(initialValue: T, options?: SignalOptionsOrKey<T>): SignalFn<T> {
        return State.create(initialValue, options);
    }

    static compute<T>(computeFn: () => T, options?: SignalOptionsOrKey<T>) {
        return Computed.create(computeFn, options);
    }

    static effect(effectFn: () => void) {
        return Effect.create(effectFn);
    }
}
