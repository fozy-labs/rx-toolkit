import type { ComputeFn } from "@/signals/types";

import type { TMachineStatus } from "./machine.types";
import type { IResourceV2CacheEntry } from "./resource.types";
import type { ArgsOrVoidOrSkip } from "./shared.types";

/** ResourceV2 agent state — flat object derived from {previous, current} cache entries */
export type TResourceV2AgentState<TArgs, TData> =
    | {
          readonly status: TMachineStatus;
          /** Current data (maybe stale during loading via SWR) */
          data: TData | null;
          error: unknown;
          args: TArgs | null;
          isLoading: boolean;
          isInitialLoading: boolean;
          isRefreshing: boolean;
          isSuccess: boolean;
          isError: boolean;
          entry: IResourceV2CacheEntry<TArgs, TData> | null;
      }
    | {
          status: "idle";
          data: null;
          error: null;
          args: null;
          isLoading: false;
          isInitialLoading: false;
          isRefreshing: false;
          isSuccess: false;
          isError: false;
          entry: null;
      };

/** ResourceV2 agent instance */
export interface IResourceV2Agent<TArgs, TData> {
    /** Reactive state signal */
    readonly state$: ComputeFn<TResourceV2AgentState<TArgs, TData>>;
    /** Start observing a resource with given args */
    start(...args: ArgsOrVoidOrSkip<TArgs>): void;
    /** Compare args using resource strategy */
    compareArgs(a: TArgs, b: TArgs): boolean;
}
