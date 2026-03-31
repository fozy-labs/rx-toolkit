import type { ComputeFn } from "@/signals/types";

import type { TMachineStatus } from "./machine.types";
import type { IResourceCacheEntry } from "./resource.types";
import type { ArgsOrVoidOrSkip } from "./shared.types";

/** Resource agent state — flat object derived from {previous, current} cache entries */
export type TResourceAgentState<TArgs, TData> =
    | {
          readonly status: TMachineStatus;
          /** Current data (maybe stale during loading via SWR) */
          data: TData | null;
          error: unknown;
          lastError?: unknown;
          args: TArgs | null;
          isLoading: boolean;
          isInitialLoading: boolean;
          isRefreshing: boolean;
          isRefreshError: boolean;
          isSuccess: boolean;
          isError: boolean;
          entry: IResourceCacheEntry<TArgs, TData> | null;
      }
    | {
          status: "idle";
          data: null;
          error: null;
          lastError?: undefined;
          args: null;
          isLoading: false;
          isInitialLoading: false;
          isRefreshing: false;
          isRefreshError: false;
          isSuccess: false;
          isError: false;
          entry: null;
      };

/** Resource agent instance */
export interface IResourceAgent<TArgs, TData> {
    /** Reactive state signal */
    readonly state$: ComputeFn<TResourceAgentState<TArgs, TData>>;
    /** Start observing a resource with given args */
    start(...args: ArgsOrVoidOrSkip<TArgs>): void;
    /** Compare args using resource strategy */
    compareArgs(a: TArgs, b: TArgs): boolean;
}
