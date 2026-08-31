import { Observable } from "rxjs";

import { stableStringify } from "@/query/lib/stableStringify";
import type { ArgsOrVoid, IResource, TBatchResourceOptions, TCacheEntryAddedContext } from "@/query/types";
import { Batcher, Signal, unstable_KeyedSignal } from "@/signals";

import { BatchItemMissingError } from "../errors";

// ==================== BatchRuntime ====================

/**
 * Engine behind `api.createBatchResource`.
 *
 * The batch resource itself is an ordinary {@link IResource} caching one entry
 * per id-set, so agents, React hooks, SWR and plugin augmentation work
 * unchanged. This runtime plugs into that resource (as its `queryFn` +
 * `onCacheEntryAdded`) and deduplicates the traffic underneath.
 *
 * The item cache is reactive (a keyed signal of per-id boxes) and the outer
 * queryFn returns a *stream*: once the initial fetches land, the run projects
 * the watched ids over the item cache and keeps emitting for as long as the
 * entry lives. Cross-set consistency falls out of that projection — when one
 * set's refresh distributes fresh items, every overlapping live entry re-emits
 * with them (rebasing its active optimistic patches), with no write-back pass.
 *
 * - a shared per-id item cache is consulted first — only the ids that are
 *   neither cached nor already in flight reach the wrapped resource
 *   (`makeArgs(missingIds)`);
 * - a run whose ids are all covered by cache/in-flight batches performs no
 *   request at all;
 * - a refresh run bypasses the item cache and refetches every requested id
 *   (detected via the entry's machine, which `_execute` moves to `refreshing`
 *   before calling `queryFn`);
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

    /**
     * Reactive item cache: serialized id → boxed item. The box distinguishes a
     * cached `undefined`-ish item from absence; the keyed signal gives each
     * open run's projection fine-grained per-id reactivity.
     */
    private readonly _items = unstable_KeyedSignal.state<{ item: TItem }>();
    /** How many live outer entries reference each serialized id. */
    private readonly _refCounts = new Map<string, number>();
    /** Serialized id → the in-flight batch fetch covering it. */
    private readonly _inFlight = new Map<string, Promise<void>>();

    /** One warning per batch resource about set-local patch semantics. */
    private _didWarnSetLocalPatch = false;

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
     * The outer resource's queryFn — a stream per run:
     *
     * 1. On subscribe, the ids missing from the item cache are fetched through
     *    the wrapped resource (all requested ids on a refresh run); ids already
     *    in flight are awaited instead of re-requested.
     * 2. Once the initial fetches land, the run emits the assembled `TItem[]`
     *    and stays subscribed to the watched ids: whenever another run
     *    distributes a fresh instance of one of them, the projection re-emits.
     *    The stream never completes — it is torn down with the run
     *    (refresh/retry resubscribe, entry eviction unsubscribes).
     * 3. A failed fetch errors the stream; so does a response that did not
     *    cover every requested id ({@link BatchItemMissingError}).
     *
     * The abort signal is intentionally ignored: a batch fetch may be shared by
     * several id-set entries, so one entry's teardown must not cancel it — the
     * torn-down run simply unsubscribes and ignores the late result.
     */
    queryFn = (args: TArgs, _abortSignal: AbortSignal): Observable<TItem[]> => {
        return new Observable<TItem[]>((subscriber) => {
            let requestedSids: string[];
            let idBySid: Map<string, TId>;
            try {
                const requestedIds = this._parseArgs(args);
                requestedSids = requestedIds.map((id) => this._serializeId(id));

                // Deduplicate while preserving first-seen order.
                idBySid = new Map<string, TId>();
                requestedIds.forEach((id, index) => {
                    const sid = requestedSids[index];
                    if (!idBySid.has(sid)) idBySid.set(sid, id);
                });
            } catch (error) {
                subscriber.error(error);
                return;
            }

            // `_execute` moves the machine to `refreshing` before subscribing,
            // so a refresh run is observable here: it must bypass the item
            // cache and refetch every requested id instead of only the missing
            // ones. On the very first run the entry is not registered yet —
            // that run can only be an initial (pending) load, so `false` is
            // always correct.
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

            let projectionSub: { unsubscribe(): void } | null = null;
            let isClosed = false;

            // Live phase is gated behind the initial fetches: on a refresh run
            // the stale items are still cached, and emitting them right away
            // would complete the refresh with old data.
            void Promise.all(waits).then(
                () => {
                    if (isClosed) return;

                    // The response(s) may not have covered every requested id.
                    const missingIds: TId[] = [];
                    const missingSids: string[] = [];
                    for (const [sid, id] of idBySid) {
                        if (!this._items.has(sid)) {
                            missingIds.push(id);
                            missingSids.push(sid);
                        }
                    }
                    if (missingSids.length > 0) {
                        subscriber.error(new BatchItemMissingError(missingIds, missingSids));
                        return;
                    }

                    // One item per requested position (duplicates included).
                    // `null` (an id evicted mid-recompute) is transient and not
                    // emitted; refcounting guarantees this run's own ids stay
                    // cached for as long as its entry lives.
                    const projection = Signal.compute(() => {
                        const items: TItem[] = [];
                        for (const sid of requestedSids) {
                            const slot = this._items.get$(sid);
                            if (slot === undefined) return null;
                            items.push(slot.item);
                        }
                        return items;
                    });

                    projectionSub = projection.obs.subscribe((items) => {
                        if (items !== null) subscriber.next(items);
                    });
                },
                (error: unknown) => {
                    if (!isClosed) subscriber.error(error);
                },
            );

            return () => {
                isClosed = true;
                projectionSub?.unsubscribe();
            };
        });
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

        // Patches on an id-set entry are legitimate but set-local (the shared
        // item cache and overlapping sets do not see them), which diverges
        // from plain-resource expectations — surface that once, on the first
        // patch, covering both direct createPatch calls and command links.
        const entry = ctx.entry;
        const originalCreatePatch = entry.createPatch.bind(entry);
        entry.createPatch = (patchFn) => {
            this._warnSetLocalPatch();
            return originalCreatePatch(patchFn);
        };

        // Subscribed directly (instead of awaiting $cacheEntryRemoved) so the
        // release is synchronous with the entry's completion: a fetch issued in
        // the same tick as a reset must not see the already-evicted items. The
        // subscription cleans itself up — completed$ completes after firing.
        ctx.entry.completed$.subscribe(() => {
            Batcher.run(() => {
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
        });
    };

    // ==================== Private ====================

    private _warnSetLocalPatch(): void {
        if (this._didWarnSetLocalPatch) return;
        this._didWarnSetLocalPatch = true;
        console.warn(
            "[rx-toolkit] A patch on a batch resource is set-local: the shared item cache and " +
                "overlapping id-set entries do not see it. This entry keeps receiving item updates — " +
                "they rebase over the patch until it settles. " +
                "See docs/query/usage/batch-resource.md.",
        );
    }

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

    /**
     * Spread a batch response over the reactive item cache. Live projections
     * watching the touched ids re-emit on their own; the writes are batched so
     * one response produces a single emission per affected entry.
     */
    private _distribute(data: TResData): void {
        const parsed = this._parseData(data);

        Batcher.run(() => {
            for (const { id, item } of parsed) {
                const sid = this._serializeId(id);
                // Only ids referenced by a live outer entry are cached: this both
                // skips unsolicited extras and prevents writes after the requesting
                // entries were reset/GC'd mid-flight.
                if ((this._refCounts.get(sid) ?? 0) <= 0) continue;

                // Keep the box stable for an identical instance — no wake-ups
                // for consumers when nothing actually changed.
                const previous = this._items.get(sid);
                if (previous && Object.is(previous.item, item)) continue;

                this._items.set(sid, { item });
            }
        });
    }
}
