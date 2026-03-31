import type { ComputeFn } from "@/signals/types";

import type { TOnCommandCacheEntryAdded, TOnCommandQueryStarted } from "./command-lifecycle.types";
import type { IPatchHandle } from "./machine.types";
import type { IResource } from "./resource.types";
import type { ArgsOrVoid } from "./shared.types";

/** Query function for commands — receives args + abort tools */
export type TCommandQueryFn<TArgs, TResult> = (args: TArgs, tools: { abortSignal: AbortSignal }) => Promise<TResult>;

/** Link definition — connects a command to a Resource for post-mutation effects */
export interface ICommandLinkOptions<TArgs, TResult, RArgs, RData> {
    resource: IResource<RArgs, RData>;
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
export interface CommandLink<TArgs, TResult> extends ICommandLinkOptions<TArgs, TResult, any, any> {}

/** Options for createCommand / api.createCommand */
export interface TCommandOptions<TArgs, TResult> {
    queryFn: TCommandQueryFn<TArgs, TResult>;
    link?: CommandLink<TArgs, TResult>[];
    onCacheEntryAdded?: TOnCommandCacheEntryAdded<TResult>;
    onQueryStarted?: TOnCommandQueryStarted<TArgs, TResult>;
    cacheLifetime?: number | false;
    devtools?: unknown;
    devtoolsName?: string;
}

/** Command instance — returned by createCommand / api.createCommand */
export interface ICommand<TArgs, TResult> {
    createAgent(): ICommandAgent<TArgs, TResult>;
    resetCache(): void;
}

/** Adapter for linking a command to a specific resource + args */
export interface IResourceRef<RData> {
    invalidate(): void;
    patch(patchFn: (draft: RData) => void): IPatchHandle | null;
}

/** Command agent state — 4-branch discriminated union */
export type TCommandAgentState<TArgs, TResult> =
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

/** Command agent instance — per-component mutation observer */
export interface ICommandAgent<TArgs, TResult> {
    readonly state$: ComputeFn<TCommandAgentState<TArgs, TResult>>;
    trigger(...args: ArgsOrVoid<TArgs>): Promise<TResult>;
    reset(): void;
}
