import { stableStringify } from "@/query/lib/stableStringify";
import type { ArgsOrVoid, IResource, TBatchResourceOptions, TCacheEntryAddedContext } from "@/query/types";

import { BatchItemMissingError } from "../errors";
import { Machine } from "../machine/Machine";

// ==================== BatchRuntime ====================

/**
 * Engine behind `api.createBatchResource`.
 *
 * The batch resource itself is an ordinary {@link IResource} caching one entry
 * per id-set, so agents, React hooks, SWR and plugin augmentation work
 * unchanged. This runtime plugs into that resource (as its `queryFn` +
 * `onCacheEntryAdded`) and deduplicates the traffic underneath:
 *
 * - a shared per-id item cache is consulted first — only the ids that are
 *   neither cached nor already in flight reach the wrapped resource
 *   (`makeArgs(missingIds)`);
 * - a run whose ids are all covered by cache/in-flight batches performs no
 *   request at all;
 * - a refresh run bypasses the item cache and refetches every requested id
 *   (detected via the entry's machine, which `_execute` moves to `refreshing`
 *   before calling `queryFn`);
 * - refreshed items are propagated into other overlapping `success` entries,
 *   so every id-set observes the same item instance;
 * - items are reference-counted by the entries whose args mention them and
 *   evicted once the last such entry is removed (retention GC / reset).
 */
export class BatchRuntime<TArgs, TId, TItem, TResArgs, TResData> {
    private readonly _wrapped: IResource<TResArgs, TResData>;
    private readonly _parseData: TBatchResourceOptions<TArgs, TId, TItem, TResArgs, TResData>["parseData"];
    private readonly _makeArgs: TBatchResourceOptions<TArgs, TId, TItem, TResArgs, TResData>["makeArgs"];
    private readonly _parseArgs: (args: TArgs) => readonly TId[];
    private readonly _serializeId: (id: TId) => string;

    /** The outer resource; late-bound because it is created around this runtime. */
    private _resource: IResource<TArgs, TItem[]> | null = null;

    /** Item cache: serialized id → boxed item (the box distinguishes a cached `undefined`-ish item from absence). */
    private readonly _items = new Map<string, { item: TItem }>();
    /** How many live outer entries reference each serialized id. */
    private readonly _refCounts = new Map<string, number>();
    /** Serialized id → the in-flight batch fetch covering it. */
    private readonly _inFlight = new Map<string, Promise<void>>();

    constructor(options: TBatchResourceOptions<TArgs, TId, TItem, TResArgs, TResData>) {
        this._wrapped = options.resource;
        this._parseData = options.parseData;
        this._makeArgs = options.makeArgs;
        this._parseArgs = options.parseArgs ?? ((args: TArgs) => args as unknown as readonly TId[]);
        this._serializeId = options.serializeId ?? (stableStringify as (id: TId) => string);
    }

    /** Bind the outer resource once `Api.createResource` has built it. */
    attach(resource: IResource<TArgs, TItem[]>): void {
        this._resource = resource;
    }

    /**
     * The outer resource's queryFn: resolve every requested id from the item
     * cache, fetching only the missing ones through the wrapped resource.
     *
     * The abort signal is intentionally ignored: a batch fetch may be shared by
     * several id-set entries, so one entry's teardown must not cancel it — the
     * outer machinery already discards results delivered after an abort.
     */
    queryFn = async (args: TArgs, _abortSignal: AbortSignal): Promise<TItem[]> => {
        const requestedIds = this._parseArgs(args);
        const requestedSids = requestedIds.map((id) => this._serializeId(id));

        // Deduplicate while preserving first-seen order.
        const idBySid = new Map<string, TId>();
        requestedIds.forEach((id, index) => {
            const sid = requestedSids[index];
            if (!idBySid.has(sid)) idBySid.set(sid, id);
        });

        // `_execute` moves the machine to `refreshing` before calling queryFn,
        // so a refresh run is observable here: it must bypass the item cache
        // and refetch every requested id instead of only the missing ones.
        // On the very first run the entry is not registered yet — that run can
        // only be an initial (pending) load, so `false` is always correct.
        const entry = this._resource?.getEntry(args as unknown as ArgsOrVoid<TArgs>) ?? null;
        const isRefreshRun = entry !== null && entry.machine$.peek().status === "refreshing";

        const waits = new Set<Promise<void>>();
        const idsToFetch: TId[] = [];
        const sidsToFetch: string[] = [];

        for (const [sid, id] of idBySid) {
            const inFlight = this._inFlight.get(sid);
            if (inFlight) {
                // Join the in-flight batch covering this id instead of duplicating it.
                waits.add(inFlight);
                continue;
            }
            if (!isRefreshRun && this._items.has(sid)) continue;
            idsToFetch.push(id);
            sidsToFetch.push(sid);
        }

        if (idsToFetch.length > 0) {
            waits.add(this._fetchBatch(idsToFetch, sidsToFetch));
        }
        if (waits.size > 0) {
            await Promise.all(waits);
        }

        // Assemble one item per requested position (duplicates included).
        const result: TItem[] = [];
        const missingIds: TId[] = [];
        const missingSids: string[] = [];
        for (let index = 0; index < requestedIds.length; index++) {
            const sid = requestedSids[index];
            const slot = this._items.get(sid);
            if (slot) {
                result.push(slot.item);
            } else if (!missingSids.includes(sid)) {
                missingIds.push(requestedIds[index]);
                missingSids.push(sid);
            }
        }

        if (missingSids.length > 0) {
            throw new BatchItemMissingError(missingIds, missingSids);
        }
        return result;
    };

    /**
     * Reference-count the ids of every outer entry so items survive exactly as
     * long as some live entry mentions them, and are evicted with the last one.
     */
    onCacheEntryAdded = (args: TArgs, ctx: TCacheEntryAddedContext<TArgs, TItem[]>): void => {
        let sids: string[];
        try {
            const seen = new Set<string>();
            sids = [];
            for (const id of this._parseArgs(args)) {
                const sid = this._serializeId(id);
                if (!seen.has(sid)) {
                    seen.add(sid);
                    sids.push(sid);
                }
            }
        } catch {
            // A throwing parseArgs/serializeId already fails the query run itself;
            // lifecycle bookkeeping must not throw on top of it.
            return;
        }

        for (const sid of sids) {
            this._refCounts.set(sid, (this._refCounts.get(sid) ?? 0) + 1);
        }

        // Subscribed directly (instead of awaiting $cacheEntryRemoved) so the
        // release is synchronous with the entry's completion: a fetch issued in
        // the same tick as a reset must not see the already-evicted items. The
        // subscription cleans itself up — completed$ completes after firing.
        ctx.entry.completed$.subscribe(() => {
            for (const sid of sids) {
                const next = (this._refCounts.get(sid) ?? 1) - 1;
                if (next <= 0) {
                    this._refCounts.delete(sid);
                    this._items.delete(sid);
                } else {
                    this._refCounts.set(sid, next);
                }
            }
        });
    };

    // ==================== Private ====================

    /** Fetch one batch of ids through the wrapped resource and register it as in-flight for each id. */
    private _fetchBatch(ids: TId[], sids: string[]): Promise<void> {
        const promise: Promise<void> = (async () => {
            const data = await this._wrapped.fetch(this._makeArgs(ids));
            this._distribute(data);
        })().finally(() => {
            for (const sid of sids) {
                if (this._inFlight.get(sid) === promise) this._inFlight.delete(sid);
            }
        });

        for (const sid of sids) {
            this._inFlight.set(sid, promise);
        }
        return promise;
    }

    /** Spread a batch response over the item cache and sync overlapping entries. */
    private _distribute(data: TResData): void {
        const parsed = this._parseData(data);
        const changedSids = new Set<string>();

        for (const { id, item } of parsed) {
            const sid = this._serializeId(id);
            // Only ids referenced by a live outer entry are cached: this both
            // skips unsolicited extras and prevents writes after the requesting
            // entries were reset/GC'd mid-flight.
            if ((this._refCounts.get(sid) ?? 0) <= 0) continue;

            const previous = this._items.get(sid);
            this._items.set(sid, { item });

            if (previous && !Object.is(previous.item, item)) {
                changedSids.add(sid);
            }
        }

        if (changedSids.size > 0) {
            this._syncEntries(changedSids);
        }
    }

    /**
     * Propagate refreshed items into the other id-set entries that hold them,
     * so every consumer observes the same item instance. Only clean `success`
     * entries are rewritten: pending/refreshing runs assemble from the item
     * cache themselves, and entries carrying optimistic patches must not lose
     * their patch state.
     */
    private _syncEntries(changedSids: Set<string>): void {
        if (!this._resource) return;

        for (const entry of this._resource.getEntries()) {
            const machine = entry.machine$.peek();
            if (machine.status !== "success" || machine.state.patchState) continue;

            let sids: string[];
            try {
                sids = this._parseArgs(entry.keyedArgs.value).map((id) => this._serializeId(id));
            } catch {
                continue;
            }
            if (!sids.some((sid) => changedSids.has(sid))) continue;

            const data: TItem[] = [];
            let isComplete = true;
            for (const sid of sids) {
                const slot = this._items.get(sid);
                if (!slot) {
                    isComplete = false;
                    break;
                }
                data.push(slot.item);
            }
            if (!isComplete) continue;

            entry.set(
                Machine.fromSnapshot<TArgs, TItem[]>(
                    { args: entry.keyedArgs.value, data, updatedAt: Date.now() },
                    false,
                ),
                "batch-sync",
            );
        }
    }
}
