import { IndirectMap } from "@/query/lib/IndirectMap";
import { ReactiveCache } from "@/query/lib/ReactiveCache";

export class QueriesCache<KEY, VALUE> {
    private readonly _cache = new IndirectMap<KEY, ReactiveCache<VALUE>>();

    constructor(
        private _cacheLifeTime: number | false = 60_000,
        private _logname = 'query',
    ) {
    }

    getQueryCache(args: KEY): ReactiveCache<VALUE> | undefined {
        return this._cache.get(args);
    }

    createQueryCache(args: KEY, initialState: VALUE): ReactiveCache<VALUE> {
        const cache = new ReactiveCache<VALUE>({
            initialState,
            cacheLifeTime: this._cacheLifeTime,
        });

        // const stateDevtools = SharedOptions.DEVTOOLS?.state;
        //
        // if (stateDevtools) {
        //     const key = `${this._logname}:${JSON.stringify(args)}:i=${Indexer.getIndex()}`;
        //     let devtools = stateDevtools(key, initialState);
        //
        //     cache.spy$.subscribe((state) => {
        //         if (state === initialState) return;
        //         devtools(state);
        //     });
        //
        //     cache.onClean$.subscribe(() => {
        //         devtools('$CLEANED' as any);
        //     });
        // }

        cache.onClean$.subscribe(() => {
            this._cache.delete(args);
        });

        this._cache.set(args, cache);

        return cache;
    }
}
