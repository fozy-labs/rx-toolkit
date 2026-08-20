import { SharedOptions } from "@/common/options/SharedOptions";
import type { SignalLifecycleHook, SignalOptions } from "@/signals/types";

const COMPLETED = "$COMPLETED";

/**
 * Devtools writer for a single signal: pushes new values under its key and, via
 * {@link TDevtoolsStateUpdater.complete}, the disposal marker that drops the
 * entry from the tree.
 */
export type TDevtoolsStateUpdater<T> = ((newState: T, actionName?: string) => void) & {
    complete(): void;
};

export const Devtools = {
    createState<T>(initialValue: T, optionsDry: SignalOptions<T> | string = {}): TDevtoolsStateUpdater<T> | null {
        const options = typeof optionsDry === "string" ? { key: optionsDry } : optionsDry;

        if (options.isDisabled) return null;

        const createStateDevtools = SharedOptions.DEVTOOLS?.state;

        if (!createStateDevtools) return null;

        const key = createKey(options.key, options.base);

        let stateDevtools: ReturnType<typeof createStateDevtools<T>> | null = null;

        const push = (value: T, actionName?: string) => {
            if (!stateDevtools) {
                // Never materialize an entry just to mark it completed: a signal
                // that was disposed before its first real value must not appear
                // in devtools as a ghost "$COMPLETED" record.
                if ((value as unknown) === COMPLETED) return;
                stateDevtools = createStateDevtools!(key, value);
                return;
            }
            stateDevtools(value, actionName);
        };

        // Init
        if (options.beforeDevtoolsPush) {
            options.beforeDevtoolsPush(initialValue, push);
        } else {
            push(initialValue);
        }

        const update = (newState: T, actionName?: string) => {
            if (options.beforeDevtoolsPush) {
                options.beforeDevtoolsPush(newState, push, actionName);
            } else {
                push(newState, actionName);
            }
        };

        // The disposal marker is a transport-level message, not a value of T, so
        // it bypasses beforeDevtoolsPush: a transform only ever sees real values
        // and can neither swallow the marker nor mistake it for state.
        update.complete = () => {
            push(COMPLETED as T);
        };

        return update;
    },
    createSignalHooks<T>(initialValue: T, options: SignalOptions<T> = {}): SignalLifecycleHook<T> | null {
        const stateDevtools = this.createState(initialValue, {
            key: options.key,
            base: options.base,
            isDisabled: options.isDisabled,
            beforeDevtoolsPush: options.beforeDevtoolsPush,
        });
        if (!stateDevtools) return null;

        return {
            onChange(newValue: T, actionName?: string) {
                stateDevtools(newValue, actionName);
            },
            onDispose() {
                stateDevtools.complete();
            },
        };
    },
    get hasDevtools() {
        return !!SharedOptions.DEVTOOLS?.state;
    },
};

function createKey(key: string | undefined, base: string | undefined) {
    let result = "";

    if (key?.includes("{scope}")) {
        const scopeName = SharedOptions.getScopeName?.() || "#global";
        key = key.replace("{scope}", scopeName);
    }

    if (base && key) result += key.replace("{base}", base);
    else if (!base && key) result += key;
    else if (base && !key) result += `${base}/`;

    return result;
}
