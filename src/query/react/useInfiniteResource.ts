import React from "react";

import { useIsomorphicLayoutEffect } from "@/common/react";
import type {
    IResource,
    IResourceClutch,
    TArgsOrKeyed,
    TArgsOrVoidOrSkip,
    TInfiniteResourceState,
    TKeyed,
    TResourceClutchState,
} from "@/query/types";
import { Signal, type StateSignal } from "@/signals";
import { useSignal } from "@/signals/react";

import { SKIP } from "../constants";

// ==================== Internal feed store ====================

interface TPage<TArgs, TData, TError> {
    /** Serialized page args — the page identity (deduplicates fetchNext calls). */
    key: string;
    clutch: IResourceClutch<TArgs, TData, TError>;
    /** Whether `clutch.start()` already ran (deferred to a layout effect for render-phase pages). */
    isStarted: boolean;
}

/**
 * Mutable engine behind one `useInfiniteResource` call: the ordered page list
 * lives in a signal, each page is an ordinary resource clutch with fixed args,
 * and `pagesState$` derives the per-page states reactively — so the hook
 * subscribes once regardless of how many pages are loaded (the page count is
 * dynamic, which rules out calling `useResource` per page).
 *
 * The feed identity — the initial args — is fixed at construction; the hook
 * creates a new store when it changes. Render never mutates a store other
 * renders may observe (see `useResourceClutch` for why that matters), and the
 * page list only changes from event handlers (`fetchNext` / `reset`).
 */
class InfiniteFeedStore<TArgs, TItem, TError> {
    private readonly _resource: IResource<TArgs, TItem[], TError>;
    private readonly _pages$: StateSignal<TPage<TArgs, TItem[], TError>[]>;

    /** Serialized initial args; `null` while the feed is idle (SKIP). */
    private readonly _initialKey: string | null;
    private _isStarted = false;

    /** Per-page contributions to the feed of the last {@link buildState} call. */
    private _lastPagesData: readonly (readonly TItem[] | null)[] | null = null;
    /** Flattened feed of the last {@link buildState} call (identity cache). */
    private _lastData: TItem[] | null = null;

    readonly pagesState$ = Signal.compute<TResourceClutchState<TArgs, TItem[], TError>[]>(
        () => this._pages$().map((page) => page.clutch.state$()),
        { isDisabled: true },
    );

    /**
     * The first page is created with its clutch set but not started;
     * {@link start} picks it up after render.
     */
    constructor(resource: IResource<TArgs, TItem[], TError>, initialArgs: TArgsOrVoidOrSkip<TArgs>) {
        this._resource = resource;

        let pages: TPage<TArgs, TItem[], TError>[] = [];
        this._initialKey = null;

        if (initialArgs !== SKIP) {
            const keyed = resource.toKeyed(initialArgs as TArgsOrKeyed<TArgs>);
            this._initialKey = keyed.key;
            pages = [this._createPage(keyed)];
        }

        this._pages$ = Signal.state(pages, { isDisabled: true });
    }

    /** Start every not-yet-started page. Runs in a layout effect after each render. */
    start(): void {
        this._isStarted = true;
        for (const page of this._pages$.peek()) {
            if (!page.isStarted) {
                page.isStarted = true;
                page.clutch.start();
            }
        }
    }

    /** See {@link TInfiniteResourceState.fetchNext}. */
    fetchNext = (args: TArgsOrKeyed<TArgs>): void => {
        if (this._initialKey === null) {
            console.warn("[useInfiniteResource] fetchNext() ignored: the feed is idle (initial args are SKIP).");
            return;
        }

        const keyed = this._resource.toKeyed(args);
        const pages = this._pages$.peek();

        const existing = pages.find((page) => page.key === keyed.key);
        if (existing) {
            // Requesting a known page again retries it whenever it is in the
            // `error` status — a failed first load (row 7) and a failed re-query
            // that kept its data (row 9) alike — and is a no-op otherwise
            // (double-click / StrictMode safe).
            if (existing.clutch.state$.peek().status === "error") {
                existing.clutch.retry();
            }
            return;
        }

        const page = this._createPage(keyed);
        // fetchNext runs from event handlers — outside render — so the page
        // can start immediately instead of waiting for the layout effect.
        if (this._isStarted) {
            page.isStarted = true;
            page.clutch.start();
        }
        this._pages$.set([...pages, page]);
    };

    /** See {@link TInfiniteResourceState.invalidate}. */
    invalidate = (): void => {
        for (const page of this._pages$.peek()) {
            const state = page.clutch.state$.peek();

            // A query is already in flight: both `invalidate()` and `retry()`
            // would be an undrawn edge of the transition diagram — a
            // `console.warn` plus a no-op. Checked first, because a pending
            // page may well carry data (an invalidation) or an error (a retry).
            if (state.isPending) continue;

            if (state.hasData) {
                // Rows 5 and 9 — re-check what is on screen, clearing the error.
                page.clutch.invalidate();
            } else if (state.hasError) {
                // Row 7 — nothing to re-check, only a failure to repeat.
                page.clutch.retry();
            }
            // Row 1 (idle) — the page observes nothing yet.
        }
    };

    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh = (): void => {
        this.invalidate();
    };

    /** See {@link TInfiniteResourceState.reset}. */
    reset = (): void => {
        const pages = this._pages$.peek();
        if (pages.length <= 1) return;
        this._pages$.set(pages.slice(0, 1));
    };

    /**
     * Assemble the public state from the derived per-page states.
     *
     * The loading flags are aggregates of the shape "some page is like this",
     * **not** a partition of `isPending` the way they are on a single clutch:
     * after invalidating a feed whose last page had failed, the head page is
     * re-queried behind its data (`isInvalidating`) while the tail retries with
     * nothing to show (`isLoadingNext`), so both are `true` at once.
     */
    buildState(pages: TResourceClutchState<TArgs, TItem[], TError>[]): TInfiniteResourceState<TArgs, TItem[], TError> {
        let error: TError | null = null;
        let isPending = false;
        let isLoadingNext = false;
        let isInvalidating = false;

        pages.forEach((page, index) => {
            // The first error in page order — it survives the retry that
            // follows, because a pending page keeps the failure it retries.
            if (error === null && page.error !== null) {
                error = page.error;
            }
            if (page.isPending) isPending = true;
            if (page.isInvalidating) isInvalidating = true;
            if (index > 0 && page.isInitialLoading) isLoadingNext = true;
        });

        const data = this._flattenData(pages);

        return {
            data,
            pages,
            isIdle: pages.length === 0,
            isInitialLoading: pages.length > 0 && pages[0].isInitialLoading,
            isPending,
            isLoadingNext,
            isInvalidating,
            hasData: data !== null,
            hasError: error !== null,
            error,
            fetchNext: this.fetchNext,
            invalidate: this.invalidate,
            refresh: this.refresh,
            reset: this.reset,
        };
    }

    /**
     * Flatten the per-page `data` arrays into a single feed array.
     *
     * Only a page holding data of its *own* args (`dataSource: "current"`)
     * contributes: placeholder or previous-args data belongs to no page of the
     * feed, and splicing it in would smuggle foreign items between the
     * neighbours' items. Such a page is memoized as `null`, so a page that
     * merely changes `dataSource` while reusing its `data` reference still
     * invalidates the identity cache below.
     *
     * Identity-stable: when every page's contribution is unchanged since the
     * last call (e.g. a pure status flip such as success → pending, which
     * reuses `data` by reference), the previous flattened array is returned
     * as-is — so `Object.is` gates downstream (`React.useMemo` deps,
     * memoized/virtualized lists keyed on `state.data`) see no change.
     * The rebuild itself is a single-pass push into one array (O(total items)),
     * never a chained `concat`.
     */
    private _flattenData(pages: TResourceClutchState<TArgs, TItem[], TError>[]): TItem[] | null {
        const prev = this._lastPagesData;
        let unchanged = prev !== null && prev.length === pages.length;

        const pagesData: (TItem[] | null)[] = new Array(pages.length);
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const pageData = page.dataSource === "current" ? page.data : null;
            pagesData[i] = pageData;
            if (unchanged && prev![i] !== pageData) unchanged = false;
        }
        this._lastPagesData = pagesData;

        if (unchanged) return this._lastData;

        let data: TItem[] | null = null;
        for (const pageData of pagesData) {
            if (pageData === null) continue;
            if (data === null) data = [];
            for (const item of pageData) data.push(item);
        }
        this._lastData = data;
        return data;
    }

    private _createPage(keyed: TKeyed<TArgs>): TPage<TArgs, TItem[], TError> {
        const clutch = this._resource.createClutch();
        // `markPending` hides the not-yet-started gap as pending (same as useResource).
        clutch.switch(keyed as TArgsOrVoidOrSkip<TArgs>, { markPending: true });
        return { key: keyed.key, clutch, isStarted: false };
    }
}

// ==================== Hook ====================

/**
 * Infinite loading over a projection resource: an ordered feed of *pages*, each
 * page an ordinary cache entry (id-set) of the projection resource. Loaded pages
 * never re-render on tail growth (their entries are untouched), items shared
 * between pages are deduplicated by the projection item cache, and item updates
 * (e.g. an overlapping set's invalidate) propagate into every live page through
 * the batch's stream projections.
 *
 * The id-sets of the next pages come from the caller (typically from a
 * separate paginator query) via `fetchNext(nextArgs)` — the hook does not
 * know whether more pages exist.
 *
 * Changing `initialArgs` (by cache key) resets the feed to its new first page.
 *
 * Page invariants: a page's args are fixed for its whole lifetime and the
 * projection resource has no `placeholderData`, so a page's `dataSource` is
 * only `none` or `current` and its `isSwitching` is always `false`. Only pages
 * holding data of their own args contribute to `data`.
 */
export function useInfiniteResource<TArgs, TItem, TError = unknown>(
    resource: IResource<TArgs, TItem[], TError>,
    initialArgs: TArgsOrVoidOrSkip<TArgs>,
): TInfiniteResourceState<TArgs, TItem[], TError> {
    const key = initialArgs === SKIP ? SKIP : resource.serialize(initialArgs as TArgsOrKeyed<TArgs>);

    // One store per feed identity (see the class doc). Keyed by the serialized
    // args, not their identity: an inline literal is a new object every render.
    const store = React.useMemo(
        () => new InfiniteFeedStore<TArgs, TItem, TError>(resource, initialArgs),
        // `initialArgs` is represented by `key`.
        [resource, key],
    );

    useIsomorphicLayoutEffect(() => {
        store.start();
    }, [store]);

    const pages = useSignal(store.pagesState$);

    return React.useMemo(() => store.buildState(pages), [store, pages]);
}
