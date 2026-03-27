import type { Observable, Subject } from "rxjs";

/** Internal reactive container wrapping a Signal.state<TState> */
export interface ICacheEntry<TState = unknown> {
    /** Reactive read — registers signal dependency */
    state$(): TState;
    /** Non-reactive read */
    peek(): TState;
    /** Update stored state (no-op if completed) */
    set(state: TState): void;
    /** Fire onClean$ and mark completed. Subsequent set() calls are no-ops. */
    complete(): void;
    /** Cleanup observable — fires on complete() */
    readonly onClean$: Subject<void>;
    /** RxJS Observable bridge for GC via share({resetOnRefCountZero}) */
    readonly obs: Observable<TState>;
}

/** Options for CacheEntry construction */
export interface ICacheEntryOptions<TState> {
    keyParts?: string[];
    beforeDevtoolsPush?: (value: TState, push: (v: TState) => void) => void;
    cacheLifetime?: number | false;
}

/** CacheMap instance — generic storage container, keyed by args */
export interface ICacheMap<TArgs, TEntry> {
    get(args: TArgs): TEntry | undefined;
    getOrCreate(args: TArgs): TEntry;
    delete(args: TArgs): boolean;
    has(args: TArgs): boolean;
    clear(): void;
    readonly size: number;
    values(): IterableIterator<TEntry>;
    entries(): IterableIterator<[string | TArgs, TEntry]>;
}

/** Factory function used by CacheMap to create new entries */
export type TCacheMapFactory<TArgs, TEntry> = (args: TArgs) => TEntry;

/** Configuration for CacheMap creation */
export interface ICacheMapOptions<TArgs, TEntry> {
    factory: TCacheMapFactory<TArgs, TEntry>;
    keyStrategy: "serialize" | "compare";
    serializeArgs?: (args: TArgs) => string;
    compareArg?: (a: TArgs, b: TArgs) => boolean;
    doCacheArgs?: boolean;
}
