import React from "react";

import { useConstant, useIsomorphicLayoutEffect } from "@/common/react";
import type {
    Args,
    ArgsOrVoidOrSkip,
    IResource,
    IResourceAgent,
    Keyed,
    TInfiniteResourceState,
    TResourceAgentState,
} from "@/query/types";
import { Signal } from "@/signals";
import { useSignal } from "@/signals/react";

import { SKIP } from "../constants";

// ==================== Internal feed store ====================

const UNSET = Symbol("unset");

interface TPage<TArgs, TData, TError> {
    /** Serialized page args — the page identity (deduplicates fetchNext calls). */
    key: string;
    agent: IResourceAgent<TArgs, TData, TError>;
    /** Whether `agent.start()` already ran (deferred to a layout effect for render-phase pages). */
    isStarted: boolean;
}

/**
 * Mutable engine behind one `useInfiniteResource` call: the ordered page list
 * lives in a signal, each page is an ordinary resource agent with fixed args,
 * and `pagesState$` derives the per-page states reactively — so the hook
 * subscribes once regardless of how many pages are loaded (the page count is
 * dynamic, which rules out calling `useResource` per page).
 */
class InfiniteFeedStore<TArgs, TItem, TError> {
    private readonly _resource: IResource<TArgs, TItem[], TError>;
    private readonly _pages$ = Signal.state<TPage<TArgs, TItem[], TError>[]>([], { isDisabled: true });

    /** Raw initial args of the last sync — reference fast path, like useResource. */
    private _lastInitialArgs: unknown = UNSET;
    /** Serialized initial args; `null` while the feed is idle (SKIP). */
    private _initialKey: string | null = null;
    private _isStarted = false;

    /** Per-page `data` references of the last {@link buildState} call. */
    private _lastPagesData: readonly (readonly TItem[] | null | undefined)[] | null = null;
    /** Flattened feed of the last {@link buildState} call (identity cache). */
    private _lastData: TItem[] | null = null;

    readonly pagesState$ = Signal.compute<TResourceAgentState<TArgs, TItem[], TError>[]>(
        () => this._pages$().map((page) => page.agent.state$()),
        { isDisabled: true },
    );

    constructor(resource: IResource<TArgs, TItem[], TError>) {
        this._resource = resource;
    }

    /**
     * Render-phase sync, idempotent: (re)build the page list when the feed
     * identity — the initial args — changes. New pages are created with their
     * agents set but not started; {@link start} picks them up after render.
     */
    sync(initialArgs: ArgsOrVoidOrSkip<TArgs>): void {
        if (this._lastInitialArgs === initialArgs) return;
        this._lastInitialArgs = initialArgs;

        if (initialArgs === SKIP) {
            if (this._initialKey === null) return;
            this._initialKey = null;
            this._pages$.set([]);
            return;
        }

        const keyed = this._resource.toKeyed(initialArgs as Args<TArgs>);
        if (this._initialKey === keyed.key) return;

        this._initialKey = keyed.key;
        this._pages$.set([this._createPage(keyed)]);
    }

    /** Start every not-yet-started page. Runs in a layout effect after each render. */
    start(): void {
        this._isStarted = true;
        for (const page of this._pages$.peek()) {
            if (!page.isStarted) {
                page.isStarted = true;
                page.agent.start();
            }
        }
    }

    /** See {@link TInfiniteResourceState.fetchNext}. */
    fetchNext = (args: Args<TArgs>): void => {
        if (this._initialKey === null) {
            console.warn("[useInfiniteResource] fetchNext() ignored: the feed is idle (initial args are SKIP).");
            return;
        }

        const keyed = this._resource.toKeyed(args);
        const pages = this._pages$.peek();

        const existing = pages.find((page) => page.key === keyed.key);
        if (existing) {
            // Requesting a known page again retries it after a failure and is
            // a no-op otherwise (double-click / StrictMode safe).
            if (existing.agent.state$.peek().status === "error") {
                existing.agent.retry();
            }
            return;
        }

        const page = this._createPage(keyed);
        // fetchNext runs from event handlers — outside render — so the page
        // can start immediately instead of waiting for the layout effect.
        if (this._isStarted) {
            page.isStarted = true;
            page.agent.start();
        }
        this._pages$.set([...pages, page]);
    };

    /** See {@link TInfiniteResourceState.refresh}. */
    refresh = (): void => {
        for (const page of this._pages$.peek()) {
            const status = page.agent.state$.peek().status;
            if (status === "success" || status === "refresh-error") {
                page.agent.refresh();
            } else if (status === "error") {
                page.agent.retry();
            }
            // pending / refreshing — a query is already in flight.
        }
    };

    /** See {@link TInfiniteResourceState.reset}. */
    reset = (): void => {
        const pages = this._pages$.peek();
        if (pages.length <= 1) return;
        this._pages$.set(pages.slice(0, 1));
    };

    /** Assemble the public state from the derived per-page states. */
    buildState(pages: TResourceAgentState<TArgs, TItem[], TError>[]): TInfiniteResourceState<TArgs, TItem[], TError> {
        let error: TError | null = null;
        let isLoading = false;
        let isFetchingNext = false;

        pages.forEach((page, index) => {
            if (error === null && page.error !== null) {
                error = page.error;
            }
            if (page.isLoading) isLoading = true;
            if (index > 0 && page.isInitialLoading) isFetchingNext = true;
        });

        const data = this._flattenData(pages);

        return {
            data,
            pages,
            isIdle: pages.length === 0,
            isInitialLoading: pages.length > 0 && pages[0].isInitialLoading,
            isLoading,
            isFetchingNext,
            isError: error !== null,
            error,
            fetchNext: this.fetchNext,
            refresh: this.refresh,
            reset: this.reset,
        };
    }

    /**
     * Flatten the per-page `data` arrays into a single feed array.
     *
     * Identity-stable: when every page's `data` reference is unchanged since
     * the last call (e.g. a pure status flip such as success → refreshing,
     * which reuses `data` by reference), the previous flattened array is
     * returned as-is — so `Object.is` gates downstream (`React.useMemo` deps,
     * memoized/virtualized lists keyed on `state.data`) see no change.
     * The rebuild itself is a single-pass push into one array (O(total items)),
     * never a chained `concat`.
     */
    private _flattenData(pages: TResourceAgentState<TArgs, TItem[], TError>[]): TItem[] | null {
        const prev = this._lastPagesData;
        let unchanged = prev !== null && prev.length === pages.length;

        const pagesData: (TItem[] | null | undefined)[] = new Array(pages.length);
        for (let i = 0; i < pages.length; i++) {
            const pageData = pages[i].data;
            pagesData[i] = pageData;
            if (unchanged && prev![i] !== pageData) unchanged = false;
        }
        this._lastPagesData = pagesData;

        if (unchanged) return this._lastData;

        let data: TItem[] | null = null;
        for (const pageData of pagesData) {
            if (pageData == null) continue;
            if (data === null) data = [];
            for (const item of pageData) data.push(item);
        }
        this._lastData = data;
        return data;
    }

    private _createPage(keyed: Keyed<TArgs>): TPage<TArgs, TItem[], TError> {
        const agent = this._resource.createAgent();
        // `mark` hides the not-yet-started gap as pending (same as useResource).
        agent.set(keyed as ArgsOrVoidOrSkip<TArgs>, true);
        return { key: keyed.key, agent, isStarted: false };
    }
}

// ==================== Hook ====================

/**
 * Infinite loading over a projection resource: an ordered feed of *pages*, each
 * page an ordinary cache entry (id-set) of the projection resource. Loaded pages
 * never re-render on tail growth (their entries are untouched), items shared
 * between pages are deduplicated by the projection item cache, and item updates
 * (e.g. an overlapping set's refresh) propagate into every live page through
 * the batch's stream projections.
 *
 * The id-sets of the next pages come from the caller (typically from a
 * separate paginator query) via `fetchNext(nextArgs)` — the hook does not
 * know whether more pages exist.
 *
 * Changing `initialArgs` (by cache key) resets the feed to its new first page.
 */
export function useInfiniteResource<TArgs, TItem, TError = unknown>(
    resource: IResource<TArgs, TItem[], TError>,
    initialArgs: ArgsOrVoidOrSkip<TArgs>,
): TInfiniteResourceState<TArgs, TItem[], TError> {
    const store = useConstant(() => new InfiniteFeedStore<TArgs, TItem, TError>(resource), [resource]);

    store.sync(initialArgs);

    // No dep list on purpose: pages appended during a render-phase sync (feed
    // identity change) must start after *that* render, not only after the first.
    useIsomorphicLayoutEffect(() => {
        store.start();
    });

    const pages = useSignal(store.pagesState$);

    return React.useMemo(() => store.buildState(pages), [store, pages]);
}
