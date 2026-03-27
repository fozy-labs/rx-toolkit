import type { ComputeFn } from "@/signals/types";

import type { SKIP_TOKEN } from "../lib/SKIP_TOKEN";

import type { TMachineStatus } from "./machine.types";
import type { IResourceV2CacheEntry } from "./resource.types";
import type { ArgsOrVoid } from "./shared.types";

/** ResourceV2 agent state — flat object derived from {previous, current} cache entries */
export interface IResourceV2AgentState<TArgs, TData> {
    readonly status: TMachineStatus;
    /** Current data (may be stale during loading via SWR) */
    readonly data: TData | null;
    readonly error: unknown;
    readonly args: TArgs | null;
    readonly isLoading: boolean;
    readonly isInitialLoading: boolean;
    readonly isRefreshing: boolean;
    readonly isSuccess: boolean;
    readonly isError: boolean;
    /** Entry handle for optimistic patches */
    readonly entry: IResourceV2CacheEntry<TArgs, TData> | null;
}

/** ResourceV2 agent instance */
export interface IResourceV2Agent<TArgs, TData> {
    /** Reactive state signal */
    readonly state$: ComputeFn<IResourceV2AgentState<TArgs, TData>>;
    /** Start observing a resource with SKIP to disable observation */
    start(args: SKIP_TOKEN): void;
    /** Start observing a resource with given args */
    start(...args: ArgsOrVoid<TArgs>): void;
    /** Compare args using resource strategy */
    compareArgs(a: TArgs, b: TArgs): boolean;
    /** Clean up internal subscriptions (entry obs for GC refcount) */
    dispose(): void;
}
