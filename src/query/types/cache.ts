import { Subject } from "rxjs";

import type { Machine } from "@/query/core/machine";
import type { ReadableSignalFnLike } from "@/signals/types";

import type { IPatchHandle, Keyed } from "./common";

// ==================== Cache Interfaces ====================

export interface ICacheEntryOptions<TState> {
    retentionTime: number | false;
    devtoolsKey: string;
    beforeDevtoolsPush?: (state: TState) => TState;
}

export interface ICacheEntry<TState> {
    readonly completed$: Subject<void>;
    readonly state$: ReadableSignalFnLike<TState>;
    peek(): TState;
    set(state: TState): void;
    complete(): void;
}

export interface ICacheMap<TValue> {
    readonly size: number;
    get(key: string): TValue | undefined;
    set(key: string, value: TValue): void;
    delete(key: string): boolean;
    has(key: string): boolean;
    clear(): void;
    values(): IterableIterator<TValue>;
}

// ==================== QueryCacheEntry Options & Interface ====================

export interface IQueryCacheEntryOptions<TArgs, TData> {
    queryFn: (keyedArgs: Keyed<TArgs>, signal: AbortSignal) => Promise<TData>;
    retentionTime: number | false;
    keyedArgs: Keyed<TArgs>;
    resourceKey?: string;
    initialMachine?: Machine<TArgs, TData>;
    beforeDevtoolsPush?: (machine: Machine<TArgs, TData>) => any;
}

export interface IQueryCacheEntry<TArgs, TData> extends ICacheEntry<Machine<TArgs, TData>> {
    readonly keyedArgs: Keyed<TArgs>;
    // state$ is inherited from ICacheEntry<Machine<TArgs, TData>>
    readonly machine$: ReadableSignalFnLike<Machine<TArgs, TData>>;
    refresh(): void;
    retry(): void;
    createPatch(patchFn: (data: TData) => void): IPatchHandle | null;
}

// ==================== Lifecycle Contexts ====================

export interface TCacheEntryAddedContext<TArgs, TData> {
    entry: IQueryCacheEntry<TArgs, TData>;
    $cacheDataLoaded: Promise<TData>;
    $cacheEntryRemoved: Promise<void>;
}

export interface TQueryStartedContext<TArgs, TData> {
    entry: IQueryCacheEntry<TArgs, TData>;
    $queryFulfilled: Promise<{ data: TData }>;
}
