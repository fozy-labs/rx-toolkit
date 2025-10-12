import { PromiseResolver } from "@/common/utils";
import { SharedOptions } from "@/common/options/SharedOptions";

import type { ReactiveCache } from "@/query/lib/ReactiveCache";
import type {
    FallbackOnNever, ResourceTransaction, LinkOptions,
    OperationCreateOptions, OperationDefinition, OperationInstance,
} from "@/query/types";

import { QueriesCache } from "../QueriesCache";
import { OperationAgent } from "./OperationAgent";

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
    readonly _queriesCache = new QueriesCache<D['Args'], CoreOperationQueryState<D>>(
        60_000,
        'Operation'
    );
    private _links: LinkOptions<D, any>[] = [];

    constructor(
        private readonly _options: OperationCreateOptions<D>
    ) {
        this._createLinks();
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

    createQueryCache(args: D['Args']): ReactiveCache<CoreOperationQueryState<D>> {
        return this._queriesCache.createQueryCache(args, OperationQueryState.create<D>());
    }

    initiate(args: D['Args'], options?: { cache?: ReactiveCache<CoreOperationQueryState<D>> }): ReactiveCache<CoreOperationQueryState<D>> {
        let cache = options?.cache ?? this._queriesCache.getQueryCache(args);
        const state = OperationQueryState.load(cache?.value, args);

        if (!cache) {
            cache = this._queriesCache.createQueryCache(args, state);
        } else {
            cache.next(state);
        }

        const linksMeta = this._links.map(link => {
            const forwardedArgs = link.forwardArgs(args);
            const ref = link.resource.createRef(forwardedArgs);
            return { link, ref, state: {} as { unlocker?: { unlock: () => void }, patch: ResourceTransaction | null } };
        });

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

        const query = this._options.queryFn(args);

        query
            .then((result) => {
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

                    state.patch?.commit();
                });
            })
            .catch((error) => {
                SharedOptions.onError?.(error);
                cache.next(OperationQueryState.error(state, error));

                /**
                 * Обновляем связанные ресурсы
                 */
                linksMeta.forEach(({ state }) => {
                    state.patch?.abort();
                });
            })
            .finally(() => {

                /**
                 * Обновляем связанные ресурсы
                 */
                linksMeta.forEach(({ state }) => {
                    state.unlocker?.unlock();
                });
            });

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
