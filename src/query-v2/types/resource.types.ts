import type { DevtoolsLike } from "@/common/devtools";
import type { ReadableSignalFnLike } from "@/signals/types";

import type { IResourceV2Agent } from "./agent.types";
import type { ICacheEntry } from "./cache.types";
import type { TOnCacheEntryAdded, TOnQueryStarted } from "./lifecycle.types";
import type { IPatchHandle, TMachineInstance } from "./machine.types";
import type { ArgsOrVoid } from "./shared.types";

/** Query function signature */
export type TQueryFn<TArgs, TData> = (args: TArgs, tools: { abortSignal: AbortSignal }) => Promise<TData>;

/** Serialization function */
export type TSerializeArgsFn<TArgs = unknown> = (args: TArgs) => string;

/** Comparison function */
export type TCompareArgsFn<TArgs = unknown> = (a: TArgs, b: TArgs) => boolean;

/** ResourceV2 creation options */
export type TResourceV2Options<TArgs, TData> = {
    key?: string;
    queryFn: TQueryFn<TArgs, TData>;
    cacheLifetime?: number | false;
    serializeArgs?: TSerializeArgsFn<TArgs>;
    compareArg?: TCompareArgsFn<TArgs>;
    onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>;
    onQueryStarted?: TOnQueryStarted<TArgs, TData>;
    maxSnapshotDataAge?: number;
    doCacheArgs?: boolean;
    devtools?: DevtoolsLike;
};

/** ResourceV2 instance — the main data fetching unit */
export interface IResourceV2<TArgs, TData> {
    /** Create an agent (SWR observer) */
    createAgent(): IResourceV2Agent<TArgs, TData>;

    /** Execute query, return promise of data */
    query(...args: [...ArgsOrVoid<TArgs>, doForce?: boolean]): Promise<TData>;

    /** Get cache entry (non-reactive). Returns null when no entry exists. */
    getEntry(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null;
    /** Get cache entry (non-reactive). Forces creation with doInitiate: true. */
    getEntry(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>;

    /** Get cache entry (reactive — Signal.compute). Returns null when no entry or after resetAll(). */
    getEntry$(...args: ArgsOrVoid<TArgs>): IResourceV2CacheEntry<TArgs, TData> | null;
    /** Get cache entry (reactive). Forces creation with doInitiate: true. */
    getEntry$(...args: [...ArgsOrVoid<TArgs>, doInitiate: true]): IResourceV2CacheEntry<TArgs, TData>;

    /** Force re-fetch for args in success state */
    invalidate(...args: ArgsOrVoid<TArgs>): void;
}

/** Consumer-facing cache entry */
export interface IResourceV2CacheEntry<TArgs, TData> extends ICacheEntry<TMachineInstance<TArgs, TData>> {
    /** Signal property — reactive read of machine state (alias for inherited state$()) */
    readonly machine$: ReadableSignalFnLike<TMachineInstance<TArgs, TData>>;
    /** Non-reactive read */
    peek(): TMachineInstance<TArgs, TData>;
    /** Check if this entry matches given args */
    isMyArgs(args: TArgs): boolean;
    /** Create an optimistic patch. Returns null if no data available. */
    createPatch(patchFn: (draft: TData) => void): IPatchHandle | null;
    /** Force re-fetch for this entry */
    invalidate(): void;
    /** Execute queryFn for this entry's args */
    query(doForce?: boolean): Promise<TData>;
}
