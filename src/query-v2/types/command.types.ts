import type { ComputeFn } from "@/signals/types";

import type { TOnCommandCacheEntryAdded, TOnCommandQueryStarted } from "./command-lifecycle.types";
import type { IPatchHandle } from "./machine.types";
import type { IResourceV2 } from "./resource.types";
import type { ArgsOrVoid } from "./shared.types";

/** Query function for commands — receives args + abort tools */
export type TCommandQueryFn<TArgs, TResult> = (args: TArgs, tools: { abortSignal: AbortSignal }) => Promise<TResult>;

/** Link definition — connects a command to a ResourceV2 for post-mutation effects */
export interface ICommandV2LinkOptions<TArgs, TResult, RArgs, RData> {
    resource: IResourceV2<RArgs, RData>;
    forwardArgs: (args: TArgs) => RArgs;
    invalidate?: boolean;
    update?: (tools: { draft: RData; args: TArgs; data: TResult }) => void;
    optimisticUpdate?: (tools: { draft: RData; args: TArgs }) => void;
}

/**
 * Type-erased link. Produced by `commandLink()` helper.
 * Internal use — consumers should never construct this directly.
 */
/** Type-erased link. Produced by `commandLink()` helper. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommandV2Link<TArgs, TResult> extends ICommandV2LinkOptions<TArgs, TResult, any, any> {}

/** Options for createCommandV2 / api.createCommandV2 */
export interface TCommandV2Options<TArgs, TResult> {
    queryFn: TCommandQueryFn<TArgs, TResult>;
    link?: CommandV2Link<TArgs, TResult>[];
    onCacheEntryAdded?: TOnCommandCacheEntryAdded<TResult>;
    onQueryStarted?: TOnCommandQueryStarted<TArgs, TResult>;
    cacheLifetime?: number | false;
    devtools?: unknown;
    devtoolsName?: string;
}

/** CommandV2 instance — returned by createCommandV2 / api.createCommandV2 */
export interface ICommandV2<TArgs, TResult> {
    createAgent(): ICommandV2Agent<TArgs, TResult>;
    resetCache(): void;
}

/** Adapter for linking a command to a specific resource + args */
export interface IResourceV2Ref<RData> {
    invalidate(): void;
    patch(patchFn: (draft: RData) => void): IPatchHandle | null;
}

/** CommandV2 agent state — 4-branch discriminated union */
export type TCommandV2AgentState<TArgs, TResult> =
    | {
          readonly status: "idle";
          readonly data: null;
          readonly error: null;
          readonly args: null;
          readonly isLoading: false;
          readonly isSuccess: false;
          readonly isError: false;
      }
    | {
          readonly status: "loading";
          readonly data: TResult | null;
          readonly error: null;
          readonly args: TArgs;
          readonly isLoading: true;
          readonly isSuccess: false;
          readonly isError: false;
      }
    | {
          readonly status: "success";
          readonly data: TResult;
          readonly error: null;
          readonly args: TArgs;
          readonly isLoading: false;
          readonly isSuccess: true;
          readonly isError: false;
      }
    | {
          readonly status: "error";
          readonly data: null;
          readonly error: unknown;
          readonly args: TArgs;
          readonly isLoading: false;
          readonly isSuccess: false;
          readonly isError: true;
      };

/** CommandV2 agent instance — per-component mutation observer */
export interface ICommandV2Agent<TArgs, TResult> {
    readonly state$: ComputeFn<TCommandV2AgentState<TArgs, TResult>>;
    trigger(...args: ArgsOrVoid<TArgs>): Promise<TResult>;
    reset(): void;
}
