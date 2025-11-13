import { Subject } from "rxjs";
import { SharedOptions } from "@/common/options/SharedOptions";
import { PromiseResolver } from "@/common/utils";
import { DevtoolsStateLike } from "@/common/devtools";
import { OnCacheEntryAdded, OnQueryStarted } from "@/query/types";
import { Devtools } from "@/signals";

type Options<ARGS, DATA> = {
    onCacheEntryAdded?: OnCacheEntryAdded<ARGS, DATA>;
    onQueryStarted?: OnQueryStarted<ARGS, DATA>;
    devtoolsName?: string | false;
}

export class QueriesLifetimeHooks<ARGS, DATA> {
    private onCacheEntryAddedListeners: Array<OnCacheEntryAdded<ARGS, DATA>> = [];
    private onQueryStartedListeners: Array<OnQueryStarted<ARGS, DATA>> = [];

    constructor(
        options: Options<ARGS, DATA> | undefined,
    ) {
        if (options?.onCacheEntryAdded) {
            this.onCacheEntryAddedListeners.push(options.onCacheEntryAdded);
        }

        if (options?.onQueryStarted) {
            this.onQueryStartedListeners.push(options.onQueryStarted);
        }

        const devtoolsName = options?.devtoolsName;

        if (devtoolsName !== false && Devtools.hasDevtools) {
            this.onCacheEntryAddedListeners.push(async (_, { $cacheEntryRemoved, dataChanged$ }) => {
                let stateDevtools: DevtoolsStateLike | null = null;

                dataChanged$.subscribe((state) => {
                    if (!stateDevtools) {
                        stateDevtools = Devtools.createState(state, {
                            base: 'Queries',
                            name: devtoolsName || '',
                        });
                        return;
                    }

                    stateDevtools(state);
                });

                $cacheEntryRemoved.then(() => {
                    stateDevtools!('$CLEANED' as any);
                });
            });
        }

        if (SharedOptions.onQueryError) {
            this.onQueryStartedListeners.push(async (_, { $queryFulfilled }) => {
                const result = await $queryFulfilled;
                if (result.isError) SharedOptions.onQueryError!(result.error);
            });
        }
    }

    onCacheEntryAdded = (args: ARGS) => {
        const cacheDataLoadedResolver = new PromiseResolver<void>();
        const cacheEntryRemovedResolver = new PromiseResolver<void>();
        const dataChanged$ = new Subject<DATA>(); // TODO не нравится мне это, мб передавать $spy в аргументы?

        cacheEntryRemovedResolver.promise.finally(() => {
            dataChanged$.complete();
        });

        this.onCacheEntryAddedListeners.forEach((listener) => {
            listener(args, {
                $cacheDataLoaded: cacheDataLoadedResolver.promise,
                $cacheEntryRemoved: cacheEntryRemovedResolver.promise,
                dataChanged$,
            });
        });

        return {
            cacheDataLoaded: () => cacheDataLoadedResolver.resolve(),
            cacheEntryRemoved: () => cacheEntryRemovedResolver.resolve(),
            dataChanged$,
        };
    }

    onQueryStarted = (args: ARGS) => {
        const queryFulfilledResolver = new PromiseResolver<{
            data: DATA,
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
            fulfilledSuccess: (data: DATA) => {
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
