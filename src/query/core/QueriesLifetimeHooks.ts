import { Subject } from "rxjs";
import { SharedOptions } from "@/common/options/SharedOptions";
import { PromiseResolver } from "@/common/utils";
import { DevtoolsStateLike } from "@/common/devtools";
import { Indexer } from "@/signals/base/Indexer";
import { OnCacheEntryAdded, OnQueryStarted } from "@/query/types";

type Options<ARGS, DATA> = {
    onCacheEntryAdded?: OnCacheEntryAdded<ARGS, DATA>;
    onQueryStarted?: OnQueryStarted<ARGS, DATA>;
}

export class QueriesLifetimeHooks<ARGS, DATA> {
    private onCacheEntryAddedListeners: Array<OnCacheEntryAdded<ARGS, DATA>> = [];
    private onQueryStartedListeners: Array<OnQueryStarted<ARGS, DATA>> = [];

    constructor(
        options: Options<ARGS, DATA> | undefined,
        devtoolName: string | undefined,
    ) {
        if (options?.onCacheEntryAdded) {
            this.onCacheEntryAddedListeners.push(options.onCacheEntryAdded);
        }
        if (options?.onQueryStarted) {
            this.onQueryStartedListeners.push(options.onQueryStarted);
        }

        if (devtoolName) {
            const stateDevtools = SharedOptions.DEVTOOLS?.state;

            if (stateDevtools) {

                this.onCacheEntryAddedListeners.push(async (args, { $cacheEntryRemoved, dataChanged$ }) => {
                    const key = `${devtoolName}:${JSON.stringify(args)}:i=${Indexer.getIndex()}`;

                    let devtools: DevtoolsStateLike | null = null;

                    dataChanged$.subscribe((state) => {
                        if (!devtools) {
                            devtools = stateDevtools(key, state);
                            return;
                        }

                        devtools!(state);
                    });

                    $cacheEntryRemoved.then(() => {
                        devtools!('$CLEANED' as any);
                    });
                });
            }
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
