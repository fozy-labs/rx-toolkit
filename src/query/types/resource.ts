import type { ArgsOrVoidOrSkip, TResourceSnapshot } from "@/query";
import type { ReadableSignalFnLike } from "@/signals/types";

import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { Args, ArgsOrVoid, Keyed } from "./common";
import type { TResourceAgentState } from "./state";

// ==================== Resource Interface ====================

export interface IResource<TArgs, TData> {
    trigger(args: Args<TArgs>, doForce?: boolean): void;
    refresh(args: Args<TArgs>): void;
    getEntry(args: ArgsOrVoid<TArgs>, doInitiate?: boolean): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(
        args: ArgsOrVoid<TArgs>,
        doInitiate?: boolean,
    ): ReadableSignalFnLike<IQueryCacheEntry<TArgs, TData> | null>;
    getEntries(): IterableIterator<IQueryCacheEntry<TArgs, TData>>;
    createAgent(): IResourceAgent<TArgs, TData>;
    serialize(args: Args<TArgs>): string;
    toKeyed(args: Args<TArgs>): Keyed<TArgs>;
}

// ==================== Resource Agent Interface ====================

export interface IResourceAgent<TArgs, TData> {
    state$: ReadableSignalFnLike<TResourceAgentState<TArgs, TData>>;
    start(): void;
    set(args: ArgsOrVoidOrSkip<TArgs>, mark?: boolean): void;
    retry(): void;
    refresh(): void;
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
