import type { TCompareArgsFn, TSerializeArgsFn } from "./shared.types";

/** Single reactive cache unit holding a Machine */
export interface ICacheEntry<TState> {
    /** Reactive signal holding current state */
    readonly state$: () => TState;

    /** Synchronous peek at current state */
    peek(): TState;

    /** Update */
    set(machine: TState): void;

    /** Cleanup — complete and release */
    complete(): void;

    /** Observable for cache lifetime management */
    readonly onClean$: { subscribe(cb: () => void): { unsubscribe(): void } };
}

/** Factory options for creating appropriate cache map */
export interface ICacheMapOptions<_TArgs> {
    keyStrategy: "serialize" | "compare";
    serializeArgs: TSerializeArgsFn;
    compareArg: TCompareArgsFn;
    doCacheArgs: boolean;
}
