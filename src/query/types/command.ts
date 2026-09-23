import type { ReadonlySignal } from "@/signals/types";

import type { TLifecycleHookOption, TMapError } from "./api";
import type { IQueryCacheEntry, TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { TArgsOrKeyed, TRetentionTime } from "./common";
import type { IResource, TBoundResource } from "./resource";
import type { TCommandClutchState, TErrorSlot } from "./state";

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
    execute(args: TArgsOrKeyed<TArgs>, entryKey?: string): Promise<TData>;
    getEntry(entryKey: string): IQueryCacheEntry<TArgs, TData> | null;
    getEntry$(entryKey: string): IQueryCacheEntry<TArgs, TData> | null;
    createClutch(entryKey?: string): ICommandClutch<TArgs, TData, TError>;
    /** @deprecated Renamed to {@link createClutch}. Will be removed in 0.14.0. */
    createAgent(entryKey?: string): ICommandClutch<TArgs, TData, TError>;
    bind(args: TArgsOrKeyed<TArgs>, entryKey?: string): TBoundCommand<TArgs, TData, TError>;
    /** @deprecated Renamed to {@link bind}. Will be removed in 0.14.0. */
    pack(args: TArgsOrKeyed<TArgs>, entryKey?: string): TBoundCommand<TArgs, TData, TError>;
}

// ==================== Bound Descriptor ====================

/**
 * Inert descriptor binding a command to a set of arguments (and an optional
 * cache-entry key). Produced by {@link ICommand.bind} — lets a consumer hand "what to
 * run, with which args" back to the library without executing anything.
 * Discriminated by `kind`.
 */
export interface TBoundCommand<TArgs, TData, TError = unknown> {
    kind: "command";
    command: ICommand<TArgs, TData, TError>;
    args: TArgsOrKeyed<TArgs>;
    /** Cache-entry key the descriptor targets; several consumers sharing it share one run's state. */
    entryKey?: string;
}

/**
 * Discriminated union of every bound descriptor. Narrow on `kind` to recover
 * the concrete resource/command shape.
 */
export type TBound<TArgs, TData, TError = unknown> =
    TBoundResource<TArgs, TData, TError> | TBoundCommand<TArgs, TData, TError>;

// ==================== Trigger Result Envelope ====================

/**
 * Settled outcome of a mutation, discriminated by `status`.
 *
 * The optional `undefined` counterparts let consumers narrow both ways:
 * `result.status === "error"` and `if (result.error)` work equally well.
 */
export type TTriggerResult<TData, TError = unknown> =
    { status: "success"; data: TData; error?: undefined } | { status: "error"; data?: undefined; error: TError };

/**
 * Promise returned by clutch/hook-level `trigger`.
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

// ==================== Command Clutch Interface ====================

export interface ICommandClutch<TArgs, TData, TError = unknown> {
    state$: ReadonlySignal<TCommandClutchState<TArgs, TData, TError>>;
    /**
     * Execute the mutation and track its cache entry via {@link state$}.
     *
     * Returns a {@link TTriggerPromise}: it never rejects — the outcome arrives
     * as a {@link TTriggerResult} envelope, so a fire-and-forget call site
     * (`onClick={() => trigger(args)}`) can never surface an unhandled
     * rejection. `unwrap()` hands back the raw throwing promise
     * (`Command.execute`'s contract) when that is wanted instead.
     */
    trigger(args: TArgsOrKeyed<TArgs>, entryKey?: string): TTriggerPromise<TData, TError>;
    /** Bind the clutch to a cache-entry key: it observes that entry's state. */
    setEntryKey(entryKey: string): void;
    /** @deprecated Renamed to {@link setEntryKey}. Will be removed in 0.14.0. */
    setKey(entryKey: string): void;
    /** Re-execute the tracked mutation after it failed. No-op unless in the `error` state. */
    retry(): void;
}

// ==================== Command Entry State ====================

// The entry state of a command is its clutch state stripped of the state
// methods: the same five rows (K1-K5, see {@link TCommandClutchState}) over a
// single cache entry. It is what a `retentionTime` function observes — the
// counterpart of the resource's `TResourceEntryState`.

/** K1 — no cache entry: nothing was triggered under this entry key. */
export interface TCommandEntryIdleState {
    status: "idle";
    data: null;
    hasData: false;
    error: null;
    hasError: false;
    args: null;
    isPending: false;
}

/**
 * K2 / K5 — the mutation is running. `data` is always absent; `hasError` marks
 * the run as a retry and keeps the failure it retries readable in `error`.
 */
export type TCommandEntryPendingState<TArgs, TError = unknown> = {
    status: "pending";
    data: null;
    hasData: false;
    args: TArgs;
    isPending: true;
} & TErrorSlot<TError>;

/** K3 — the mutation succeeded: `data` is present, no error. */
export interface TCommandEntrySuccessState<TArgs, TData> {
    status: "success";
    data: TData;
    hasData: true;
    error: null;
    hasError: false;
    args: TArgs;
    isPending: false;
}

/** K4 — the mutation failed: `error` is present, no data. */
export interface TCommandEntryErrorState<TArgs, TError = unknown> {
    status: "error";
    data: null;
    hasData: false;
    error: TError;
    hasError: true;
    args: TArgs;
    isPending: false;
}

export type TCommandEntryState<TArgs, TData, TError = unknown> =
    | TCommandEntryIdleState
    | TCommandEntryPendingState<TArgs, TError>
    | TCommandEntrySuccessState<TArgs, TData>
    | TCommandEntryErrorState<TArgs, TError>;

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
    /**
     * How long an entry of this command is kept after its last subscriber
     * leaves; falls back to the api-level `commandRetentionTime`. The function
     * form decides per entry — see {@link TRetentionTime} for when it runs and
     * how its result is normalized. The `idle` row is excluded because the
     * entry exists whenever it runs.
     *
     * The *first* evaluation always finds the entry settled (`success` or
     * `error`): `execute()` holds it alive until the mutation resolves or
     * rejects. A later run started by `retry()` carries no such keepalive, so
     * losing the last subscriber while a retry is in flight does hand the
     * function a `pending` row — with `hasError` marking it as a retry.
     */
    retentionTime?: TRetentionTime<TArgs, Exclude<TCommandEntryState<TArgs, TData>, TCommandEntryIdleState>>;
    /**
     * Derives the request id passed to {@link queryFn}. Called once per cache
     * entry (its result is reused across retries). Defaults to `crypto.randomUUID()`.
     */
    generateRequestId?: (args: TArgs) => string | Promise<string>;
    /** See {@link TLifecycleHookOption} for the array form. */
    onCacheEntryAdded?: TLifecycleHookOption<(args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void>;
    /** See {@link TLifecycleHookOption} for the array form. */
    onQueryStarted?: TLifecycleHookOption<
        (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>
    >;
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
     * Normalizes raw mutation errors before they enter the entry's state. The Api
     * always supplies one (identity when the consumer configured no `mapError`);
     * defaults to identity if constructed directly. See {@link TMapError}.
     */
    mapError?: TMapError;
    /** Link descriptors that bind this command to related resources. */
    links: TLinkConfig<TArgs, TData, any, any>[];
    /**
     * Time (ms) to keep a cache entry after subscribers drop off. `false`
     * disables auto-removal. See {@link TCommandOptions.retentionTime} for the
     * function form; the Api always supplies one.
     */
    retentionTime: TRetentionTime<TArgs, Exclude<TCommandEntryState<TArgs, TData>, TCommandEntryIdleState>>;
    /** Called when a new cache entry is created. See lifecycle hooks documentation. */
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TData>) => void;
    /** Called every time `queryFn` starts. See lifecycle hooks documentation. */
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TData>) => void | Promise<void>;
}

// ==================== Deprecated Aliases ====================

/** @deprecated Renamed to {@link ICommandClutch}. Will be removed in 0.14.0. */
export type ICommandAgent<TArgs, TData, TError = unknown> = ICommandClutch<TArgs, TData, TError>;

/** @deprecated Renamed to {@link TBoundCommand}. Will be removed in 0.14.0. */
export type TPackedCommand<TArgs, TData, TError = unknown> = TBoundCommand<TArgs, TData, TError>;

/** @deprecated Renamed to {@link TBound}. Will be removed in 0.14.0. */
export type TPacked<TArgs, TData, TError = unknown> = TBound<TArgs, TData, TError>;
