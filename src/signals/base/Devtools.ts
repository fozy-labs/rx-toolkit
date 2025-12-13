import { SharedOptions } from "@/common/options/SharedOptions";
import { StateDevtoolsOptions } from "@/common/devtools";
import { Indexer } from "./Indexer";

export const Devtools = {
    createState<T>(initialValue: T, optionsDry: StateDevtoolsOptions = {}) {
        const options = typeof optionsDry === 'string'
            ? { name: optionsDry }
            : optionsDry;

        if (options.isDisabled) return null;

        let createStateDevtools = SharedOptions.DEVTOOLS?.state;

        if (!createStateDevtools) return null;

        const key = createKey(options.name, options.base);

        let stateDevtools =
            options._skipValues?.includes(initialValue)
                ? null
                : createStateDevtools<T>(key, initialValue)

        return (newState: T) => {
            if (options._skipValues?.includes(newState)) {
                return;
            }

            if (!stateDevtools) {
                stateDevtools = createStateDevtools(key, newState);
                return;
            }

            stateDevtools(newState);
        }
    },
    get hasDevtools() {
        return !!SharedOptions.DEVTOOLS?.state;
    },
}

function createKey(name: string | undefined, base: string | undefined) {
    const i = Indexer.getIndex();

    let key = '';

    if (name?.includes('{scope}')) {
        const scopeName = SharedOptions.getScopeName?.() || '#global';
        name = name.replace('{scope}', scopeName);
    }

    if (base && name) key += name.replace('{base}', base);
    else if (!base && name) key += name;
    else if (base && !name) key += `${base}/`;
    key += `#i=${i}`;

    return key;
}
