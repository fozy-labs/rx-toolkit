import type { TMachine } from './machine.types';
import type { ICacheEntry } from './cache.types';

/** Tools provided to onCacheEntryAdded */
export interface TCacheEntryAddedTools<TData> {
    /** Resolves when first MachineSuccess is set */
    $cacheDataLoaded: Promise<TData>;
    /** Resolves when cache entry is removed */
    $cacheEntryRemoved: Promise<void>;
    /** Get current machine state */
    getCacheEntry(): TMachine<TData, any>;
}

/** onCacheEntryAdded callback type */
export type TOnCacheEntryAdded<TArgs, TData> = (
    args: TArgs,
    tools: TCacheEntryAddedTools<TData>,
) => void | Promise<void>;

/** Tools provided to onQueryStarted */
export interface TQueryStartedTools<TData> {
    /** Resolves/rejects when query completes */
    $queryFulfilled: Promise<{ data: TData; isError: false }>;
    /** Get current cache entry for patching */
    getCacheEntry(): ICacheEntry<TData, any>;
}

/** onQueryStarted callback type */
export type TOnQueryStarted<TArgs, TData> = (
    args: TArgs,
    tools: TQueryStartedTools<TData>,
) => void | Promise<void>;
