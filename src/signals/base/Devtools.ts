import { SharedOptions } from "@/common/options/SharedOptions";
import type { SignalLifecycleHook, SignalOptions } from "@/signals/types";

import { Indexer } from "./Indexer";

export const Devtools = {
    createState<T>(initialValue: T, optionsDry: SignalOptions<T> | string = {}) {
        const options = typeof optionsDry === "string" ? { name: optionsDry } : optionsDry;

        if (options.isDisabled) return null;

        const createStateDevtools = SharedOptions.DEVTOOLS?.state;

        if (!createStateDevtools) return null;

        const key = createKey(options.key ?? options.name, options.base);

        let stateDevtools: ReturnType<typeof createStateDevtools<T>> | null = null;

        const push = (value: T) => {
            if (!stateDevtools) {
                stateDevtools = createStateDevtools!(key, value);
                return;
            }
            stateDevtools(value);
        };

        // Init
        if (options.beforeDevtoolsPush) {
            options.beforeDevtoolsPush(initialValue, push);
        } else {
            push(initialValue);
        }

        return (newState: T) => {
            if (options.beforeDevtoolsPush) {
                options.beforeDevtoolsPush(newState, push);
            } else {
                push(newState);
            }
        };
    },
    createSignalHooks<T>(initialValue: T, options: SignalOptions<T> = {}): SignalLifecycleHook<T> | null {
        const stateDevtools = this.createState(initialValue, {
            key: options.key,
            name: options.name,
            base: options.base,
            isDisabled: options.isDisabled,
            beforeDevtoolsPush: options.beforeDevtoolsPush,
        });
        if (!stateDevtools) return null;

        return {
            onChange(newValue: T) {
                stateDevtools(newValue);
            },
            onDispose() {
                stateDevtools("$COMPLETED" as any);
            },
        };
    },
    get hasDevtools() {
        return !!SharedOptions.DEVTOOLS?.state;
    },
};

function createKey(key: string | undefined, base: string | undefined) {
    const i = Indexer.getIndex();

    let result = "";

    if (key?.includes("{scope}")) {
        const scopeName = SharedOptions.getScopeName?.() || "#global";
        key = key.replace("{scope}", scopeName);
    }

    if (base && key) result += key.replace("{base}", base);
    else if (!base && key) result += key;
    else if (base && !key) result += `${base}/`;
    result += `#i=${i}`;

    return result;
}
