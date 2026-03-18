import type { IResourceV2Agent } from "./agent.types";
import type { ICacheEntry } from "./cache.types";
import type { TOnCacheEntryAdded, TOnQueryStarted } from "./lifecycle.types";
import type { TMachine } from "./machine.types";
import type { TBeforeDevtoolsPushFn, TCompareArgsFn, TQueryFn, TSerializeArgsFn } from "./shared.types";

/** Options for api.createResource */
export interface IResourceV2Options<TArgs, TData, TError = Error> {
    key?: string;
    queryFn: TQueryFn<TArgs, TData>;
    onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>;
    onQueryStarted?: TOnQueryStarted<TArgs, TData>;
    serializeArgs?: TSerializeArgsFn;
    compareArg?: TCompareArgsFn;
    cacheLifetime?: number;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TMachine<TData, TError>>;
    maxSnapshotDataAge?: number;
    doCacheArgs?: boolean;
}

/** ResourceV2 instance (public API) */
export interface IResourceV2<TArgs, TData, TError = Error> {
    /** Create an agent (observer with SWR) */
    createAgent(): IResourceV2Agent<TArgs, TData, TError>;

    /** Execute query, returns promise of cache entry */
    query(args: TArgs, doForce?: boolean): Promise<ICacheEntry<TData, TError>>;

    /** Reactive query — returns current machine state as signal read */
    query$(args: TArgs, doForce?: boolean): TMachine<TData, TError>;

    /** Get raw cache entry (non-reactive) */
    entry(args: TArgs, doInitiate?: boolean): ICacheEntry<TData, TError> | null;

    /** Get cache entry signal (reactive) */
    entry$(args: TArgs, doInitiate?: boolean): TMachine<TData, TError>;

    /** Force re-fetch for given args */
    invalidate(args: TArgs): void;

    /** Compare two args values */
    compareArgs(a: TArgs, b: TArgs): boolean;
}
