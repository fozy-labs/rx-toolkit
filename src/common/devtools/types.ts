export interface DevtoolsStateLike<T = any> {
    (newState: T): void;
}
export interface DevtoolsLike {
    state<T>(name: string, initState: T): DevtoolsStateLike<T>;
}

import type { SignalOptions } from "@/signals/types";

export type StateDevtoolsOptions = (SignalOptions & { _skipValues?: any[] }) | string;
