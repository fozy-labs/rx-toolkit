import type { TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { IResource } from "./resource";

// ==================== Batch Resource Types ====================

/** A single `{ id, item }` pair extracted from the wrapped resource's response. */
export interface TBatchParsedItem<TId, TItem> {
    id: TId;
    item: TItem;
}

/**
 * Options for `api.createBatchResource` — a wrapper over an existing resource
 * that fetches collections of items by ids with per-item cache granularity:
 * only the ids missing from the shared item cache reach the wrapped resource.
 *
 * @template TArgs - The batch resource's own argument type (defaults to `TId[]`
 *   at the `createBatchResource` call site when `parseArgs` is omitted).
 * @template TId - Per-item identifier type.
 * @template TItem - Single item type; the batch resource's data is `TItem[]`.
 * @template TResArgs - The wrapped resource's argument type.
 * @template TResData - The wrapped resource's response type.
 */
export interface TBatchResourceOptions<TArgs, TId, TItem, TResArgs, TResData> {
    /** The wrapped resource that performs the actual batched requests. */
    resource: IResource<TResArgs, TResData>;
    /** Devtools/debug label; namespaced by the api `keyPrefix` like any resource key. */
    key?: string;
    /** Splits the wrapped resource's response into `{ id, item }` pairs. */
    parseData: (data: TResData) => ReadonlyArray<TBatchParsedItem<TId, TItem>>;
    /** Builds the wrapped resource's args from the ids that actually need fetching. */
    makeArgs: (ids: TId[]) => TResArgs;
    /**
     * Extracts the requested ids from the batch resource's own args. Optional
     * when the args already are the id list (`TArgs` then defaults to `TId[]`).
     * Must be pure and deterministic — it is re-applied to cached entry args.
     */
    parseArgs?: (args: TArgs) => readonly TId[];
    /** Serializes an id into the item-cache key. Defaults to `stableStringify`. */
    serializeId?: (id: TId) => string;
    /**
     * Lifecycle hook over the id-set entries (args = the batch resource's own
     * args, data = the assembled `TItem[]`). Composed with the runtime's
     * internal bookkeeping hook. To observe the actual network runs, hook the
     * wrapped resource instead.
     */
    onCacheEntryAdded?: (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TItem[]>) => void;
    /**
     * Lifecycle hook fired per id-set query run — including runs served
     * entirely from the item cache without a network request. To observe the
     * actual network runs, hook the wrapped resource instead.
     */
    onQueryStarted?: (args: TArgs, ctx: TQueryStartedContext<TArgs, TItem[]>) => void | Promise<void>;
    /** Retention for the per-id-set cache entries; falls back to the api default. */
    retentionTime?: number | false;
    /** Serializes the batch resource's own args into a cache key. */
    serializeArgs?: (args: TArgs) => string;
}
