import { Batcher } from "@/signals";
import { DevtoolsLike } from "./types";

export function reduxDevtools(): DevtoolsLike {
    let state = {};
    // @ts-ignore
    const reduxDevtools = window.__REDUX_DEVTOOLS_EXTENSION__!.connect({ name: 'RxToolkit' });
    reduxDevtools.init(state);
    const scheduler = Batcher.scheduler(Infinity);

    const updateFn = () => {
        reduxDevtools.send({ type: 'update' }, state);
    }

    const createFn = () => {
        reduxDevtools.send({ type: 'create' }, state);
    }

    return {
        state(name, initState) {
            state = { ...state, [name]: initState };
            scheduler.schedule(createFn);

            return (newState) => {
                state = { ...state, [name]: newState };
                scheduler.schedule(updateFn);
            }
        }
    }
}
