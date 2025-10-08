import { DevtoolsLike } from "./types";

export function combineDevtools(...devtools: DevtoolsLike[]): DevtoolsLike {
    return {
        state(name, initState) {
            const updaters = devtools.map(d => d.state(name, initState));
            return (newState) => {
                updaters.forEach(update => update(newState));
            }
        }
    }
}
