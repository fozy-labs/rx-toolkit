import { PromiseResolver } from "@/common/utils";
import { Batcher } from "@/signals";
import type { ReactiveCache } from "@/query/lib/ReactiveCache";
import type {
    FallbackOnNever, ResourceTransaction, LinkOptions,
    OperationCreateOptions, OperationDefinition, OperationInstance,
} from "@/query/types";

import { QueriesCache } from "../QueriesCache";
import { QueriesLifetimeHooks } from "../QueriesLifetimeHooks";
import { OperationAgent } from "./OperationAgent";
import { CleanAllQueriesSignal } from "@/query/core/CleanAllQueriesSignal";

export type CoreOperationQueryState<D extends OperationDefinition> = {
    arg: D['Args'] | null;
    data: FallbackOnNever<D['Selected'], D['Result']> | null;
    error: unknown | null;
    isError: boolean;
    isLoading: boolean;
    isRepeating: boolean;
    isDone: boolean;
    isSuccess: boolean;
    isInitiated: boolean;
}

class OperationQueryState {
    static create<D extends OperationDefinition>(): CoreOperationQueryState<D> {
        return {
            arg: null,
            data: null,
            error: null,
            isError: false,
            isRepeating: false,
            isDone: false,
            isSuccess: false,
            isLoading: false,
            isInitiated: false,
        };
    }

    static load<D extends OperationDefinition>(
        state: CoreOperationQueryState<D> = OperationQueryState.create<D>(),
        args: D['Args'],
    ): CoreOperationQueryState<D> {
        return {
            ...state,
            arg: args,
            isLoading: true,
            isRepeating: state.isDone,
            isInitiated: true,
        };
    }

    static success<D extends OperationDefinition>(
        state: CoreOperationQueryState<D>,
        data: FallbackOnNever<D['Selected'], D['Result']>
    ): CoreOperationQueryState<D> {
        return {
            ...state,
            data,
            isLoading: false,
            isRepeating: false,
            isDone: true,
            isSuccess: true,
            isError: false,
            error: null,
        };
    }

    static error<D extends OperationDefinition>(
        state: CoreOperationQueryState<D>,
        error: unknown,
    ): CoreOperationQueryState<D> {
        return {
            ...state,
            isLoading: false,
            isRepeating: false,
            isDone: true,
            isSuccess: false,
            isError: true,
            error,
        };
    }
}

export class Operation<D extends OperationDefinition> implements OperationInstance<D> {
    private _queriesCache;
    private _hooks;
    private _links: LinkOptions<D, any>[] = [];

    private _DEFAULT_CACHE_LIFETIME = 1_000;

    constructor(
        private readonly _options: OperationCreateOptions<D>
    ) {
        this._queriesCache = new QueriesCache<D['Args'], CoreOperationQueryState<D>>(
            this._options.cacheLifetime ?? this._DEFAULT_CACHE_LIFETIME,
        );

        this._hooks = new QueriesLifetimeHooks<D['Args'], D['Data']>({
            onCacheEntryAdded: _options.onCacheEntryAdded,
            onQueryStarted: _options.onQueryStarted,
            devtoolsName: _options.devtoolsName,
        });

        this._createLinks();

        CleanAllQueriesSignal.clean$.subscribe(() => {
            this._queriesCache.clear();
        });
    }

    private _createLinks() {
        this._options.link?.((linkOptions) => {
            this._links.push(linkOptions);
        });
    }

    createAgent() {
        return new OperationAgent<D>(this);
    }

    getQueryCache(args: D['Args']): ReactiveCache<CoreOperationQueryState<D>> | undefined {
        return this._queriesCache.getQueryCache(args);
    }

    createQueryCache(args: D['Args'], state: CoreOperationQueryState<D> = OperationQueryState.create()): ReactiveCache<CoreOperationQueryState<D>> {
        const cache = this._queriesCache.createQueryCache(args, state);

        const hookResolvers = this._hooks.onCacheEntryAdded(args);

        const spySub = cache.spy$.subscribe((state) => {
            if (!state.isDone) return;
            hookResolvers.cacheDataLoaded();
            spySub.unsubscribe();
        });

        cache.spy$.subscribe((state) => {
            hookResolvers.dataChanged$.next(state);
        });

        cache.onClean$.subscribe(() => {
            hookResolvers.cacheEntryRemoved();
        });

        return cache;
    }

    initiate(args: D['Args'], options?: { cache?: ReactiveCache<CoreOperationQueryState<D>> }): ReactiveCache<CoreOperationQueryState<D>> {
        return Batcher.batch(() => this._initiate(args, options));
    }

    private _initiate(args: D['Args'], options?: { cache?: ReactiveCache<CoreOperationQueryState<D>> }): ReactiveCache<CoreOperationQueryState<D>> {
        let cache = options?.cache ?? this.getQueryCache(args);
        const state = OperationQueryState.load(cache?.value, args);

        if (!cache) {
            cache = this.createQueryCache(args, state);
        } else {
            cache.next(state);
        }

        const linksMeta = this._links.map(link => {
            const forwardedArgs = link.forwardArgs(args);
            const ref = link.resource.createRef(forwardedArgs);
            return { link, ref, state: {} as { unlocker?: { unlock: () => void }, patch: ResourceTransaction | null } };
        });

        const query = this._options.queryFn(args);

        const hookResolvers = this._hooks.onQueryStarted(args);

        linksMeta.forEach(({ link, ref, state }) => {
            if (link.lock) {
                state.unlocker = ref.lock();
            }

            if (link.optimisticUpdate && ref.has) {
                state.patch = ref.patch((draft) => {
                    return link.optimisticUpdate!({ draft, args });
                });
            }
        });

        query
            .then((result) => {
                Batcher.batch(() => {
                    const data: D['Data'] = this._options.select ? this._options.select(result) : result;
                    cache.next(OperationQueryState.success(state, data));

                    /**
                     * Обновляем связанные ресурсы
                     */
                    linksMeta.forEach(({ link, ref, state }) => {
                        if (link.update && ref.has) {
                            // TODO подумать, нужно ли добавлять обработку, если patch() -> null (и в принце про работу patch)
                            ref.patch((draft) => {
                                return link.update!({ draft, args, data });
                            })?.commit();
                        }

                        if (link.create && !ref.has) {
                            ref.create(link.create({ args, data }));
                        }

                        if (link.invalidate) {
                            ref.invalidate();
                        }

                        state.patch?.commit();
                    });

                    hookResolvers.fulfilledSuccess(data);

                    /**
                     * Обновляем связанные ресурсы
                     */
                    linksMeta.forEach(({ state }) => {
                        state.unlocker?.unlock();
                    });
                });
            })
            .catch((error) => {
                Batcher.batch(() => {
                    cache.next(OperationQueryState.error(state, error));

                    /**
                     * Обновляем связанные ресурсы
                     */
                    linksMeta.forEach(({ state }) => {
                        state.patch?.abort();
                    });

                    hookResolvers.fulfilledError(error);

                    /**
                     * Обновляем связанные ресурсы
                     */
                    linksMeta.forEach(({ state }) => {
                        state.unlocker?.unlock();
                    });
                });
            })

        return cache;
    }

    /**
     * Используеются для обртной совместимости, а надо ли менять что-то - хз
     * @deprecated
     */
    mutate(args: D['Args']): Promise<D['Data']> {
        const cache = this.initiate(args);
        const resolver = new PromiseResolver<D['Data']>();

        const subscription = cache.value$.subscribe((state) => {
            if (!state.isInitiated || state.isLoading || state.isRepeating) return;

            if (state.isError) {
                resolver.reject(state.error);
                return;
            }

            if (!state.isSuccess) {
                console.error("Unexpected state in mutation:", state);
                resolver.reject(new Error("Unexpected state in mutation"));
                return;
            }

            resolver.resolve(state.data as D['Data']);
        });

        resolver.promise.finally(() => {
            subscription.unsubscribe();
        });

        return resolver.promise;
    }
}
