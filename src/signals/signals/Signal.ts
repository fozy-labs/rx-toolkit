import type { StateDevtoolsOptions } from "@/common/devtools";
import { SignalFn } from "@/signals/types";
import { Computed, Effect, State } from "@/signals/signals";

export class Signal<T> extends State<T> {

    /** @deprecated use `State` instead */
    constructor(
        initialValue: T,
        options?: StateDevtoolsOptions,
    ) {
        super(initialValue, options);
    }

    /** @deprecated use `state` instead */
    static create<T>(initialValue: T, options?: StateDevtoolsOptions): SignalFn<T> {
        return this.state(initialValue, options);
    }

    static state<T>(initialValue: T, options?: StateDevtoolsOptions): SignalFn<T> {
        return State.create(initialValue, options);
    }

    static compute<T>(computeFn: () => T, options?: StateDevtoolsOptions) {
        return Computed.create(computeFn, options);
    }

    static effect(effectFn: () => void) {
        return Effect.create(effectFn);
    }

}
