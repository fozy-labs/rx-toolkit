import type { SignalFn, SignalOptionsOrKey } from "@/signals/types";

import { Computed } from "./Computed";
import { Effect } from "./Effect";
import { State } from "./State";

export class Signal {
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
