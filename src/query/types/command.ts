import type { ReadonlySignal } from "@/signals/types";

import type { TMapError } from "./api";
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

export interface ICommand<TArgs, TData, TError = unknown> {
    /**
     * Imperatively execute the mutation.
     *
     * Returns the raw mutation promise: resolves with the result, rejects with
     * the mapError-normalized error (`TError`). Never throws synchronously.
     */
    execute(args: Args<TArgs>, key?: string): Promise<TData>;
    /**
     * @deprecated Renamed to {@link execute} (identical contract). Will be
     * removed in a future release.
     */
    trigger(args: Args<TArgs>, key?: string): Promise<TData>;
    getEntry(key: string): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(key: string): IQueryCacheEntry<TArgs, TData> | null;
    createAgent(key?: string): ICommandAgent<TArgs, TData, TError>;
    pack(args: Args<TArgs>, key?: string): TPackedCommand<TArgs, TData, TError>;
}

// ==================== Packed Descriptor ====================

/**
 * Inert descriptor binding a command to a set of arguments (and an optional
 * cache key). Produced by {@link ICommand.pack} — lets a consumer hand "what to
 * run, with which args" back to the library without executing anything.
 * Discriminated by `kind`.
 */
export interface TPackedCommand<TArgs, TData, TError = unknown> {
    kind: "command";
    command: ICommand<TArgs, TData, TError>;
    args: Args<TArgs>;
    key?: string;
}

/**
 * Discriminated union of every packed descriptor. Narrow on `kind` to recover
 * the concrete resource/command shape.
 */
export type TPacked<TArgs, TData, TError = unknown> =
    | TPackedResource<TArgs, TData, TError>
    | TPackedCommand<TArgs, TData, TError>;

// ==================== Trigger Result Envelope ====================

/**
 * Settled outcome of a mutation, discriminated by `status`.
 *
 * The optional `undefined` counterparts let consumers narrow both ways:
 * `result.status === "error"` and `if (result.error)` work equally well.
 */
export type TTriggerResult<TData, TError = unknown> =
    | { status: "success"; data: TData; error?: undefined }
    | { status: "error"; data?: undefined; error: TError };

/**
 * Promise returned by agent/hook-level `trigger`.
 *
 * Never rejects — the outcome is delivered as a {@link TTriggerResult}
 * envelope, so a bare `await trigger(...)` needs no try/catch. Call
 * {@link unwrap} when throwing semantics are wanted instead.
 */
export interface TTriggerPromise<TData, TError = unknown> extends Promise<TTriggerResult<TData, TError>> {
    /**
     * The raw result: resolves with the mutation data, rejects with the
     * original error — the same contract as `Command.execute`.
     */
    unwrap(): Promise<TData>;
}

// ==================== Command Agent Interface ====================

export interface ICommandAgent<TArgs, TData, TError = unknown> {
    state$: ReadonlySignal<TCommandAgentState<TArgs, TData, TError>>;
    /**
     * Execute the mutation and track its cache entry via {@link state$}.
     *
     * Returns a {@link TTriggerPromise}: it never rejects — the outcome arrives
     * as a {@link TTriggerResult} envelope, so a fire-and-forget call site
     * (`onClick={() => trigger(args)}`) can never surface an unhandled
     * rejection. `unwrap()` hands back the raw throwing promise
     * (`Command.execute`'s contract) when that is wanted instead.
     */
    trigger(args: Args<TArgs>, key?: string): TTriggerPromise<TData, TError>;
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
    /**
     * Normalizes raw mutation errors before they enter the machine. The Api
     * always supplies one (identity when the consumer configured no `mapError`);
     * defaults to identity if constructed directly. See {@link TMapError}.
     */
    mapError?: TMapError;
    /** Link descriptors that bind this command to related resources. */
    links: TLinkConfig<TArgs, TData, any, any>[];
    /** Time (ms) to keep a cache entry after subscribers drop off. `false` disables auto-removal. */
    retentionTime: number | false;
    /** Called when a new cache entry is created. See lifecycle hooks documentation. */
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    /** Called every time `queryFn` starts. See lifecycle hooks documentation. */
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
}
