import { PromiseResolver } from "@/common/utils/PromiseResolver";
import { CacheEntry } from "@/query-v2/core/CacheEntry";
import { MachineError, MachinePending, MachineRefreshing, MachineSuccess, Patcher } from "@/query-v2/core/machines";
import type {
    ICacheEntryAddedTools,
    ICacheEntryOptions,
    IPatchHandle,
    IQueryStartedTools,
    IResourceV2CacheEntry,
    TCompareArgsFn,
    TMachineInstance,
    TOnCacheEntryAdded,
    TOnQueryStarted,
    TPatch,
    TPatchState,
    TQueryFn,
} from "@/query-v2/types";
import type { ReadableSignalFnLike } from "@/signals/types";

export interface IResourceV2CacheEntryOptions<TArgs, TData> {
    args: TArgs;
    argsKey: string;
    queryFn: TQueryFn<TArgs, TData>;
    compareArgs: TCompareArgsFn<TArgs>;
    entryOptions?: ICacheEntryOptions<TMachineInstance<TArgs, TData>>;
    onCacheEntryAdded?: TOnCacheEntryAdded<TArgs, TData>;
    onQueryStarted?: TOnQueryStarted<TArgs, TData>;
    initialMachine?: TMachineInstance<TArgs, TData>;
}

/**
 * ResourceV2CacheEntry — extends CacheEntry with query lifecycle,
 * abort management, optimistic patches, and consistency violation detection.
 *
 * Owns its AbortController and inflight promise.
 * Extends CacheEntry via class inheritance.
 */
export class ResourceV2CacheEntry<TArgs, TData>
    extends CacheEntry<TMachineInstance<TArgs, TData>>
    implements IResourceV2CacheEntry<TArgs, TData>
{
    readonly machine$: ReadableSignalFnLike<TMachineInstance<TArgs, TData>>;
    readonly argsKey: string;

    private _args: TArgs;
    private _queryFn: TQueryFn<TArgs, TData>;
    private _compareArgs: TCompareArgsFn<TArgs>;
    private _abortController: AbortController | null = null;
    private _inflightPromise: Promise<TData> | null = null;
    private _patchState: TPatchState<TData> | null = null;
    private _onCacheEntryAdded: TOnCacheEntryAdded<TArgs, TData> | undefined;
    private _onQueryStarted: TOnQueryStarted<TArgs, TData> | undefined;
    private _entryDataLoaded: PromiseResolver<TData> | null = null;
    private _entryRemoved: PromiseResolver<void> | null = null;
    private _queryFulfilled: PromiseResolver<{ data: TData }> | null = null;

    constructor(options: IResourceV2CacheEntryOptions<TArgs, TData>) {
        super(options.initialMachine ?? new MachinePending<TArgs, TData>(options.args), options.entryOptions);
        this._args = options.args;
        this._queryFn = options.queryFn;
        this._compareArgs = options.compareArgs;
        this._onCacheEntryAdded = options.onCacheEntryAdded;
        this._onQueryStarted = options.onQueryStarted;
        this.machine$ = this.state$;
        this.argsKey = options.argsKey;

        this._fireCacheEntryAdded();

        if (!options.initialMachine) {
            this._doFetch().catch(() => {});
        }
    }

    isMyArgs(args: TArgs): boolean {
        return this._compareArgs(this._args, args);
    }

    createPatch(patchFn: (draft: TData) => void): IPatchHandle | null {
        const machine = this.peek();
        if (machine.status !== "success" && machine.status !== "refreshing") {
            return null;
        }

        const currentData = machine.data;
        const result = Patcher.createPatch(patchFn, currentData);

        if (result.patch.patches.length === 0) {
            return null;
        }

        const newPatch: TPatch = result.patch;
        const originalData = this._patchState?.originalData ?? currentData;
        const existingPatches = this._patchState?.patches ?? [];

        this._patchState = {
            originalData,
            patches: [...existingPatches, newPatch],
            isConsistencyViolation: false,
        };

        this._updateMachineData(result.data, this._patchState);

        return {
            commit: () => this._finishPatch("committed", newPatch),
            abort: () => this._finishPatch("aborted", newPatch),
        };
    }

    invalidate(): void {
        const machine = this.peek();
        if (machine.status !== "success") return;

        this.set(new MachineRefreshing<TArgs, TData>(this._args, machine.data, machine.patchState, machine.updatedAt));

        // Fire fetch without propagating unhandled rejection
        this._doFetch().catch(() => {});
    }

    query(doForce?: boolean): Promise<TData> {
        const machine = this.peek();

        // Dedup: if already inflight and not forced, return existing promise
        if (!doForce && this._inflightPromise) {
            return this._inflightPromise;
        }

        // Return cached data for success (no force)
        if (!doForce && machine.status === "success") {
            return Promise.resolve(machine.data);
        }

        // Transition based on current state
        if (machine.status === "success") {
            this.set(
                new MachineRefreshing<TArgs, TData>(this._args, machine.data, machine.patchState, machine.updatedAt),
            );
        } else if (machine.status === "error") {
            this.set(new MachinePending<TArgs, TData>(this._args));
        }
        // pending/refreshing with force: re-fetch (abort handled in _doFetch)

        return this._doFetch();
    }

    override complete(): void {
        // Abort inflight fetch
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        this._inflightPromise = null;
        this._patchState = null;

        // Lifecycle cleanup — resolve/reject all pending resolvers
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

        // Fire onClean$ and mark completed
        super.complete();
    }

    private _fireCacheEntryAdded(): void {
        if (!this._onCacheEntryAdded) return;

        this._entryDataLoaded = new PromiseResolver<TData>();
        this._entryRemoved = new PromiseResolver<void>();

        const tools: ICacheEntryAddedTools<TData> = {
            $cacheDataLoaded: this._entryDataLoaded.promise,
            $cacheEntryRemoved: this._entryRemoved.promise,
        };

        try {
            this._onCacheEntryAdded(this._args, tools);
        } catch {
            // Callback errors are caught, not propagated
        }

        // Resolve immediately if entry starts with data (hydration via Snapshot)
        const machine = this.peek();
        if (machine.status === "success" && this._entryDataLoaded) {
            this._entryDataLoaded.resolve(machine.data);
            this._entryDataLoaded = null;
        }
    }

    private _doFetch(): Promise<TData> {
        // Abort previous inflight
        if (this._abortController) {
            this._abortController.abort();
        }

        // Suppress unhandled rejection on orphaned previous promise
        this._inflightPromise?.catch(() => {});

        const controller = new AbortController();
        this._abortController = controller;

        // Lifecycle: reject leftover _queryFulfilled before creating new one
        if (this._queryFulfilled) {
            this._queryFulfilled.reject(new Error("Query superseded"));
            this._queryFulfilled = null;
        }

        // Lifecycle: fire onQueryStarted
        if (this._onQueryStarted) {
            this._queryFulfilled = new PromiseResolver<{ data: TData }>();

            const tools: IQueryStartedTools<TArgs, TData> = {
                $queryFulfilled: this._queryFulfilled.promise,
                getCacheEntry: () => this,
            };

            try {
                this._onQueryStarted(this._args, tools);
            } catch {
                // Callback errors caught
            }
        }

        let queryResult: Promise<TData>;
        try {
            queryResult = this._queryFn(this._args, { abortSignal: controller.signal });
        } catch (syncError) {
            this._abortController = null;
            this._inflightPromise = null;
            this.set(new MachineError<TArgs, TData>(this._args, syncError));
            if (this._queryFulfilled) {
                this._queryFulfilled.reject(syncError);
                this._queryFulfilled = null;
            }
            return Promise.reject(syncError);
        }

        const promise = queryResult.then(
            (data) => {
                // Stale check: a newer query has started
                if (this._abortController !== controller) return data;

                this._abortController = null;
                this._inflightPromise = null;

                const machine = this.peek();
                if (machine.status === "refreshing" && this._patchState) {
                    // Resolve patches on top of fresh server data
                    const resolution = Patcher.resolvePatches(data, this._patchState.patches);
                    this._patchState = resolution.patchState;
                    this.set(
                        new MachineSuccess<TArgs, TData>(
                            this._args,
                            resolution.data,
                            resolution.patchState,
                            Date.now(),
                        ),
                    );
                } else {
                    this._patchState = null;
                    this.set(new MachineSuccess<TArgs, TData>(this._args, data, null, Date.now()));
                }

                // Resolve _entryDataLoaded on first success only
                if (this._entryDataLoaded) {
                    this._entryDataLoaded.resolve(data);
                    this._entryDataLoaded = null;
                }

                // Resolve _queryFulfilled for this fetch
                if (this._queryFulfilled) {
                    this._queryFulfilled.resolve({ data });
                    this._queryFulfilled = null;
                }

                return data;
            },
            (error) => {
                // Stale check
                if (this._abortController !== controller) throw error;

                this._abortController = null;
                this._inflightPromise = null;

                const machine = this.peek();
                if (machine.status === "refreshing") {
                    // Error on refreshing preserves stale data with lastError
                    this.set(
                        new MachineSuccess<TArgs, TData>(
                            this._args,
                            machine.data,
                            machine.patchState,
                            machine.updatedAt,
                            error,
                        ),
                    );
                } else {
                    this.set(new MachineError<TArgs, TData>(this._args, error));
                }

                // Reject _queryFulfilled for this fetch
                if (this._queryFulfilled) {
                    this._queryFulfilled.reject(error);
                    this._queryFulfilled = null;
                }

                throw error;
            },
        );

        this._inflightPromise = promise;
        return promise;
    }

    private _updateMachineData(data: TData, patchState: TPatchState<TData> | null): void {
        const machine = this.peek();
        if (machine.status === "success") {
            this.set(new MachineSuccess<TArgs, TData>(this._args, data, patchState, machine.updatedAt));
        } else if (machine.status === "refreshing") {
            this.set(new MachineRefreshing<TArgs, TData>(this._args, data, patchState, machine.updatedAt));
        }
    }

    private _finishPatch(type: "committed" | "aborted", patch: TPatch): void {
        if (!this._patchState) return;

        const prevPatches = this._patchState.patches;

        const resolution = Patcher.finishPatch(this._patchState.originalData, this._patchState.patches, type, patch);

        this._patchState = resolution.patchState;
        this._updateMachineData(resolution.data, resolution.patchState);

        // Detect consistency violation:
        // 1. Patcher explicitly set the flag (non-catch path)
        // 2. Patcher catch path: returned null patchState but other pending patches existed
        const hasViolation =
            resolution.patchState?.isConsistencyViolation === true ||
            (resolution.patchState === null && type === "aborted" && prevPatches.some((p) => p !== patch));

        if (hasViolation) {
            this.invalidate();
        }
    }
}
