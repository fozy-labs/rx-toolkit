import type { TLifecycleHookOption } from "./api";
import type { TCacheEntryAddedContext, TQueryStartedContext } from "./cache";
import type { TInFlightPolicy, TRetentionTime } from "./common";
import type { IResource, TResourceEntryIdleState, TResourceEntryState } from "./resource";

// ==================== Projection Resource Types ====================

/** A single `{ id, item }` pair extracted from the wrapped resource's response. */
export interface TProjectionParsedItem<TId, TItem> {
    id: TId;
    item: TItem;
}

/**
 * Options for `api.unstable_createProjectionResource` — a wrapper over an existing resource
 * that fetches collections of items by ids with per-item cache granularity:
 * only the ids missing from the shared item cache reach the wrapped resource.
 *
 * @template TArgs - The projection resource's own argument type (defaults to `TId[]`
 *   at the `unstable_createProjectionResource` call site when `parseArgs` is omitted).
 * @template TId - Per-item identifier type.
 * @template TItem - Single item type; the projection resource's data is `TItem[]`.
 * @template TResArgs - The wrapped resource's argument type.
 * @template TResData - The wrapped resource's response type.
 */
export interface TProjectionResourceOptions<TArgs, TId, TItem, TResArgs, TResData> {
    /** The wrapped resource that performs the actual batched requests. */
    resource: IResource<TResArgs, TResData>;
    /** Devtools/debug label; namespaced by the api `keyPrefix` like any resource key. */
    key?: string;
    /** Splits the wrapped resource's response into `{ id, item }` pairs. */
    parseData: (data: TResData) => ReadonlyArray<TProjectionParsedItem<TId, TItem>>;
    /** Builds the wrapped resource's args from the ids that actually need fetching. */
    makeArgs: (ids: TId[]) => TResArgs;
    /**
     * Extracts the requested ids from the projection resource's own args. Optional
     * when the args already are the id list (`TArgs` then defaults to `TId[]`).
     * Must be pure and deterministic — it is re-applied to cached entry args.
     */
    parseArgs?: (args: TArgs) => readonly TId[];
    /** Serializes an id into the item-cache key. Defaults to `stableStringify`. */
    serializeId?: (id: TId) => string;
    /**
     * Lifecycle hook over the id-set entries (args = the projection resource's own
     * args, data = the assembled `TItem[]`). Composed with the runtime's
     * internal bookkeeping hook. To observe the actual network runs, hook the
     * wrapped resource instead. See {@link TLifecycleHookOption} for the array form.
     */
    onCacheEntryAdded?: TLifecycleHookOption<(args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TItem[]>) => void>;
    /**
     * Lifecycle hook fired per id-set query run — including runs served
     * entirely from the item cache without a network request. To observe the
     * actual network runs, hook the wrapped resource instead. See
     * {@link TLifecycleHookOption} for the array form.
     */
    onQueryStarted?: TLifecycleHookOption<
        (args: TArgs, ctx: TQueryStartedContext<TArgs, TItem[]>) => void | Promise<void>
    >;
    /**
     * Retention for the per-id-set cache entries; falls back to the api default.
     * The function form decides per entry and receives the projection
     * resource's own args and the id-set entry's row (data = the assembled
     * `TItem[]`) — see {@link TRetentionTime}.
     */
    retentionTime?: TRetentionTime<TArgs, Exclude<TResourceEntryState<TArgs, TItem[]>, TResourceEntryIdleState>>;
    /** Serializes the projection resource's own args into a cache key. */
    serializeArgs?: (args: TArgs) => string;
    /**
     * What invalidating an id-set entry does to the wrapped resource's
     * requests in flight for its ids, unless the call says otherwise. The
     * id-set entry's own run — a live projection of the item cache — is never
     * restarted: it re-fetches its ids through the wrapped resource and
     * re-emits once the fresh items land.
     *
     * - `"cancel"` — one fresh request for every id of the set, issued now; a
     *   request in flight for exactly the same ids is aborted and reissued,
     *   answers of other requests begun earlier never overwrite its items.
     * - `"trail"` — the requests in flight for the set's ids settle first,
     *   then one fresh request for every id goes out.
     * - `"join"` — the requests in flight for the set's ids are the answer
     *   for the ids they cover; only the rest are requested. Beware: such a
     *   request may predate whatever made the data stale.
     *
     * Independent of the wrapped resource's own `invalidateInFlight`, which
     * governs invalidations of the wrapped resource itself.
     *
     * @default "cancel"
     */
    invalidateInFlight?: TInFlightPolicy;
}
