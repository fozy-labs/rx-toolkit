import type { IResourceV2Agent } from "./agent.types";
import type { ICacheEntry } from "./cache.types";
import type { TOnCacheEntryAdded, TOnQueryStarted } from "./lifecycle.types";
import type { TMachine } from "./machine.types";
import type { TBeforeDevtoolsPushFn, TCompareArgsFn, TQueryFn, TSerializeArgsFn } from "./shared.types";

/** Options for createResource */
export interface IResourceV2Options<TArgs, TData> {
    key?: string;
    queryFn: TQueryFn<TArgs, TData>;
    onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>;
    onQueryStarted?: TOnQueryStarted<TArgs, TData>;
    serializeArgs?: TSerializeArgsFn;
    compareArg?: TCompareArgsFn;
    cacheLifetime?: number;
    beforeDevtoolsPush?: TBeforeDevtoolsPushFn<TMachine<TArgs, TData>>;
    maxSnapshotDataAge?: number;
    doCacheArgs?: boolean;
}

/** ResourceV2 instance (public API) */
export interface IResourceV2<TArgs, TData> {
    /** Create an agent */
    createAgent(): IResourceV2Agent<TArgs, TData>;

    /** Execute query, returns promise */
    query(args: TArgs, doForce?: boolean): Promise<TMachine<TArgs, TData>>;

    /** Get raw cache entry */
    entry(args: TArgs, doInitiate?: boolean): ICacheEntry<TMachine<TArgs, TData>> | null;

    /** Force re-fetch for given args */
    invalidate(args: TArgs): void;

    /** Compare two args values */
    compareArgs(a: TArgs, b: TArgs): boolean;
}
