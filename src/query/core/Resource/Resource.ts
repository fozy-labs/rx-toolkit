import { ReactiveCache } from "query/lib/ReactiveCache";
import type { ResourceCreateOptions, ResourceDefinition, ResourceInstance, ResourceRefInstanse } from "query/types/Resource.types";

import { QueriesCache } from "../QueriesCache";
import { SharedOptions } from "../SharedOptions";
import { ResourceAgent } from "./ResourceAgent";
import { ResourceRef } from "./ResourceRef";

export type CoreResourceQueryState<D extends ResourceDefinition> = {
    abortController: AbortController | null;
    args: D['Args'] | null;
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

    static setData<D extends ResourceDefinition>(
        state: CoreResourceQueryState<D>,
        data: D['Data']
    ): CoreResourceQueryState<D> {
        return {
            ...state,
            data
        }
    }
}

export class Resource<D extends ResourceDefinition> implements ResourceInstance<D> {
    readonly _queriesCache = new QueriesCache<D['Args'], CoreResourceQueryState<D>>('res');

    constructor(
        private readonly _options: ResourceCreateOptions<D>) {
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
        return this._queriesCache.createQueryCache(args, ResourceQueryState.create<D>());
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

    updateData(args: D['Args'], updateFn: (data: D['Data']) => D['Data'], options?: { cache?: CoreResourceQueryCache<D> }) {
        let cache = options?.cache ?? this.getQueryCache(args);
        if (!cache) {
            return null;
        }
        const cacheValue = cache.value;

        if (!cacheValue.isDone) {
            return cache;
        }

        const newData = updateFn(cacheValue.data!);
        cache.next(ResourceQueryState.setData(cache.value, newData));
        return cache;
    }

    initiate(args: D['Args'], options?: { cache?: CoreResourceQueryCache<D> }): CoreResourceQueryCache<D> {
        let cache = options?.cache ?? this._queriesCache.getQueryCache(args);
        const state = ResourceQueryState.load(cache?.value, args);

        if (!cache) {
            cache = this._queriesCache.createQueryCache(args, state);
        } else {
            cache.next(state);
        }

        let abortController = state.abortController;
        abortController?.abort();
        abortController = new AbortController();

        const query = this._options.queryFn(args, { abortSignal: abortController.signal });

        query
            .then((data) => {
                if (abortController.signal.aborted) {
                    return;
                }

                const selectedData = this._options.select ? this._options.select(data) : data;
                cache.next(ResourceQueryState.success(state, selectedData));
            })
            .catch((error) => {
                if (abortController.signal.aborted) {
                    return;
                }

                SharedOptions.onError?.(error);
                cache.next(ResourceQueryState.error(state, error));
            });

        return cache;
    }
}

