import type { ReadonlySignal } from "@/signals/types";

import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { Args } from "./common";
import type { IResource, TPackedResource } from "./resource";
import type { TCommandAgentState } from "./state";

// ==================== Link Types ====================

export interface TLinkConfig<TArgs, TData, TResArgs, TResData> {
    resource: IResource<TResArgs, TResData>;
    forwardArgs: (commandArgs: TArgs) => TResArgs | undefined;
    invalidate?: boolean;
    optimisticUpdate?: (draft: TResData, commandArgs: TArgs) => void;
    update?: (draft: TResData, commandArgs: TArgs, result: TData) => void;
}

export type TLinksInput<TArgs, TData> = (
    link: <TResArgs, TResData>(config: TLinkConfig<TArgs, TData, TResArgs, TResData>) => void,
) => void;

// ==================== Command Interface ====================

export interface ICommand<TArgs, TData> {
    trigger(args: Args<TArgs>, key?: string): Promise<TData>;
    getEntry(key: string): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(key: string): IQueryCacheEntry<TArgs, TData> | null;
    createAgent(key?: string): ICommandAgent<TArgs, TData>;
    pack(args: Args<TArgs>, key?: string): TPackedCommand<TArgs, TData>;
}

// ==================== Packed Descriptor ====================

/**
 * Inert descriptor binding a command to a set of arguments (and an optional
 * cache key). Produced by {@link ICommand.pack} — lets a consumer hand "what to
 * run, with which args" back to the library without executing anything.
 * Discriminated by `kind`.
 */
export interface TPackedCommand<TArgs, TData> {
    kind: "command";
    command: ICommand<TArgs, TData>;
    args: Args<TArgs>;
    key?: string;
}

/**
 * Discriminated union of every packed descriptor. Narrow on `kind` to recover
 * the concrete resource/command shape.
 */
export type TPacked<TArgs, TData> = TPackedResource<TArgs, TData> | TPackedCommand<TArgs, TData>;

// ==================== Command Agent Interface ====================

export interface ICommandAgent<TArgs, TData> {
    state$: ReadonlySignal<TCommandAgentState<TArgs, TData>>;
    trigger(args: Args<TArgs>, key?: string): Promise<TData>;
    setKey(key: string): void;
    /** Re-execute the tracked mutation after it failed. No-op unless in the `error` state. */
    retry(): void;
}

// ==================== Command Options ====================

export interface TCommandOptions<TArgs, TData> {
    /**
     * Executes the mutation. The second argument is the request id — a stable
     * idempotency token that is minted once per cache entry and reused across
     * retries, so a failed-then-retried mutation carries the same token to the
     * backend. Forward it as e.g. an `Idempotency-Key` header.
     */
    queryFn: (args: TArgs, requestId: string) => Promise<TData>;
    key?: string;
    links?: TLinksInput<TArgs, TData>;
    retentionTime?: number | false;
    /**
     * Derives the request id passed to {@link queryFn}. Called once per cache
     * entry (its result is reused across retries). Defaults to `crypto.randomUUID()`.
     */
    generateRequestId?: (args: TArgs) => string | Promise<string>;
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
    /** Function that executes the mutation. Receives the per-entry request id as the second argument. */
    queryFn: (args: TArgs, requestId: string) => Promise<TData>;
    /** Derives the request id; called once per cache entry. Defaults to `crypto.randomUUID()`. */
    generateRequestId?: (args: TArgs) => string | Promise<string>;
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
