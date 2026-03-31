import { PromiseResolver } from "@/common/utils/PromiseResolver";
import { CacheEntry } from "@/query-v2/core/CacheEntry";
import { CommandIdle } from "@/query-v2/core/machines/CommandIdle";
import { CommandLoading } from "@/query-v2/core/machines/CommandLoading";
import type { CommandV2Link, IPatchHandle, TCommandMachineInstance, TCommandQueryFn } from "@/query-v2/types";
import type {
    ICommandCacheEntryAddedTools,
    ICommandQueryStartedTools,
    TOnCommandCacheEntryAdded,
    TOnCommandQueryStarted,
} from "@/query-v2/types/command-lifecycle.types";
import { Batcher } from "@/signals/base/Batcher";

import { ResourceV2Ref } from "./ResourceV2Ref";

export interface ICommandV2CacheEntryOptions<TArgs, TResult> {
    queryFn: TCommandQueryFn<TArgs, TResult>;
    link?: CommandV2Link<TArgs, TResult>[];
    onCacheEntryAdded?: TOnCommandCacheEntryAdded<TResult>;
    onQueryStarted?: TOnCommandQueryStarted<TArgs, TResult>;
    cacheLifetime?: number | false;
}

export class CommandV2CacheEntry<TArgs, TResult> extends CacheEntry<TCommandMachineInstance<TArgs, TResult>> {
    private _queryFn: TCommandQueryFn<TArgs, TResult>;
    private _link: CommandV2Link<TArgs, TResult>[];
    private _abortController: AbortController | null = null;
    private _onCacheEntryAdded: TOnCommandCacheEntryAdded<TResult> | undefined;
    private _onQueryStarted: TOnCommandQueryStarted<TArgs, TResult> | undefined;
    private _entryDataLoaded: PromiseResolver<TResult> | null = null;
    private _entryRemoved: PromiseResolver<void> | null = null;
    private _queryFulfilled: PromiseResolver<{ data: TResult }> | null = null;
    private _triggerResolver: PromiseResolver<TResult> | null = null;

    constructor(options: ICommandV2CacheEntryOptions<TArgs, TResult>) {
        super(
            new CommandIdle<TArgs, TResult>(),
            options.cacheLifetime !== undefined ? { cacheLifetime: options.cacheLifetime } : undefined,
        );
        this._queryFn = options.queryFn;
        this._link = options.link ?? [];
        this._onCacheEntryAdded = options.onCacheEntryAdded;
        this._onQueryStarted = options.onQueryStarted;

        this._fireCacheEntryAdded();
    }

    initiate(args: TArgs): Promise<TResult> {
        // Abort previous inflight
        if (this._abortController) {
            this._abortController.abort();
        }

        // Reject previous trigger promise with AbortError
        if (this._triggerResolver) {
            this._triggerResolver.reject(new DOMException("The operation was aborted.", "AbortError"));
            this._triggerResolver = null;
        }

        // Create new AbortController
        const controller = new AbortController();
        this._abortController = controller;

        // Create trigger promise
        const triggerResolver = new PromiseResolver<TResult>();
        this._triggerResolver = triggerResolver;

        // Transition machine → loading
        const machine = this.peek();
        if (machine.status === "idle" || machine.status === "success" || machine.status === "error") {
            this.set(machine.start(args));
        } else if (machine.status === "loading") {
            // Re-initiate while loading — create new loading with new args
            this.set(new CommandLoading<TArgs, TResult>(args));
        }

        // Apply optimistic updates on linked resources
        const optimisticHandles: IPatchHandle[] = [];
        for (const linkDef of this._link) {
            if (linkDef.optimisticUpdate) {
                const ref = new ResourceV2Ref(linkDef.resource, linkDef.forwardArgs(args));
                const handle = ref.patch((draft) => {
                    linkDef.optimisticUpdate!({ draft, args });
                });
                if (handle) {
                    optimisticHandles.push(handle);
                }
            }
        }

        // Lifecycle: reject leftover _queryFulfilled before creating new one
        if (this._queryFulfilled) {
            this._queryFulfilled.reject(new Error("Query superseded"));
            this._queryFulfilled = null;
        }

        // Fire onQueryStarted
        if (this._onQueryStarted) {
            this._queryFulfilled = new PromiseResolver<{ data: TResult }>();

            const tools: ICommandQueryStartedTools<TResult> = {
                $queryFulfilled: this._queryFulfilled.promise,
            };

            try {
                this._onQueryStarted(args, tools);
            } catch {
                // Callback errors caught
            }
        }

        // Call queryFn
        let queryResult: Promise<TResult>;
        try {
            queryResult = this._queryFn(args, { abortSignal: controller.signal });
        } catch (syncError) {
            this._abortController = null;
            Batcher.run(() => {
                this.set(
                    this.peek().status === "loading"
                        ? (this.peek() as any).errorHappened(syncError)
                        : new CommandIdle<TArgs, TResult>(),
                );
            });

            // Abort optimistic patches
            for (const handle of optimisticHandles) {
                handle.abort();
            }

            if (this._queryFulfilled) {
                this._queryFulfilled.reject(syncError);
                this._queryFulfilled = null;
            }

            triggerResolver.reject(syncError);
            this._triggerResolver = null;
            return triggerResolver.promise;
        }

        queryResult.then(
            (data) => {
                // Stale check: a newer query has started
                if (controller.signal.aborted) return;

                this._abortController = null;

                Batcher.run(() => {
                    // Transition → success
                    const current = this.peek();
                    if (current.status === "loading") {
                        this.set(current.successHappened(data));
                    }

                    // Commit optimistic patches
                    for (const handle of optimisticHandles) {
                        handle.commit();
                    }

                    // Apply update patches on linked resources
                    for (const linkDef of this._link) {
                        if (linkDef.update) {
                            const ref = new ResourceV2Ref(linkDef.resource, linkDef.forwardArgs(args));
                            const updateHandle = ref.patch((draft) => {
                                linkDef.update!({ draft, args, data });
                            });
                            if (updateHandle) {
                                updateHandle.commit();
                            }
                        }
                    }

                    // Invalidate linked resources
                    for (const linkDef of this._link) {
                        if (linkDef.invalidate) {
                            const ref = new ResourceV2Ref(linkDef.resource, linkDef.forwardArgs(args));
                            ref.invalidate();
                        }
                    }
                });

                // Resolve _entryDataLoaded on first success only
                if (this._entryDataLoaded) {
                    this._entryDataLoaded.resolve(data);
                    this._entryDataLoaded = null;
                }

                // Resolve _queryFulfilled
                if (this._queryFulfilled) {
                    this._queryFulfilled.resolve({ data });
                    this._queryFulfilled = null;
                }

                // Resolve trigger promise
                triggerResolver.resolve(data);
                if (this._triggerResolver === triggerResolver) {
                    this._triggerResolver = null;
                }
            },
            (error) => {
                // Stale check
                if (controller.signal.aborted) return;

                this._abortController = null;

                Batcher.run(() => {
                    // Transition → error
                    const current = this.peek();
                    if (current.status === "loading") {
                        this.set(current.errorHappened(error));
                    }

                    // Abort optimistic patches
                    for (const handle of optimisticHandles) {
                        handle.abort();
                    }
                });

                // Reject _queryFulfilled
                if (this._queryFulfilled) {
                    this._queryFulfilled.reject(error);
                    this._queryFulfilled = null;
                }

                // Reject trigger promise
                triggerResolver.reject(error);
                if (this._triggerResolver === triggerResolver) {
                    this._triggerResolver = null;
                }
            },
        );

        return triggerResolver.promise;
    }

    resetToIdle(): void {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }

        if (this._triggerResolver) {
            this._triggerResolver.reject(new DOMException("The operation was aborted.", "AbortError"));
            this._triggerResolver = null;
        }

        this.set(new CommandIdle<TArgs, TResult>());
    }

    override complete(): void {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }

        if (this._triggerResolver) {
            this._triggerResolver.reject(new Error("Cache entry removed"));
            this._triggerResolver = null;
        }

        if (this._entryDataLoaded) {
            this._entryDataLoaded.reject(new Error("Cache entry removed before data loaded"));
            this._entryDataLoaded = null;
        }
        if (this._entryRemoved) {
            this._entryRemoved.resolve();
            this._entryRemoved = null;
        }
        if (this._queryFulfilled) {
            this._queryFulfilled.reject(new Error("Cache entry removed"));
            this._queryFulfilled = null;
        }

        super.complete();
    }

    private _fireCacheEntryAdded(): void {
        if (!this._onCacheEntryAdded) return;

        this._entryDataLoaded = new PromiseResolver<TResult>();
        this._entryRemoved = new PromiseResolver<void>();

        const tools: ICommandCacheEntryAddedTools<TResult> = {
            $cacheDataLoaded: this._entryDataLoaded.promise,
            $cacheEntryRemoved: this._entryRemoved.promise,
        };

        try {
            this._onCacheEntryAdded(tools);
        } catch {
            // Callback errors caught
        }
    }
}
