import { IndirectMap } from "query/lib/IndirectMap";
import { ReactiveCache } from "query/lib/ReactiveCache";
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

        const devtoolsState = SharedOptions.DEVTOOLS?.state;

        if (devtoolsState) {
            const randomId = Math.random().toString(36).substring(2, 16);
            const key = `rxt:${this._logname}:${JSON.stringify(args)}:${randomId}`;

            cache.spy$.subscribe((state) => {
                devtoolsState(key, state);
            });
        }

        cache.onClean$.subscribe(() => {
            this._cache.delete(args);
        });

        this._cache.set(args, cache);

        return cache;
    }
}
