import { ResourceDefinition } from "@/query/types";
import { CoreResourceQueryCache, CoreResourceQueryState, Resource } from "./Resource";
import { Signal, signalize } from "@/signals";
import { ReadableSignalLike } from "@/signals/types";
import { finalize, Observable, ReplaySubject, share, Subject, takeUntil, timer } from "rxjs";
import { ResourceDuplicatorAgent } from "./ResourceDuplicatorAgent";

export type DuplicatorOptions<D extends DuplicatorDefinition> = {
    resource: Resource<D['RESOURCE_DEFINITION']>;
    getArgKey: (item: D['ARGS_ITEM']) => string | number
    getDataKey: (item: D['DATA_ITEM']) => string | number
    cacheLifetime?: number | false;
}

type FrowardInfo<D extends ResourceDefinition> = {
    k: number;
    cache: CoreResourceQueryCache<D>
}

export type DuplicatorDefinition<
    D extends ResourceDefinition = ResourceDefinition
> = {
    ARGS_ITEM: D['Args'] extends Array<any> ? D['Args'][number] : never;
    DATA_ITEM: D['Data'] extends Array<any> ? D['Data'][number] : never;
    RESOURCE_DEFINITION: D;
}

type State<D extends DuplicatorDefinition> = CoreResourceQueryState<D['RESOURCE_DEFINITION']> & {
    unreleasedArgs?: D['ARGS_ITEM'][];
}
type Cache<D extends DuplicatorDefinition> = ComputedReactiveCache<State<D>>;
export type CoreResourceDuplicatorCache<D extends DuplicatorDefinition> = Cache<D>;

export class ResourceDuplicator<D extends DuplicatorDefinition> {
    private _fis = new Map<string | number, FrowardInfo<D['RESOURCE_DEFINITION']>>();
    private _caches;
    private get _resource() {
        return this._options.resource;
    }

    constructor(
        private _options: DuplicatorOptions<D>
    ) {
        this._caches = new Map<string, ComputedReactiveCache<State<D>>>();
    }

    getQueryCache(args: D['ARGS_ITEM'][]): Cache<D> | undefined {
        const key = this.serialize(args);
        return this._caches.get(key);
    }

    createCache(args: D['ARGS_ITEM'][]): Cache<D> {
        const key = this.serialize(args);

        const { value$ } = this.d_init(args);

        const cache = new ComputedReactiveCache<State<D>>({
            cacheLifeTime: this._options.cacheLifetime ?? 60_000,
            getValue: () => value$.get(),
            obs: value$.obs,
        });

        cache.onClean$.subscribe(() => {
            args.forEach(arg => {
                const argKey = this._options.getArgKey(arg);
                const fi = this._fis.get(argKey);
                if (!fi) return;
                fi.k--;
                if (fi.k <= 0) {
                    this._fis.delete(argKey);
                }
            });
            this._caches.delete(key);
        });

        this._caches.set(key, cache);

        return cache;
    }

    initiate(args: D['ARGS_ITEM'][], cache?: Cache<D>): Cache<D> {
        const cacheInstance = cache ?? this.getQueryCache(args) ?? this.createCache(args);

        const unreleasedArgs = cacheInstance.value.unreleasedArgs;

        if (unreleasedArgs && unreleasedArgs.length !== 0) {
            this._resource.initiate(unreleasedArgs);
        }

        const uninitiatedCaches = new Set<CoreResourceQueryCache<D['RESOURCE_DEFINITION']>>();

        args.forEach(arg => {
            const argKey = this._options.getArgKey(arg);
            let fi = this._fis.get(argKey);
            if (fi && !fi.cache.value.isInitiated) {
                uninitiatedCaches.add(fi.cache);
            }
        });

        uninitiatedCaches.forEach((c) => {
            this._resource.initiate(c.value.args, { cache: c });
        });

        return cacheInstance;
    }

    serialize(args: D['ARGS_ITEM'][]): string {
        if (!args) return '';
        const argsKeys = args.map(a => this._options.getArgKey(a));
        return argsKeys.join('|');
    }

    compareArgs(a: D['ARGS_ITEM'][], b: D['ARGS_ITEM'][]): boolean {
        return this.serialize(a) === this.serialize(b);
    }

    createAgent = () => {
        return new ResourceDuplicatorAgent<D>(this);
    }

    /** @deprecated */
    d_init(args: D['ARGS_ITEM'][]) {
        const argsKeys = args.map(a => this._options.getArgKey(a));
        const releasedCaches = new Set<CoreResourceQueryCache<D['RESOURCE_DEFINITION']>>();
        const unreleasedArgs: D['ARGS_ITEM'][] = [];

        args.forEach(arg => {
            const argKey = this._options.getArgKey(arg);
            let fi = this._fis.get(argKey);
            if (!fi || !fi.cache.value.isInitiated) {
                unreleasedArgs.push(arg);
                return;
            }
            fi.k++;
            releasedCaches.add(fi.cache);
        });

        const queryCache = unreleasedArgs?.length > 0
            ? this._resource.createQueryCache(unreleasedArgs)
            : null;

        unreleasedArgs.forEach(arg => {
            const argKey = this._options.getArgKey(arg);
            let fi = this._fis.get(argKey);
            if (!fi) {
                fi = {
                    k: 1,
                    cache: queryCache!,
                };
                this._fis.set(argKey, fi);
            }
        });

        return {
            value$: Signal.compute<State<D>>(() => {
                const itemsAcc: State<D>[] = [];

                if (queryCache) {
                    itemsAcc.push(queryCache.value$.get());
                }

                for (const rc of releasedCaches) {
                    itemsAcc.push(rc.value$.get());
                }

                const isNotInitiated = itemsAcc.some(i => !i.isInitiated);

                const baseReturn = {
                    transactions: null,
                    abortController: null,
                    args,
                    savedData: null,
                    data: null,
                    error: null,
                    isError: false,
                    isLoading: false,
                    isReloading: false,
                    isDone: false,
                    isSuccess: false,
                    isLocked: false,
                    isInitiated: true,
                    lockCount: 0,
                    unreleasedArgs,
                };

                if (isNotInitiated) return {
                    ...baseReturn,
                    isInitiated: false,
                }

                const isError = itemsAcc.some(i => i.isError);

                if (isError) {
                    const firstError = itemsAcc.find(i => i.isError)!;
                    return {
                        ...baseReturn,
                        isError: true,
                        isDone: true,
                        error: firstError.error,
                    }
                }

                const isLoading = itemsAcc.some(i => i.isLoading);

                if (isLoading) return {
                    ...baseReturn,
                    isLoading: true,
                }

                const dataAcc: D['DATA_ITEM'][] = [];

                itemsAcc.forEach(item => {
                    item.data?.forEach((d: any[]) => {
                        const dataKey = this._options.getDataKey(d);
                        const index = argsKeys.findIndex(ak => ak === dataKey);
                        if (index === -1) return;
                        dataAcc[index] = d;
                    });
                });

                return {
                    ...baseReturn,
                    isSuccess: true,
                    isDone: true,
                    data: dataAcc,
                };
            }, { isDisabled: true }),
        }
    }
}

export class ComputedReactiveCache<T> {

    /**
     * Реактивное значене (Observable)
     */
    public value$: ReadableSignalLike<T>;

    /**
     * Значение без сайд-эффектов (для использования в DevTools)
     */
    public spy$: Observable<T>;

    /**
     * Subject, уведомляющий об очистке кэша.
     */
    public onClean$ = new Subject<T>();

    public closed = false;

    private _getValue;

    /**
     * Создает новый экземпляр `ReactiveCacheItem`.
     *
     * @param options Параметры для настройки элемента кэша.
     * @param options.initialState Начальное состояние кэша.
     * @param options.cacheLifeTime Время жизни кэша в миллисекундах (по умолчанию 60_000).
     */
    constructor(options: {
        obs: Observable<T>;
        getValue: () => T;
        cacheLifeTime: number | false;
    }) {
        const cacheLifeTime = options.cacheLifeTime ?? 60_000;
        this.spy$ = options.obs.pipe(
            takeUntil(this.onClean$)
        );

        this.value$ = signalize(options.obs.pipe(
            finalize(() => {
                this.complete();
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: this._getOnRefCountZero(cacheLifeTime),
                resetOnComplete: true,
            }),
        ))

        this._getValue = options.getValue;
    }

    private _getOnRefCountZero(cacheLifeTime: number | false) {
        if (cacheLifeTime === false) {
            return false;
        }

        if (cacheLifeTime <= 0) {
            return true;
        }

        return () => {
            return timer(cacheLifeTime);
        };
    }

    get value(): T {
        return this._getValue();
    }

    /**
     * Завершает работу кэша, закрывая все потоки и уведомляя об очистке.
     */
    complete() {
        if (this.closed) return;
        this.closed = true;
        this.onClean$.next(this._getValue());
        this.onClean$.complete();
    }

}
