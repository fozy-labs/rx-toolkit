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
            state = { ...state, [name]: initState };
            scheduler.schedule(createFn());

            return (newState) => {
                if (newState === '$COMPLETE' || newState === '$CLEANED') {
                    delete state[name];
                    clearFn();
                    return;
                }

                state = { ...state, [name]: newState };
                scheduler.schedule(updateFn);
            }
        }
    }
}
