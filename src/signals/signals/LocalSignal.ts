import { StatefulSignalFn } from "../types";

import { LocalState, type LocalStateOptions } from "./LocalState";

export class LocalSignal {
    static create<T = string | null | number | undefined>(options: LocalStateOptions<T>): StatefulSignalFn<T> {
        return LocalState.create(options);
    }
}
