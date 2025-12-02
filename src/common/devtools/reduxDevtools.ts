import { Batcher } from "@/signals";
import { DevtoolsLike } from "./types";

interface ReduxDevtoolsExtension {
    connect(options: { name: string }): ReduxDevtoolsConnection;
}

interface ReduxDevtoolsConnection {
    init(state: any): void;
    send(action: any, state: any): void;
}

type Options = {
    name?: string;
    driver?: ReduxDevtoolsExtension;
}

export function reduxDevtools(options: Options = {}): DevtoolsLike {
    const devtools = options.driver ?? (window as any).__REDUX_DEVTOOLS_EXTENSION__ as ReduxDevtoolsExtension | undefined;

    if (!devtools) {
        throw new Error('Redux Devtools extension is not installed');
    }

    let state = {} as Record<string, any>;
    const reduxDevtools = devtools!.connect({ name: options.name ?? 'RxToolkit' });
    reduxDevtools.init(state);
    const scheduler = Batcher.scheduler(Infinity);
    let isCreated = false;

    const updateFn = () => {
        reduxDevtools.send({ type: isCreated ? 'create' : 'update' }, state);
        isCreated = false;
    }

    const clearFn = () => {
        reduxDevtools.send({ type: 'clear' }, state);
    }

    const createFn = () => {
        isCreated = true;
        return updateFn;
    }

    return {
        state(name, initState) {
            const keys = name.split('/');

            state = applyState(keys, initState, state);
            scheduler.schedule(createFn());

            return (newState) => {
                if (newState === '$COMPLETED' || newState === '$CLEANED') {
                    state = deleteState(keys, state);
                    clearFn();
                    return;
                }

                state = applyState(keys, newState, state);
                scheduler.schedule(updateFn);
            }
        }
    }
}

function applyState(keys: string[], newState: any, state: any) {
    const acc = {...state};
    let current = acc;

    keys.forEach((key, i, arr) => {
        if (i === arr.length - 1) {
            current[key] = newState;
        } else {
            current[key] = { ...(current[key] ?? {}) };
            current = current[key];
        }
    });

    return acc;
}

// Идем по ключам и удалаем последний, если оставется пустой объект, удаляем его рекурсивно
function deleteState(keys: string[], state: any) {
    if (keys.length === 0) return state;

    const acc = {...state};

    // Рекурсивная функция для удаления с очисткой пустых объектов
    const deleteRecursive = (obj: any, pathKeys: string[], index: number): boolean => {
        const key = pathKeys[index];

        if (!obj || !obj.hasOwnProperty(key)) {
            return false;
        }

        if (index === pathKeys.length - 1) {
            delete obj[key];
        } else {
            obj[key] = {...obj[key]};
            deleteRecursive(obj[key], pathKeys, index + 1);

            // Если объект стал пустым, удаляем его
            if (Object.keys(obj[key]).length === 0) {
                delete obj[key];
            }
        }

        return true;
    };

    deleteRecursive(acc, keys, 0);
    return acc;
}
