import type { IResourceV2CacheEntry } from "./resource.types";

/** Tools provided to onCacheEntryAdded callback */
export interface ICacheEntryAddedTools<TData> {
    /** Resolves when first MachineSuccess is reached */
    readonly $cacheDataLoaded: Promise<TData>;
    /** Resolves when cache entry is removed (GC / resetAll) */
    readonly $cacheEntryRemoved: Promise<void>;
}

/** Tools provided to onQueryStarted callback */
export interface IQueryStartedTools<TArgs, TData> {
    /** Resolves/rejects when query completes */
    readonly $queryFulfilled: Promise<{ data: TData }>;
    /** Get current cache entry */
    readonly getCacheEntry: () => IResourceV2CacheEntry<TArgs, TData>;
}

/** onCacheEntryAdded callback signature */
export type TOnCacheEntryAdded<TArgs, TData> = (
    args: TArgs,
    tools: ICacheEntryAddedTools<TData>,
) => void | Promise<void>;

/** onQueryStarted callback signature */
export type TOnQueryStarted<TArgs, TData> = (
    args: TArgs,
    tools: IQueryStartedTools<TArgs, TData>,
) => void | Promise<void>;
