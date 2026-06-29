import type { ArgsOrVoidOrSkip, TMachineStatus, TResourceSnapshot } from "@/query";
import type { ReadonlySignal } from "@/signals/types";

import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { Args, ArgsOrVoid, Keyed } from "./common";
import type { TResourceAgentState } from "./state";

// ==================== Resource Interface ====================

export interface IResource<TArgs, TData> {
    trigger(args: Args<TArgs>, doForce?: boolean): void;
    refresh(args: Args<TArgs>): void;
    getEntry(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): ReadonlySignal<IQueryCacheEntry<TArgs, TData> | null>;
    getEntries(): IterableIterator<IQueryCacheEntry<TArgs, TData>>;
    createAgent(): IResourceAgent<TArgs, TData>;
    serialize(args: Args<TArgs>): string;
    toKeyed(args: Args<TArgs>): Keyed<TArgs>;
    getState(args: ArgsOrVoid<TArgs>): IResourceLiteState<TArgs, TData>;
    pack(args: Args<TArgs>): TPackedResource<TArgs, TData>;
    ensure(args: Args<TArgs>, options?: TResourceFetchOptions): Promise<TData>;
    fetch(args: Args<TArgs>, options?: TResourceFetchOptions): Promise<TData>;
    prefetch(args: Args<TArgs>): Promise<void>;
}

// ==================== Fetch Options ====================

/**
 * Options for the imperative {@link IResource.ensure} / {@link IResource.fetch}
 * methods.
 */
export interface TResourceFetchOptions {
    /**
     * Detaches the caller from the awaited query when aborted: the returned
     * promise rejects with the signal's reason. The underlying query is left
     * running for any other consumers and is torn down by retention GC only once
     * no consumer remains — aborting one caller never cancels a shared in-flight
     * request. {@link IResource.prefetch} is intentionally not abort-aware.
     */
    signal?: AbortSignal;
}

// ==================== Packed Descriptor ====================

/**
 * Inert descriptor binding a resource to a set of arguments. Produced by
 * {@link IResource.pack} — lets a consumer hand "what to read, with which args"
 * back to the library without executing anything. Discriminated by `kind`;
 * see {@link TPacked} for the command counterpart.
 */
export interface TPackedResource<TArgs, TData> {
    kind: "resource";
    resource: IResource<TArgs, TData>;
    args: Args<TArgs>;
}

export interface IResourceLiteState<TArgs, TData> {
    status: TMachineStatus | "idle";
    data: TData | null;
    error: unknown;
    args: TArgs | null;
    isLoading: boolean;
    isInitialLoading: boolean;
    isRefreshing: boolean;
    isRefreshError: boolean;
    isSuccess: boolean;
    isError: boolean;
}

// ==================== Resource Agent Interface ====================

export interface IResourceAgent<TArgs, TData> {
    state$: ReadonlySignal<TResourceAgentState<TArgs, TData>>;
    start(): void;
    set(args: ArgsOrVoidOrSkip<TArgs>, mark?: boolean): void;
    retry(): void;
    refresh(): void;
    /**
     * Promise resolving once the agent leaves the initial-loading phase — data
     * became available (success / refreshing / refresh-error / stale SWR) or the
     * query failed with nothing to fall back on. Never rejects. Used by the
     * Suspense hook to wake React after a suspended render.
     */
    whenSettled(): Promise<void>;
    get args(): TArgs | null;
}

// ==================== Resource Options ====================

export interface TResourceOptions<TArgs, TData> {
    queryFn: (args: TArgs, abortSignal: AbortSignal) => Promise<TData>;
    key?: string;
    retentionTime?: number | false;
    serializeArgs?: (args: TArgs) => string;
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
    snapshotValidTime?: number | false;
    sync?: boolean;
    getDevtoolsKey?: (args: Keyed<TArgs>) => string;
}

// ==================== Resource Config (internal) ====================

export interface IResourceConfig<TArgs, TData> {
    queryFn: (args: TArgs, abortSignal: AbortSignal) => Promise<TData>;
    key?: string;
    retentionTime: number | false;
    serializeArgs: (args: TArgs) => string;
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
    getDevtoolsKey?: (args: Keyed<TArgs>) => string;
    /** Pre-populated entries from snapshot hydration (key → snapshot meta). */
    snapshot?: TResourceSnapshot;
    /** Cross-tab sync hook: called before queryFn to check if another tab has cached data. */
    beforeQuery?: (resourceKey: string, entryKey: string) => Promise<{ data: TData } | null>;
}
