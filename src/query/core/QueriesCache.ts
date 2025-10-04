import { IndirectMap } from "query/lib/IndirectMap";
import { ReactiveCache } from "query/lib/ReactiveCache";
import { Indexer } from "signals/base/Indexer";
import { SharedOptions } from "./SharedOptions";

export class QueriesCache<KEY, VALUE> {
    private readonly _cache = new IndirectMap<KEY, ReactiveCache<VALUE>>();

    constructor(private _logname = 'query') {
    }

    getQueryCache(args: KEY): ReactiveCache<VALUE> | undefined {
        return this._cache.get(args);
    }

    createQueryCache(args: KEY, initialState: VALUE): ReactiveCache<VALUE> {
        const cache = new ReactiveCache<VALUE>({
            initialState,
        });

        const stateDevtools = SharedOptions.DEVTOOLS?.state;

        if (stateDevtools) {
            const key = `${this._logname}:${JSON.stringify(args)}:i=${Indexer.getIndex()}`;
            let devtools = stateDevtools(key, initialState);

            cache.spy$.subscribe((state) => {
                if (state === initialState) return;
                devtools(state);
            });

            cache.onClean$.subscribe(() => {
                devtools('$CLEANED' as any);
            });
        }

        cache.onClean$.subscribe(() => {
            this._cache.delete(args);
        });

        this._cache.set(args, cache);

        return cache;
    }
}
