import { PromiseResolver } from "@/common/utils/PromiseResolver";
import type {
    ICacheEntryAddedTools,
    IQueryStartedTools,
    IResourceV2CacheEntry,
    TOnCacheEntryAdded,
    TOnQueryStarted,
} from "@/query-v2/types";

interface EntryResolvers<TData> {
    dataLoaded: PromiseResolver<TData>;
    entryRemoved: PromiseResolver<void>;
}

interface QueryResolvers<TData> {
    queryFulfilled: PromiseResolver<{ data: TData }>;
}

/**
 * LifecycleHooks — manages onCacheEntryAdded and onQueryStarted callback lifecycles.
 * Creates promise-based tools ($cacheDataLoaded, $cacheEntryRemoved, $queryFulfilled)
 * and resolves them at appropriate points in the cache entry lifecycle.
 */
export class LifecycleHooks<TArgs, TData> {
    private _onCacheEntryAdded: TOnCacheEntryAdded<TArgs, TData> | undefined;
    private _onQueryStarted: TOnQueryStarted<TArgs, TData> | undefined;
    private _entryResolvers = new Map<TArgs, EntryResolvers<TData>>();
    private _queryResolvers = new Map<TArgs, QueryResolvers<TData>>();

    constructor(onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>, onQueryStarted?: TOnQueryStarted<TArgs, TData>) {
        this._onCacheEntryAdded = onCacheEntryAdded;
        this._onQueryStarted = onQueryStarted;
    }

    /** Called when a new cache entry is created */
    fireCacheEntryAdded(args: TArgs, _entry: IResourceV2CacheEntry<TArgs, TData>): void {
        if (!this._onCacheEntryAdded) return;

        const dataLoaded = new PromiseResolver<TData>();
        const entryRemoved = new PromiseResolver<void>();
        this._entryResolvers.set(args, { dataLoaded, entryRemoved });

        const tools: ICacheEntryAddedTools<TData> = {
            $cacheDataLoaded: dataLoaded.promise,
            $cacheEntryRemoved: entryRemoved.promise,
        };

        try {
            this._onCacheEntryAdded(args, tools);
        } catch {
            // Callback errors are caught, not propagated
        }
    }

    /** Called when a query starts */
    fireQueryStarted(args: TArgs, entry: IResourceV2CacheEntry<TArgs, TData>): void {
        if (!this._onQueryStarted) return;

        const queryFulfilled = new PromiseResolver<{ data: TData }>();
        this._queryResolvers.set(args, { queryFulfilled });

        const tools: IQueryStartedTools<TArgs, TData> = {
            $queryFulfilled: queryFulfilled.promise,
            getCacheEntry: () => entry,
        };

        try {
            this._onQueryStarted(args, tools);
        } catch {
            // Callback errors are caught, not propagated
        }
    }

    /** Called when data is first loaded (MachineSuccess) — resolves $cacheDataLoaded */
    resolveDataLoaded(args: TArgs, data: TData): void {
        const resolvers = this._entryResolvers.get(args);
        if (resolvers) {
            resolvers.dataLoaded.resolve(data);
        }
    }

    /** Called by GC or resetCache — resolves $cacheEntryRemoved */
    fireCacheEntryRemoved(args: TArgs): void {
        const resolvers = this._entryResolvers.get(args);
        if (resolvers) {
            resolvers.dataLoaded.reject(new Error("Promise never resolved before cacheEntryRemoved."));
            resolvers.entryRemoved.resolve();
            this._entryResolvers.delete(args);
        }
    }

    /** Called when a query completes — resolves or rejects $queryFulfilled */
    resolveQueryFulfilled(args: TArgs, result: { data: TData } | { error: unknown }): void {
        const resolvers = this._queryResolvers.get(args);
        if (resolvers) {
            if ("data" in result) {
                resolvers.queryFulfilled.resolve({ data: result.data });
            } else {
                resolvers.queryFulfilled.reject(result.error);
            }
            this._queryResolvers.delete(args);
        }
    }

    /** Cleans up all pending resolvers — prevents stale promise leaks */
    clearAll(): void {
        for (const [, resolvers] of this._entryResolvers) {
            resolvers.dataLoaded.reject(new Error("Cache cleared"));
            resolvers.entryRemoved.resolve();
        }
        this._entryResolvers.clear();

        for (const [, resolvers] of this._queryResolvers) {
            resolvers.queryFulfilled.reject(new Error("Cache cleared"));
        }
        this._queryResolvers.clear();
    }
}
