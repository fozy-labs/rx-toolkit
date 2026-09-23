import { Observable, type Subscriber } from "rxjs";

import { stableStringify } from "@/query/lib/stableStringify";
import type {
    IResource,
    TArgsOrVoid,
    TCacheEntryAddedContext,
    TInFlightPolicy,
    TProjectionResourceOptions,
} from "@/query/types";
import { Batcher, Signal, unstable_KeyedSignal, type ReadonlySignal } from "@/signals";

import type { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { CacheEntryRemovedError, PreMappedError, ProjectionItemMissingError } from "../errors";

// ==================== Types ====================

/**
 * How a run loads its ids: `null` for a cold load (the item cache first, then
 * the requests in flight, then the network), an in-flight policy for a load
 * that answers an invalidation (see {@link ProjectionRuntime._load}).
 */
type TLoadPolicy = TInFlightPolicy | null;

/** A batch fetch in flight, resolving with the serialized ids its response covered. */
type TBatch = Promise<ReadonlySet<string>>;

// ==================== ProjectionRuntime ====================

/**
 * Engine behind `api.unstable_createProjectionResource`.
 *
 * The projection resource itself is an ordinary {@link IResource} caching one entry
 * per id-set, so clutches, React hooks, SWR and plugin augmentation work
 * unchanged. This runtime plugs into that resource (as its `queryFn`,
 * `onCacheEntryAdded` and in-place revalidation) and deduplicates the
 * traffic underneath.
 *
 * The item cache is reactive (a keyed signal of per-id boxes) and the outer
 * queryFn returns a *stream*: once its ids are loaded, the run projects them
 * over the item cache and keeps emitting for as long as the entry lives.
 * Cross-set consistency falls out of that projection — when one set's
 * invalidation distributes fresh items, every overlapping live entry re-emits
 * with them (rebasing its active optimistic patches), with no write-back pass.
 *
 * - a shared per-id item cache is consulted first — only the ids that are
 *   neither cached nor already in flight reach the wrapped resource
 *   (`makeArgs(missingIds)`);
 * - a run whose ids are all covered by cache/in-flight batches performs no
 *   request at all;
 * - invalidating an id-set never restarts its run: the live run reloads its
 *   ids through the wrapped resource under the in-flight policy — `cancel`
 *   requests them all afresh now, `trail` once the requests in flight for them
 *   have settled, `join` takes those requests as the answer and requests
 *   only the rest — and re-emits once the reload lands (see
 *   {@link revalidateInRun});
 * - responses may land in any order, but an item is never overwritten by a
 *   batch issued before the one that wrote it — a late answer to a request
 *   an invalidation superseded cannot replace the fresh items;
 * - items are reference-counted by the entries whose args mention them and
 *   evicted once the last such entry is removed (retention GC / reset).
 */
export class ProjectionRuntime<TArgs, TId, TItem, TResArgs, TResData> {
    private readonly _wrapped: IResource<TResArgs, TResData>;
    private readonly _parseData: TProjectionResourceOptions<TArgs, TId, TItem, TResArgs, TResData>["parseData"];
    private readonly _makeArgs: TProjectionResourceOptions<TArgs, TId, TItem, TResArgs, TResData>["makeArgs"];
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
    /**
     * Serialized id → the most recently issued batch fetch covering it that
     * is still in flight. An older batch still in flight for the id is no
     * longer listed: whatever it brings, it cannot overwrite the newer one's
     * item (see {@link _itemSeq}).
     */
    private readonly _inFlight = new Map<string, TBatch>();
    /** Issue order of batch fetches: every batch takes the next number when it goes out. */
    private _batchSeq = 0;
    /**
     * Serialized id → issue number of the batch whose response the cached
     * item came from. Responses may land out of order; a batch never
     * overwrites an item written by a batch issued after it (see
     * {@link _distribute}). Kept in step with {@link _items}.
     */
    private readonly _itemSeq = new Map<string, number>();
    /**
     * The open runs, by the abort signal their queryFn call received — the
     * identity under which an outer entry hands a revalidation over (see
     * {@link revalidateInRun}).
     */
    private readonly _runs = new Map<AbortSignal, ProjectionRun<TId, TItem>>();

    /** One warning per projection resource about set-local patch semantics. */
    private _didWarnSetLocalPatch = false;

    constructor(options: TProjectionResourceOptions<TArgs, TId, TItem, TResArgs, TResData>) {
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
     * 1. On subscribe, the run loads its ids (see {@link _load}): a cold load
     *    fetches only the ids missing from the item cache and awaits those
     *    already in flight; a run started to answer an invalidation (a failed
     *    entry invalidated, or retried after a failed revalidation) loads
     *    under that invalidation's in-flight policy instead.
     * 2. Once the load lands, the run emits the assembled `TItem[]` and stays
     *    subscribed to the watched ids: whenever another run distributes a
     *    fresh instance of one of them, the projection re-emits. The stream
     *    never completes — it is torn down with the run (retry resubscribes,
     *    entry eviction unsubscribes).
     * 3. An invalidation of the entry reloads the ids in place
     *    ({@link revalidateInRun}); emissions are held back until the reload
     *    lands, then the run emits once — whether or not an item changed —
     *    which settles the entry's revalidation.
     * 4. A failed load errors the stream; so does a load whose responses did
     *    not cover every requested id ({@link ProjectionItemMissingError}).
     *
     * The abort signal is not wired to the requests: a batch fetch may be
     * shared by several id-set entries, so one entry's teardown must not
     * cancel it — the torn-down run simply ignores the late result. Nor can
     * that late result replace items a batch issued after it has written.
     * The signal only identifies the run for {@link revalidateInRun}.
     */
    queryFn = (args: TArgs, abortSignal: AbortSignal): Observable<TItem[]> => {
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

            // The entry knows whether this run answers an invalidation, and
            // under which policy — the status alone does not: a cold load
            // cancelled by `invalidate()` restarts from `pending`. On the very
            // first run the entry is not registered yet — that run can only be
            // a cold load, so `null` is always correct. The outer resource is
            // built by `Api.createResource`, so its entries are `QueryCacheEntry`s.
            const entry =
                (this._resource?.getEntry(args as unknown as TArgsOrVoid<TArgs>) as QueryCacheEntry<
                    TArgs,
                    TItem[]
                > | null) ?? null;
            const policy = entry?._invalidationRunPolicy ?? null;

            const run = new ProjectionRun<TId, TItem>({
                idBySid,
                subscriber,
                load: (loadPolicy) => this._load(idBySid, loadPolicy),
                projection: this._project(requestedSids),
            });
            this._runs.set(abortSignal, run);
            run.load(policy);

            return () => {
                run.close();
                if (this._runs.get(abortSignal) === run) this._runs.delete(abortSignal);
            };
        });
    };

    /**
     * The outer entries' in-place revalidation (see
     * `TRevalidateInRun` in `QueryCacheEntry`): the open run identified by
     * `signal` reloads its ids under `policy` and re-emits once they land. A
     * reload supersedes a load of the run still in flight. `false` when no
     * such run is open.
     */
    revalidateInRun = (signal: AbortSignal, policy: TInFlightPolicy): boolean => {
        const run = this._runs.get(signal);
        if (!run || run.isClosed) return false;
        run.load(policy);
        return true;
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
                        this._itemSeq.delete(sid);
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
            "[rx-toolkit] A patch on a projection resource is set-local: the shared item cache and " +
                "overlapping id-set entries do not see it. This entry keeps receiving item updates — " +
                "they rebase over the patch until it settles. " +
                "See docs/query/usage/projection-resource.md.",
        );
    }

    /**
     * The assembled items of one run, one per requested position (duplicates
     * included). `null` while an id is not cached — before its load lands, or
     * transiently mid-eviction; refcounting keeps a live entry's own ids
     * cached once written.
     */
    private _project(requestedSids: readonly string[]): ReadonlySignal<TItem[] | null> {
        return Signal.compute(() => {
            const items: TItem[] = [];
            for (const sid of requestedSids) {
                const slot = this._items.get$(sid);
                if (slot === undefined) return null;
                items.push(slot.item);
            }
            return items;
        });
    }

    /**
     * Load a run's ids into the item cache. Resolves with the serialized ids
     * the load found covered — by the item cache (a cold load only) or by the
     * responses it relied on — and rejects when a request it relied on fails.
     *
     * - `null` (cold load) — cached ids are served as they are, ids in flight
     *   await that request, the rest go out in one batch.
     * - `cancel` — one fresh batch for every id, issued now: neither the
     *   item cache nor the requests begun before it are trusted.
     * - `trail` — the requests in flight for these ids settle first (failures
     *   included), then one fresh batch for every id goes out.
     * - `join` — ids in flight await that request, which answers for them;
     *   the rest (cached or not) go out in one batch.
     *
     * The requests in flight are those this runtime issued, as listed in
     * {@link _inFlight} — the latest per id. The ones not awaited here are
     * not cancelled: they may be shared with other id-set entries, and their
     * answers cannot overwrite a later batch's items.
     */
    private async _load(idBySid: ReadonlyMap<string, TId>, policy: TLoadPolicy): Promise<ReadonlySet<string>> {
        if (policy === "trail") {
            const running = new Set<TBatch>();
            for (const sid of idBySid.keys()) {
                const batch = this._inFlight.get(sid);
                if (batch) running.add(batch);
            }
            if (running.size > 0) await Promise.allSettled(running);
        }

        const covered = new Set<string>();
        const waits = new Set<TBatch>();
        const idsToFetch: TId[] = [];
        const sidsToFetch: string[] = [];

        for (const [sid, id] of idBySid) {
            if (policy === null || policy === "join") {
                const batch = this._inFlight.get(sid);
                if (batch) {
                    waits.add(batch);
                    continue;
                }
            }
            if (policy === null && this._items.has(sid)) {
                covered.add(sid);
                continue;
            }
            idsToFetch.push(id);
            sidsToFetch.push(sid);
        }

        if (idsToFetch.length > 0) {
            waits.add(this._fetchBatch(idsToFetch, sidsToFetch, policy === "cancel" || policy === "trail"));
        }

        for (const batchCovered of await Promise.all(waits)) {
            for (const sid of batchCovered) covered.add(sid);
        }
        return covered;
    }

    /**
     * Fetch one batch of ids through the wrapped resource and register it as
     * in-flight for each id (replacing any previous registration — later runs
     * join this request). Resolves with the serialized ids the response
     * actually covered.
     *
     * @param isFresh - The batch must reach the server now. A run of the
     *   wrapped resource already in flight for the same args — begun earlier,
     *   it may predate the invalidation this batch answers — is cancelled
     *   first, whatever the wrapped resource's `invalidateInFlight`; whoever
     *   else awaits it receives the fresh result. A batch that is not fresh
     *   (a cold load, the ids a `join` found nothing in flight for) accepts
     *   such a run as its answer.
     */
    private _fetchBatch(ids: TId[], sids: string[], isFresh: boolean): TBatch {
        // Taken synchronously: the number orders batches by when they went out.
        const seq = ++this._batchSeq;

        const promise: TBatch = (async () => {
            let data: TResData;
            try {
                const args = this._wrapped.toKeyed(this._makeArgs(ids));
                // The invalidation makes a run go out now (or, on an entry
                // nobody holds, on the hold `fetch` takes); `fetch` then
                // awaits whichever run is in flight.
                if (isFresh) this._wrapped.invalidate(args, { inFlight: "cancel" });
                data = await this._wrapped.fetch(args, { inFlight: "join" });
            } catch (error) {
                // The wrapped resource rejects with its entry error, which
                // already passed the api's mapError at that entry's
                // normalization boundary — re-throw it in the PreMappedError
                // envelope so the outer id-set entry surfaces it as-is instead
                // of mapping it a second time. A removal rejection (the wrapped
                // entry reset mid-flight) is raw by contract and stays raw: the
                // outer entry maps it once, like any of its own failures.
                throw error instanceof CacheEntryRemovedError ? error : new PreMappedError(error);
            }
            return this._distribute(data, seq);
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
     *
     * Returns the serialized ids the response covered — independent of whether
     * each item was actually (re)cached (unreferenced or identical instances,
     * and items already written by a later-issued batch, are skipped but still
     * covered).
     *
     * @param seq - Issue number of the batch the response answers: an item
     *   written by a batch issued later is newer than this response, whatever
     *   the order the two landed in, and is kept.
     */
    private _distribute(data: TResData, seq: number): ReadonlySet<string> {
        const parsed = this._parseData(data);
        const covered = new Set<string>();

        Batcher.run(() => {
            for (const { id, item } of parsed) {
                const sid = this._serializeId(id);
                covered.add(sid);
                // Only ids referenced by a live outer entry are cached: this both
                // skips unsolicited extras and prevents writes after the requesting
                // entries were reset/GC'd mid-flight.
                if ((this._refCounts.get(sid) ?? 0) <= 0) continue;

                const writtenBy = this._itemSeq.get(sid);
                if (writtenBy !== undefined && writtenBy > seq) continue;
                this._itemSeq.set(sid, seq);

                // Keep the box stable for an identical instance — no wake-ups
                // for consumers when nothing actually changed.
                const previous = this._items.get(sid);
                if (previous && Object.is(previous.item, item)) continue;

                this._items.set(sid, { item });
            }
        });

        return covered;
    }
}

// ==================== ProjectionRun ====================

/**
 * One open run of an id-set entry: the stream subscriber, the live projection
 * of its ids and the load its emissions wait for.
 *
 * Loads are numbered; only the latest counts — a reload supersedes a load
 * still in flight, whose outcome is then ignored. While a load is in flight
 * the projection's emissions are held back: on a reload the entry is
 * `invalidating`, and an emission would settle it before the reload landed.
 * When the latest load lands, the run emits once — even if no item changed —
 * and the live projection flows again.
 */
class ProjectionRun<TId, TItem> {
    private readonly _idBySid: ReadonlyMap<string, TId>;
    private readonly _subscriber: Subscriber<TItem[]>;
    private readonly _loadIds: (policy: TLoadPolicy) => Promise<ReadonlySet<string>>;
    private readonly _projection: ReadonlySignal<TItem[] | null>;

    private _loadSeq = 0;
    private _isLoading = false;
    private _isClosed = false;
    private _projectionSub: { unsubscribe(): void } | null = null;

    constructor(options: {
        idBySid: ReadonlyMap<string, TId>;
        subscriber: Subscriber<TItem[]>;
        load: (policy: TLoadPolicy) => Promise<ReadonlySet<string>>;
        projection: ReadonlySignal<TItem[] | null>;
    }) {
        this._idBySid = options.idBySid;
        this._subscriber = options.subscriber;
        this._loadIds = options.load;
        this._projection = options.projection;
    }

    /** Whether the run was torn down or failed: it takes no more loads. */
    get isClosed(): boolean {
        return this._isClosed;
    }

    /** Start a load under `policy`, superseding the one in flight, if any. */
    load(policy: TLoadPolicy): void {
        if (this._isClosed) return;
        const seq = ++this._loadSeq;
        this._isLoading = true;

        const isCurrent = (): boolean => !this._isClosed && seq === this._loadSeq;

        this._loadIds(policy).then(
            (covered) => {
                if (!isCurrent()) return;

                // The responses may not have covered every requested id.
                const missingIds: TId[] = [];
                const missingSids: string[] = [];
                for (const [sid, id] of this._idBySid) {
                    if (!covered.has(sid)) {
                        missingIds.push(id);
                        missingSids.push(sid);
                    }
                }
                if (missingSids.length > 0) {
                    this._fail(new ProjectionItemMissingError(missingIds, missingSids));
                    return;
                }

                this._isLoading = false;
                this._emitLanded();
            },
            (error: unknown) => {
                if (isCurrent()) this._fail(error);
            },
        );
    }

    /** Tear the run down: nothing is emitted after this. */
    close(): void {
        this._isClosed = true;
        this._projectionSub?.unsubscribe();
        this._projectionSub = null;
    }

    private _fail(error: unknown): void {
        // Closed first: the error tears the stream down, and a revalidation
        // handed over meanwhile must be turned down, not swallowed.
        this.close();
        this._subscriber.error(error);
    }

    /**
     * The latest load landed: emit the current projection. The first time
     * this opens the live subscription, whose replay is that emission; later
     * it emits the current value explicitly, because a reload that changed
     * no item wakes no projection, yet must still settle the entry.
     */
    private _emitLanded(): void {
        if (!this._projectionSub) {
            this._projectionSub = this._projection.obs.subscribe((items) => {
                if (!this._isLoading && items !== null) this._subscriber.next(items);
            });
            return;
        }
        const items = this._projection.peek();
        if (items !== null) this._subscriber.next(items);
    }
}
