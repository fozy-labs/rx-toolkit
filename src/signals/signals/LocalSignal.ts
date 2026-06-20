import { LocalStateSignal } from "../types";

import { LocalState, type LocalStateOptions } from "./LocalState";

export class LocalSignal {
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
