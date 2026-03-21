import { PromiseResolver } from "@/common/utils/PromiseResolver";
import type {
    TCacheEntryAddedTools,
    TOnCacheEntryAdded,
    TOnQueryStarted,
    TQueryStartedTools,
} from "@/query-v2/types/lifecycle.types";

import type { TMachineInstance } from "../machines/Machine";

import type { CacheEntry } from "./CacheEntry";

interface CacheEntryHookState<TData> {
    $cacheDataLoaded: PromiseResolver<TData>;
    $cacheEntryRemoved: PromiseResolver<void>;
    dataLoaded: boolean;
}

interface QueryStartedHookState<TData> {
    $queryFulfilled: PromiseResolver<{ data: TData; isError: false }>;
}

export class LifecycleHooks<TArgs, TData, TError = Error> {
    private readonly _onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>;
    private readonly _onQueryStarted?: TOnQueryStarted<TArgs, TData>;

    private _cacheEntryState: Map<string, CacheEntryHookState<TData>> = new Map();
    private _queryState: QueryStartedHookState<TData> | null = null;
    private _serializeArgs: (args: unknown) => string;

    constructor(options: {
        onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>;
        onQueryStarted?: TOnQueryStarted<TArgs, TData>;
        serializeArgs: (args: unknown) => string;
    }) {
        this._onCacheEntryAdded = options.onCacheEntryAdded;
        this._onQueryStarted = options.onQueryStarted;
        this._serializeArgs = options.serializeArgs;
    }

    fireCacheEntryAdded(args: TArgs, getCacheEntry: () => TMachineInstance<TData, TError>): void {
        if (!this._onCacheEntryAdded) return;

        const key = this._serializeArgs(args);
        const $cacheDataLoaded = new PromiseResolver<TData>();
        const $cacheEntryRemoved = new PromiseResolver<void>();

        // Prevent unhandled rejection if no consumer attaches .catch()
        $cacheDataLoaded.promise.catch(() => {});
        $cacheEntryRemoved.promise.catch(() => {});

        const state: CacheEntryHookState<TData> = {
            $cacheDataLoaded,
            $cacheEntryRemoved,
            dataLoaded: false,
        };
        this._cacheEntryState.set(key, state);

        const tools: TCacheEntryAddedTools<TData> = {
            $cacheDataLoaded: $cacheDataLoaded.promise,
            $cacheEntryRemoved: $cacheEntryRemoved.promise,
            getCacheEntry: getCacheEntry as () => any,
        };

        this._onCacheEntryAdded(args, tools);
    }

    fireCacheEntryRemoved(args: TArgs): void {
        const key = this._serializeArgs(args);
        const state = this._cacheEntryState.get(key);
        if (!state) return;

        if (!state.dataLoaded) {
            state.$cacheDataLoaded.reject(new Error("Cache entry removed before data loaded"));
        }
        state.$cacheEntryRemoved.resolve();
        this._cacheEntryState.delete(key);
    }

    resolveCacheDataLoaded(args: TArgs, data: TData): void {
        const key = this._serializeArgs(args);
        const state = this._cacheEntryState.get(key);
        if (!state || state.dataLoaded) return;
        state.dataLoaded = true;
        state.$cacheDataLoaded.resolve(data);
    }

    fireQueryStarted(args: TArgs, getCacheEntry: () => CacheEntry<TData, TError>): void {
        if (!this._onQueryStarted) {
            // Still create state for resolving/rejecting even without callback
            const resolver = new PromiseResolver<{ data: TData; isError: false }>();
            resolver.promise.catch(() => {});
            this._queryState = {
                $queryFulfilled: resolver,
            };
            return;
        }

        const $queryFulfilled = new PromiseResolver<{ data: TData; isError: false }>();
        // Prevent unhandled rejection if consumer doesn't attach .catch()
        $queryFulfilled.promise.catch(() => {});
        this._queryState = { $queryFulfilled };

        const tools: TQueryStartedTools<TData> = {
            $queryFulfilled: $queryFulfilled.promise,
            getCacheEntry: () => getCacheEntry() as any,
        };

        this._onQueryStarted(args, tools);
    }

    resolveQueryFulfilled(data: TData): void {
        if (!this._queryState) return;
        this._queryState.$queryFulfilled.resolve({ data, isError: false });
        this._queryState = null;
    }

    rejectQueryFulfilled(error: unknown): void {
        if (!this._queryState) return;
        this._queryState.$queryFulfilled.reject(error);
        this._queryState = null;
    }

    clearAll(): void {
        for (const [, state] of this._cacheEntryState) {
            if (!state.dataLoaded) {
                state.$cacheDataLoaded.reject(new Error("Cache entry removed before data loaded"));
            }
            state.$cacheEntryRemoved.resolve();
        }
        this._cacheEntryState.clear();

        if (this._queryState) {
            try {
                this._queryState.$queryFulfilled.reject(new Error("Resource reset"));
            } catch {
                // Already settled
            }
            this._queryState = null;
        }
    }
}
