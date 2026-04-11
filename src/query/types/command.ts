import type { ReadableSignalFnLike } from "@/signals/types";

import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { Args } from "./common";
import type { IResource } from "./resource";
import type { TCommandAgentState } from "./state";

// ==================== Link Types ====================

export interface TLinkConfig<TArgs, TData, TResArgs, TResData> {
    resource: IResource<TResArgs, TResData>;
    forwardArgs: (commandArgs: TArgs) => TResArgs | undefined;
    invalidate?: boolean;
    optimisticUpdate?: (draft: TResData, commandArgs: TArgs) => void;
    update?: (draft: TResData, commandArgs: TArgs, result: TData) => void;
}

export type TLinksInput<TArgs, TData> =
    | TLinkConfig<TArgs, TData, any, any>[]
    | ((link: (config: TLinkConfig<TArgs, TData, any, any>) => void) => void);

// ==================== Command Interface ====================

export interface ICommand<TArgs, TData> {
    trigger(args: Args<TArgs>, key?: string): Promise<TData>;
    getEntry(key: string): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(key: string): IQueryCacheEntry<TArgs, TData> | null;
    createAgent(key?: string): ICommandAgent<TArgs, TData>;
}

// ==================== Command Agent Interface ====================

export interface ICommandAgent<TArgs, TData> {
    state$: ReadableSignalFnLike<TCommandAgentState<TArgs, TData>>;
    trigger(args: Args<TArgs>, key?: string): Promise<TData>;
    setKey(key: string): void;
}

// ==================== Command Options ====================

export interface TCommandOptions<TArgs, TData> {
    queryFn: (args: TArgs) => Promise<TData>;
    key?: string;
    links?: TLinksInput<TArgs, TData>;
    retentionTime?: number | false;
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
}

// ==================== Command Config (internal) ====================

/**
 * Configuration object for creating a {@link Command}.
 *
 * @template TArgs - The argument type accepted by the mutation function.
 * @template TData - The data type returned by the mutation function.
 */
export interface ICommandConfig<TArgs, TData> {
    /** Function that executes the mutation. */
    queryFn: (args: TArgs) => Promise<TData>;
    /** Optional prefix for cache keys and devtools display. */
    key?: string;
    /** Link descriptors that bind this command to related resources. */
    links: TLinkConfig<TArgs, TData, any, any>[];
    /** Time (ms) to keep a cache entry after subscribers drop off. `false` disables auto-removal. */
    retentionTime: number | false;
    /** Called when a new cache entry is created. See lifecycle hooks documentation. */
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    /** Called every time `queryFn` starts. See lifecycle hooks documentation. */
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
}
