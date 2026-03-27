import type { Subscription } from "rxjs";

import { SKIP, type SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import type { ArgsOrVoid, IResourceV2Agent, IResourceV2AgentState, TMachineStatus } from "@/query-v2/types";
import { Signal } from "@/signals";
import { Batcher } from "@/signals/base/Batcher";
import type { ComputeFn, SignalFn } from "@/signals/types";

import type { ResourceV2CacheEntry } from "./ResourceV2CacheEntry";

interface Tracking<TArgs, TData> {
    previous: ResourceV2CacheEntry<TArgs, TData> | null;
    current: ResourceV2CacheEntry<TArgs, TData> | null;
}

export class ResourceV2Agent<TArgs, TData> implements IResourceV2Agent<TArgs, TData> {
    private _tracking$: SignalFn<Tracking<TArgs, TData>>;
    private _getEntry$: (...args: unknown[]) => ResourceV2CacheEntry<TArgs, TData> | null;
    private _compareArgsFn: (a: TArgs, b: TArgs) => boolean;
    private _lastArgs: TArgs | SKIP_TOKEN | null = null;
    private _entrySub: Subscription | null = null;

    readonly state$: ComputeFn<IResourceV2AgentState<TArgs, TData>>;

    constructor(
        getEntry$: (...args: unknown[]) => ResourceV2CacheEntry<TArgs, TData> | null,
        compareArgs: (a: TArgs, b: TArgs) => boolean,
    ) {
        this._getEntry$ = getEntry$;
        this._compareArgsFn = compareArgs;
        this._tracking$ = Signal.state<Tracking<TArgs, TData>>({
            previous: null,
            current: null,
        });

        this.state$ = Signal.compute<IResourceV2AgentState<TArgs, TData>>(() => {
            const tracking = this._tracking$();

            // Reactive dependency on resource _status$ via getEntry$.
            // When resetAll() sets _status$ to "idle", getEntry$ returns null.
            if (tracking.current && this._lastArgs !== null && this._lastArgs !== SKIP) {
                const reactiveEntry = this._getEntry$(this._lastArgs as TArgs);
                if (!reactiveEntry) {
                    // Active agent lost its entry (resetCache/resetAll) — schedule auto-refetch
                    const argsToRefetch = this._lastArgs as TArgs;
                    queueMicrotask(() => {
                        if (this._lastArgs !== null && this._lastArgs !== SKIP) {
                            this.start(argsToRefetch as never);
                        }
                    });
                    return this._idleState();
                }
            }

            return this._deriveState(tracking);
        });
    }

    start(args: SKIP_TOKEN): void;
    start(...args: ArgsOrVoid<TArgs>): void;
    start(...allArgs: unknown[]): void {
        const rawArg = allArgs.length > 0 ? allArgs[0] : undefined;

        // SKIP → disconnect (only mutate if not already in SKIP state)
        if (rawArg === SKIP) {
            if (this._lastArgs === SKIP) return;
            this._lastArgs = SKIP;
            this._entrySub?.unsubscribe();
            this._entrySub = null;
            this._tracking$.set({ previous: null, current: null });
            return;
        }

        const newArgs = rawArg as TArgs;

        // Same args check — no-op only if entry still exists (handles post-reset re-start)
        if (this._lastArgs !== null && this._lastArgs !== SKIP) {
            if (this._compareArgsFn(this._lastArgs as TArgs, newArgs)) {
                const existing = this._getEntry$(newArgs);
                if (existing) return;
            }
        }

        this._lastArgs = newArgs;

        // Batch getEntry$ internal signal writes (_status$, _lastEntry$) with _tracking$ update
        let newEntry!: ResourceV2CacheEntry<TArgs, TData>;
        Batcher.run(() => {
            newEntry = this._getEntry$(newArgs, true) as ResourceV2CacheEntry<TArgs, TData>;

            const tracking = this._tracking$.peek();
            let previous: ResourceV2CacheEntry<TArgs, TData> | null = null;

            // SWR swap: previous ← current only when current is settled
            if (tracking.current) {
                const currentMachine = tracking.current.peek();
                if (
                    currentMachine.status === "success" ||
                    currentMachine.status === "error" ||
                    currentMachine.status === "refreshing"
                ) {
                    previous = tracking.current;
                } else {
                    // Current is still pending (rapid change) — keep existing previous
                    previous = tracking.previous;
                }
            }

            this._tracking$.set({ previous, current: newEntry });
        });

        // Subscribe to entry obs for GC refcount tracking
        this._entrySub?.unsubscribe();
        this._entrySub = newEntry.obs.subscribe();

        // Trigger query on new entry
        newEntry.query().catch(() => {});
    }

    compareArgs(a: TArgs, b: TArgs): boolean {
        return this._compareArgsFn(a, b);
    }

    dispose(): void {
        this._entrySub?.unsubscribe();
        this._entrySub = null;
    }

    private _idleState(): IResourceV2AgentState<TArgs, TData> {
        return {
            status: "idle" as TMachineStatus,
            data: null,
            error: null,
            args: null,
            isLoading: false,
            isInitialLoading: false,
            isRefreshing: false,
            isSuccess: false,
            isError: false,
            entry: null,
        };
    }

    private _deriveState(tracking: Tracking<TArgs, TData>): IResourceV2AgentState<TArgs, TData> {
        const { previous, current } = tracking;

        if (!current) {
            return this._idleState();
        }

        const machine = current.state$();
        const status = machine.status;

        // SWR data: use previous entry's data while current is loading
        let data: TData | null = machine.data ?? null;
        if ((status === "pending" || status === "idle") && previous) {
            const prevMachine = previous.state$();
            if (prevMachine.status === "success" || prevMachine.status === "refreshing") {
                data = prevMachine.data;
            }
        }

        const isLoading = status === "pending" || status === "refreshing";
        const isInitialLoading = isLoading && data === null;
        const isRefreshing = status === "refreshing";

        // Clear previous when current resolves
        if (previous && (status === "success" || status === "error")) {
            // Schedule clearing previous (don't mutate during derive)
            queueMicrotask(() => {
                const current = this._tracking$.peek();
                if (current.previous) {
                    this._tracking$.set({ ...current, previous: null });
                }
            });
        }

        return {
            status,
            data,
            error: machine.error ?? null,
            args: machine.args ?? null,
            isLoading,
            isInitialLoading,
            isRefreshing,
            isSuccess: status === "success",
            isError: status === "error",
            entry: current,
        };
    }
}
