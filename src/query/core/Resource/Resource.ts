import { SharedOptions } from "@/common/options/SharedOptions";
import { ReactiveCache } from "@/query/lib/ReactiveCache";
import type {
    ResourceCreateOptions,
    ResourceDefinition,
    ResourceInstance,
    ResourceRefInstanse,
    ResourceTransaction
} from "@/query/types";

import { QueriesCache } from "../QueriesCache";
import { QueriesLifetimeHooks } from "../QueriesLifetimeHooks";
import { ResetAllQueriesSignal } from "../ResetAllQueriesSignal";
import { ResourceAgent } from "./ResourceAgent";
import { ResourceRef } from "./ResourceRef";

export type CoreResourceQueryState<D extends ResourceDefinition> = {
    transactions: ResourceTransaction[] | null;
    abortController: AbortController | null;
    args: D['Args'];
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
    static create<D extends ResourceDefinition>(args: D['Args']): CoreResourceQueryState<D> {
        return {
            transactions: null,
            savedData: null,
            abortController: null,
            args,
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
        state: CoreResourceQueryState<D> | undefined | null,
        args: D['Args'],
    ): CoreResourceQueryState<D> {
        state = state ?? ResourceQueryState.create<D>(args);

        return {
            ...state,
            abortController: new AbortController(),
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
            abortController: null,
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
            abortController: null,
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

    static createWithData<D extends ResourceDefinition>(
        data: D['Data'],
        args: D['Args'],
    ): CoreResourceQueryState<D> {
        return {
            savedData: null,
            transactions: null,
            data,
            isLoading: false,
            isReloading: false,
            isDone: true,
            isSuccess: true,
            isError: false,
            error: null,
            abortController: null,
            args,
            isInitiated: false,
            isLocked: false,
            lockCount: 0
        };
    }
}

export class Resource<D extends ResourceDefinition> implements ResourceInstance<D> {
    private readonly _queriesCache;
    private readonly _hooks;

    private _DEFAULT_CACHE_LIFETIME = 60_000;

    constructor(
        private readonly _options: ResourceCreateOptions<D>
    ) {
        this._hooks = new QueriesLifetimeHooks<D['Args'], D['Result']>({
            onCacheEntryAdded: _options.onCacheEntryAdded,
            onQueryStarted: _options.onQueryStarted,
            devtoolsName: _options.devtoolsName,
        });

        this._queriesCache = new QueriesCache<D['Args'], CoreResourceQueryState<D>>(
            _options.cacheLifetime ?? this._DEFAULT_CACHE_LIFETIME,
        );

        ResetAllQueriesSignal.clean$.subscribe(() => {
            const caches = Array.from(this._queriesCache.values());
            caches.forEach((cache) => {
                cache.value.abortController?.abort();
                cache.next(ResourceQueryState.create<D>(cache.value.args));
            });
        });
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

    createQueryCache(args: D['Args'], state = ResourceQueryState.create<D>(args)): CoreResourceQueryCache<D> {
        const cache = this._queriesCache.createQueryCache(args, state);

        const hookResolvers = this._hooks.onCacheEntryAdded(args);

        const spySub = cache.spy$.subscribe((state) => {
            if (!state.isDone) return;
            hookResolvers.cacheDataLoaded();
            spySub.unsubscribe();
        });

        cache.spy$.subscribe((data) => {
            hookResolvers.dataChanged$.next(data);
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

    createWithData(
        args: D['Args'],
        data: D['Data'],
        options?: { cache?: CoreResourceQueryCache<D> }
    ) {
        let cache = options?.cache ?? this.getQueryCache(args);
        const state = ResourceQueryState.createWithData(data, args);

        if (!cache) {
            cache = this.createQueryCache(args, state);

        // Только обновляем кэш новыми данными, если он еще не был инициализирован.
        // Это предотвращает перезапись уже инициализированного кэша.
        } else if (!cache.value.isInitiated) {
            cache.next(state);
        }

        return cache;
    }

    initiate(args: D['Args'], options?: { cache?: CoreResourceQueryCache<D> }): CoreResourceQueryCache<D> {
        let cache = options?.cache ?? this.getQueryCache(args);
        const prevAbortController = cache?.value.abortController ?? null;

        const state = ResourceQueryState.load(cache?.value, args);

        if (!cache) {
            cache = this.createQueryCache(args, state);
        } else {
            cache.next(state);
        }

        prevAbortController?.abort();
        const abortController = state.abortController!;

        const query = this._options.queryFn(args, { abortSignal: abortController.signal });

        const hookResolvers = this._hooks.onQueryStarted(args);

        query
            .then((result) => {
                if (abortController.signal.aborted) {
                    return;
                }

                const data = this._options.select ? this._options.select(result) : result;
                cache.next(ResourceQueryState.success(state, data));

                hookResolvers.fulfilledSuccess(data);
            })
            .catch((error) => {
                if (abortController.signal.aborted) {
                    return;
                }

                cache.next(ResourceQueryState.error(state, error));

                hookResolvers.fulfilledError(error);
            });

        return cache;
    }

    compareArgs(args1: D['Args'], args2: D['Args']): boolean {
        const compareFn = this._options.compareArgsFn ?? SharedOptions.defaultCompareArgs;
        return compareFn(args1, args2);
    }
}

