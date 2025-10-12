import { PromiseResolver } from "@/common/utils";
import { SharedOptions } from "@/common/options/SharedOptions";

import { ReactiveCache } from "@/query/lib/ReactiveCache";
import type { ResourceCreateOptions, ResourceDefinition, ResourceInstance, ResourceRefInstanse, ResourceTransaction } from "@/query/types";
import { QueriesCache } from "@/query/core/QueriesCache";

import { ResourceAgent } from "./ResourceAgent";
import { ResourceRef } from "./ResourceRef";

export type CoreResourceQueryState<D extends ResourceDefinition> = {
    transactions: ResourceTransaction[] | null;
    abortController: AbortController | null;
    args: D['Args'] | null;
    savedData: D['Data'] | null;
    data: D['Data'] | null;
    error: unknown | null;
    isError: boolean;
    isLoading: boolean;
    isReloading: boolean;
    isDone: boolean;
    isSuccess: boolean;
    isLocked: boolean;
    isInitiated: boolean;
    lockCount: number;
}

export type CoreResourceQueryCache<D extends ResourceDefinition> = ReactiveCache<CoreResourceQueryState<D>>;

class ResourceQueryState {
    static create<D extends ResourceDefinition>(): CoreResourceQueryState<D> {
        return {
            transactions: null,
            savedData: null,
            abortController: null,
            args: null,
            data: null,
            error: null,
            isError: false,
            isReloading: false,
            isDone: false,
            isSuccess: false,
            isLocked: false,
            isLoading: false,
            isInitiated: false,
            lockCount: 0
        };
    }

    static load<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D> = ResourceQueryState.create<D>(),
        args: D['Args'],
    ): CoreResourceQueryState<D> {
        return {
            ...state,
            args: args,
            isLoading: !state.isDone,
            isReloading: state.isDone,
            isInitiated: true,
        };
    }

    static success<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D>,
        data: D['Data'],
    ): CoreResourceQueryState<D> {
        return {
            ...state,
            savedData: null,
            transactions: null,
            data,
            isLoading: false,
            isReloading: false,
            isDone: true,
            isSuccess: true,
            isError: false,
            error: null,
        };
    }

    static error<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D>,
        error: unknown,
    ): CoreResourceQueryState<D> {
        return {
            ...state,
            isLoading: false,
            isReloading: false,
            isDone: true,
            isSuccess: false,
            isError: true,
            error,
        };
    }

    static incrementLock<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D>
    ): CoreResourceQueryState<D> {
        const lockCount = state.lockCount + 1;
        return {
            ...state,
            isLocked: lockCount > 0,
            lockCount
        };
    }

    static decrementLock<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D>
    ): CoreResourceQueryState<D> {
        const lockCount = Math.max(0, state.lockCount - 1);
        return {
            ...state,
            isLocked: lockCount > 0,
            lockCount
        }
    }

    static update<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D>,
        data: D['Data'],
        savedData: D['Data'] | null,
        transactions: ResourceTransaction[] | null,
    ): CoreResourceQueryState<D> {
        return {
            ...state,
            transactions,
            savedData,
            data
        }
    }

    /**
     * @deprecated
     */
    static setData<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D>,
        data: D['Data']
    ): CoreResourceQueryState<D> {
        return {
            ...state,
            transactions: null,
            data
        }
    }
}

// TODO вынести и унифицировать; как-то организовать глобальные хуки и devtools через хуки
class QueryHooks<D extends ResourceDefinition> {
    private onCacheEntryAddedListeners: Array<NonNullable<ResourceCreateOptions<D>['onCacheEntryAdded']>> = [];
    private onQueryStartedListeners: Array<NonNullable<ResourceCreateOptions<D>['onQueryStarted']>> = [];

    constructor(
        private readonly _options: ResourceCreateOptions<D> | undefined
    ) {
        if (_options?.onCacheEntryAdded) {
            this.onCacheEntryAddedListeners.push(_options.onCacheEntryAdded);
        }
        if (_options?.onQueryStarted) {
            this.onQueryStartedListeners.push(_options.onQueryStarted);
        }
    }

    onCacheEntryAdded = (args: D['Args']) => {
        const cacheDataLoadedResolver = new PromiseResolver<void>();
        const cacheEntryRemovedResolver = new PromiseResolver<void>();

        this.onCacheEntryAddedListeners.forEach((listener) => {
            listener(args, {
                $cacheDataLoaded: cacheDataLoadedResolver.promise,
                $cacheEntryRemoved: cacheEntryRemovedResolver.promise,
            });
        });

        return {
            cacheDataLoaded: () => cacheDataLoadedResolver.resolve(),
            cacheEntryRemoved: () => cacheEntryRemovedResolver.resolve(),
        };
    }

    onQueryStarted = (args: D['Args']) => {
        const queryFulfilledResolver = new PromiseResolver<{
            data: D["Result"],
            error: undefined
            isError: false
        } | {
            data: undefined,
            error: unknown
            isError: true
        }>();

        this.onQueryStartedListeners.forEach((listener) => {
            listener(args, {
                $queryFulfilled: queryFulfilledResolver.promise
            });
        });

        return {
            fulfilledSuccess: (data: D['Result']) => {
                queryFulfilledResolver.resolve({
                    data,
                    error: undefined,
                    isError: false
                });
            },
            fulfilledError: (error: unknown) => {
                queryFulfilledResolver.resolve({
                    data: undefined,
                    error,
                    isError: true
                });
            }
        };
    }
}

export class Resource<D extends ResourceDefinition> implements ResourceInstance<D> {
    private readonly _queriesCache;
    private readonly _hooks;

    constructor(
        private readonly _options: ResourceCreateOptions<D>
    ) {
        this._hooks = new QueryHooks<D>(_options);
        this._queriesCache = new QueriesCache<D['Args'], CoreResourceQueryState<D>>(
            _options.cacheLifetime,
            'Resource'
        );
    }

    createAgent = () => {
        return new ResourceAgent<D>(this);
    }

    createRef = (args: D['Args']): ResourceRefInstanse<D> => {
        return new ResourceRef<D>(this, args);
    }

    getQueryCache(args: D['Args']): CoreResourceQueryCache<D> | undefined {
        return this._queriesCache.getQueryCache(args);
    }

    createQueryCache(args: D['Args']): CoreResourceQueryCache<D> {
        const cache = this._queriesCache.createQueryCache(args, ResourceQueryState.create<D>());

        const hookResolvers = this._hooks.onCacheEntryAdded(args);

        const spySub = cache.spy$.subscribe((state) => {
            if (!state.isDone) return;
            hookResolvers.cacheDataLoaded();
            spySub.unsubscribe();
        });

        cache.onClean$.subscribe(() => {
            hookResolvers.cacheEntryRemoved();
        });

        return cache;
    }

    incrementLock(args: D['Args'], options?: { cache?: CoreResourceQueryCache<D> }) {
        let cache = options?.cache ?? this.getQueryCache(args);
        if (!cache) {
            cache = this.createQueryCache(args);
        }
        cache.next(ResourceQueryState.incrementLock(cache.value));
        return cache;
    }

    decrementLock(args: D['Args'], options?: { cache?: CoreResourceQueryCache<D> }) {
        let cache = options?.cache ?? this.getQueryCache(args);
        if (!cache) {
            return null;
        }
        cache.next(ResourceQueryState.decrementLock(cache.value));
        return cache;
    }

    update(
        args: D['Args'],
        updateFn: (
            data: D['Data'],
            savedData: D['Data'] | null,
            transactions: ResourceTransaction[] | null,
        ) => {
            data: D['Data'],
            transactions: ResourceTransaction[] | null,
            savedData: D['Data'] | null
        },
        options?: { cache?: CoreResourceQueryCache<D> }
    ) {
        let cache = options?.cache ?? this.getQueryCache(args);
        if (!cache) {
            return null;
        }

        const cacheValue = cache.value;

        if (!cacheValue.isDone) {
            return cache;
        }

        const { data, transactions, savedData } = updateFn(cacheValue.data!, cacheValue.savedData, cacheValue.transactions);
        cache.next(ResourceQueryState.update(cache.value, data, savedData, transactions));
        return cache;
    }


    initiate(args: D['Args'], options?: { cache?: CoreResourceQueryCache<D> }): CoreResourceQueryCache<D> {
        let cache = options?.cache ?? this.getQueryCache(args);
        const state = ResourceQueryState.load(cache?.value, args);

        if (!cache) {
            cache = this.createQueryCache(args);
        }

        cache.next(state);

        let abortController = state.abortController;
        abortController?.abort();
        abortController = new AbortController();

        const query = this._options.queryFn(args, { abortSignal: abortController.signal });

        const hookResolvers = this._hooks.onQueryStarted(args);

        query
            .then((data) => {
                if (abortController.signal.aborted) {
                    return;
                }

                hookResolvers.fulfilledSuccess(data);

                const selectedData = this._options.select ? this._options.select(data) : data;
                cache.next(ResourceQueryState.success(state, selectedData));
            })
            .catch((error) => {
                if (abortController.signal.aborted) {
                    return;
                }

                hookResolvers.fulfilledError(error);

                SharedOptions.onError?.(error); // TODO перенести в хуки
                cache.next(ResourceQueryState.error(state, error));
            });

        return cache;
    }
}

