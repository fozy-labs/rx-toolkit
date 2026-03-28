import { CacheEntry } from "@/query-v2/core/CacheEntry";
import { MachineError, MachinePending, MachineRefreshing, MachineSuccess, Patcher } from "@/query-v2/core/machines";
import type {
    ICacheEntryOptions,
    IPatchHandle,
    IResourceV2CacheEntry,
    TCompareArgsFn,
    TMachineInstance,
    TPatch,
    TPatchState,
    TQueryFn,
} from "@/query-v2/types";
import type { ReadableSignalFnLike } from "@/signals/types";

export interface IResourceV2CacheEntryOptions<TArgs, TData> {
    args: TArgs;
    queryFn: TQueryFn<TArgs, TData>;
    compareArgs: TCompareArgsFn<TArgs>;
    entryOptions?: ICacheEntryOptions<TMachineInstance<TArgs, TData>>;
    onDataLoaded?: (args: TArgs, data: TData) => void;
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

    private _args: TArgs;
    private _queryFn: TQueryFn<TArgs, TData>;
    private _compareArgs: TCompareArgsFn<TArgs>;
    private _abortController: AbortController | null = null;
    private _inflightPromise: Promise<TData> | null = null;
    private _patchState: TPatchState<TData> | null = null;
    private _onDataLoaded: ((args: TArgs, data: TData) => void) | undefined;

    constructor(options: IResourceV2CacheEntryOptions<TArgs, TData>) {
        super(new MachinePending<TArgs, TData>(options.args), options.entryOptions);
        this._args = options.args;
        this._queryFn = options.queryFn;
        this._compareArgs = options.compareArgs;
        this._onDataLoaded = options.onDataLoaded;
        this.machine$ = this.state$;

        this._doFetch().catch(() => {});
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

        // Fire onClean$ and mark completed
        super.complete();
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

        let queryResult: Promise<TData>;
        try {
            queryResult = this._queryFn(this._args, { abortSignal: controller.signal });
        } catch (syncError) {
            this._abortController = null;
            this._inflightPromise = null;
            this.set(new MachineError<TArgs, TData>(this._args, syncError));
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

                this._onDataLoaded?.(this._args, data);

                return data;
            },
            (error) => {
                // Stale check
                if (this._abortController !== controller) throw error;

                this._abortController = null;
                this._inflightPromise = null;

                const machine = this.peek();
                if (machine.status === "refreshing") {
                    // Error on refreshing preserves stale data
                    this.set(
                        new MachineSuccess<TArgs, TData>(
                            this._args,
                            machine.data,
                            machine.patchState,
                            machine.updatedAt,
                        ),
                    );
                } else {
                    this.set(new MachineError<TArgs, TData>(this._args, error));
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
