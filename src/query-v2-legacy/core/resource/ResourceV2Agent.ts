import { SKIP, type SKIP_TOKEN } from "@/query-v2/lib/SKIP_TOKEN";
import type { IResourceV2Agent, IResourceV2AgentState } from "@/query-v2/types/agent.types";
import type { TMachineStatus } from "@/query-v2/types/machine.types";
import { Signal } from "@/signals";
import type { ComputeFn, SignalFn } from "@/signals";

import type { CacheEntry } from "../common/CacheEntry";

import type { ResourceV2 } from "./ResourceV2";

interface AgentTracking<TData, TError> {
    previous: CacheEntry<TData, TError> | null;
    current: CacheEntry<TData, TError> | null;
}

/**
 * Agent that tracks a single cache entry with reactive state, designed for React hook consumption.
 * Provides SWR (stale-while-revalidate) semantics by keeping previous data while new data loads.
 */
export class ResourceV2Agent<TArgs, TData, TError = Error> implements IResourceV2Agent<TArgs, TData, TError> {
    private readonly _resource: ResourceV2<TArgs, TData, TError>;
    private readonly _tracking$: SignalFn<AgentTracking<TData, TError>>;
    private readonly _state$: ComputeFn<IResourceV2AgentState<TArgs, TData, TError>>;
    private _currentArgs: TArgs | null = null;

    constructor(resource: ResourceV2<TArgs, TData, TError>) {
        this._resource = resource;

        // Agent signals are internal derived state for React hooks — only CacheEntry signals belong in devtools
        this._tracking$ = Signal.state<AgentTracking<TData, TError>>(
            { previous: null, current: null },
            { isDisabled: true },
        );

        // Agent signal — excluded from devtools; only CacheEntry signals represent canonical cache state
        this._state$ = Signal.compute<IResourceV2AgentState<TArgs, TData, TError>>(
            () => {
                const { previous, current } = this._tracking$();

                if (!current) {
                    return {
                        status: "idle",
                        data: null,
                        error: null,
                        args: null,
                        isLoading: false,
                        isInitialLoading: false,
                        isRefreshing: false,
                        isSuccess: false,
                        isError: false,
                    };
                }

                // Read machine$ reactively — this is the key reactive subscription
                const machine = current.machine$();
                const machineState = machine.state;
                const status = machineState.status;

                // Determine previous data for SWR
                let previousData: TData | null = null;
                if (previous) {
                    const prevMachine = previous.machine$();
                    const prevState = prevMachine.state;
                    if (prevState.data != null) {
                        previousData = prevState.data;
                    }
                }

                const currentData = machineState.data;
                const isLoading = status === "pending" || status === "refreshing";
                const isRefreshing = status === "refreshing";

                // SWR: use previous data if current is loading and has no data yet
                const data = currentData ?? (isLoading ? previousData : null);
                const hasPreviousData = previousData !== null;
                const isInitialLoading = isLoading && !hasPreviousData && currentData === null;
                const isSuccess = data !== null;
                const isError = status === "error";
                const error = machineState.error;

                return {
                    status,
                    data,
                    error,
                    args: machineState.args,
                    isLoading,
                    isInitialLoading,
                    isRefreshing,
                    isSuccess,
                    isError,
                };
            },
            { isDisabled: true },
        );
    }

    /** Computed reactive state signal — projects CacheEntry machine state into a flat agent state object. */
    get state$(): ComputeFn<IResourceV2AgentState<TArgs, TData, TError>> {
        return this._state$;
    }

    /**
     * Start (or re-start) the agent with new args. Skips if args are unchanged.
     *
     * @param args - Query arguments, or `SKIP_TOKEN` to do nothing.
     */
    async start(args: TArgs | SKIP_TOKEN): Promise<void> {
        if (args === SKIP) {
            return;
        }

        const typedArgs = args as TArgs;

        // Same args check — skip if unchanged
        if (this._currentArgs !== null && this._resource.compareArgs(this._currentArgs, typedArgs)) {
            return;
        }

        this._currentArgs = typedArgs;

        // Get the entry synchronously from the resource
        const entry = this._resource.entry(typedArgs);

        // Swap previous/current
        const oldTracking = this._tracking$.peek();
        this._tracking$.set({
            previous: oldTracking.current,
            current: entry,
        });

        // Clear previous after current resolves (success or error)
        // Only if current hasn't changed (latest-wins)
        const currentTracking = this._tracking$.peek();
        if (currentTracking.current === entry) {
            this._tracking$.set({
                previous: null,
                current: entry,
            });
        }
    }

    compareArgs(a: TArgs, b: TArgs): boolean {
        return this._resource.compareArgs(a, b);
    }
}
