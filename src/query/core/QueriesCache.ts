import { IndirectMap } from "@/query/lib/IndirectMap";
import { ReactiveCache } from "@/query/lib/ReactiveCache";
import { shallowEqual } from "@/common/utils";

export class QueriesCache<KEY, VALUE> {
    private readonly _cache;

    constructor(
        private _cacheLifeTime: number | false = 60_000,
        compareArgsFn = shallowEqual,
    ) {
        this._cache = new IndirectMap<KEY, ReactiveCache<VALUE>>(compareArgsFn);
    }

    getQueryCache(args: KEY): ReactiveCache<VALUE> | undefined {
        return this._cache.get(args);
    }

    createQueryCache(args: KEY, initialState: VALUE): ReactiveCache<VALUE> {
        const cache = new ReactiveCache<VALUE>({
            initialState,
            cacheLifeTime: this._cacheLifeTime,
        });

        cache.onClean$.subscribe(() => {
            this._cache.delete(args);
        });

        this._cache.set(args, cache);

        return cache;
    }

    clear() {
        // Делаем именно так, тк при очистке могут синхронно добавляться новые кеши
        const values = Array.from(this._cache.values);
        values.forEach(c => {
            c.complete()
        });
    }
}
