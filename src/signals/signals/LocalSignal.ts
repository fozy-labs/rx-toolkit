import { LocalStateSignal } from "../types";

import { LocalState, type LocalStateOptions } from "./LocalState";
import { type StorageLike } from "./LocalStateStorage";

export class LocalSignal {
    /** Global GC tuning — delegates to `LocalState.GC_OPTIONS`. */
    static get GC_OPTIONS(): typeof LocalState.GC_OPTIONS {
        return LocalState.GC_OPTIONS;
    }

    static set GC_OPTIONS(value: typeof LocalState.GC_OPTIONS) {
        LocalState.GC_OPTIONS = value;
    }

    /** Default storage driver — delegates to `LocalState.DEFAULT_DRIVER`. */
    static get DEFAULT_DRIVER(): StorageLike | null {
        return LocalState.DEFAULT_DRIVER;
    }

    static set DEFAULT_DRIVER(value: StorageLike | null) {
        LocalState.DEFAULT_DRIVER = value;
    }

    static state<T = string | null | number | undefined>(options: LocalStateOptions<T>): LocalStateSignal<T> {
        const localState = new LocalState<T>(options);

        function signalFn() {
            return localState.get();
        }

        signalFn.peek = () => localState.peek();
        signalFn.get = () => localState.get();
        signalFn.set = (value: T, actionName?: string) => localState.set(value, actionName);
        signalFn.update = (updater: (value: T) => T, actionName?: string) => localState.update(updater, actionName);
        signalFn.clear = () => localState.clear();
        signalFn.obs = localState.obs;

        return signalFn as unknown as LocalStateSignal<T>;
    }
}
