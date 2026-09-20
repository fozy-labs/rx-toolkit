import { first, firstValueFrom } from "rxjs";

import type {
    IResourceClutch,
    TArgsOrKeyed,
    TArgsOrVoidOrSkip,
    TClutchSwitchOptions,
    TKeyed,
    TQueryEntryPendingState,
    TQueryEntryState,
    TResourceClutchState,
    TResourceEntryState,
} from "@/query/types";
import { Batcher, Signal, type ReadonlySignal } from "@/signals";

import { SKIP } from "../../constants";
import type { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { errorSlotOf, isDataState } from "../machine/machine-helpers";

import { buildEntryState, buildPendingEntryState, IDLE_ENTRY_STATE } from "./entry-state";
import type { Resource } from "./Resource";

// ==================== ResourceClutch ====================

interface Tracking<TArgs, TData> {
    keyed: TKeyed<TArgs>;
    current$: ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
}

/** Lazy `placeholderData` result, memoized per args key. */
interface PlaceholderMemo<TData> {
    key: string;
    result: { data: TData } | null;
}

/** The loading flags of every settled (non-pending) row. */
const SETTLED_FLAGS = {
    isPending: false,
    isInitialLoading: false,
    isSwitching: false,
    isInvalidating: false,
} as const;

/**
 * Whether the entry behind `entry$` holds data worth keeping as SWR fallback.
 *
 * Asks the entry's state, not `data`: `TData` may itself be `null`, and an
 * entry that successfully loaded `null` has data to fall back on like any other.
 *
 * Non-reactive at both levels, and `peek()` rather than `state$.peek()`: the
 * latter subscribes and unsubscribes the entry's shared stream, which would
 * count as an `active → retention` transition.
 */
function hasSettledData<TArgs, TData>(entry$: ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>): boolean {
    const state = entry$.peek()?.peek();
    return state !== undefined && isDataState(state);
}

/**
 * Reactive observer for a {@link Resource} with SWR behaviour.
 *
 * The clutch tracks a single cache entry at a time, deriving a flat
 * {@link TResourceClutchState} signal — one of the fourteen rows of the state
 * matrix. `status` says only whether a query is in flight and how the last one
 * settled; what is on screen meanwhile is told by `dataSource`, which the
 * clutch (not the cache entry) owns: when the arguments change via
 * {@link ResourceClutch.switch}, the previous entry's data is preserved as
 * stale fallback (SWR), and the resource's `placeholderData` option can put
 * synthesized data in front of it.
 *
 * @template TArgs - Query argument type.
 * @template TData - Query return data type.
 */
export class ResourceClutch<TArgs, TData, TError = unknown> implements IResourceClutch<TArgs, TData, TError> {
    private readonly _resource;

    private readonly _tracking$ = Signal.state<Tracking<TArgs, TData> | null>(null, { isDisabled: true });

    readonly state$ = Signal.compute<TResourceClutchState<TArgs, TData, TError>>(() => this._deriveState(), {
        isDisabled: true,
    });

    private _previous$: ReadonlySignal<QueryCacheEntry<TArgs, TData> | null> | null = null;
    private _placeholder: PlaceholderMemo<TData> | null = null;
    private _isStarted = false;
    private _isMarked = false;
    private _settledPromise: Promise<void> | null = null;

    constructor(resource: Resource<TArgs, TData, TError>) {
        this._resource = resource;
    }

    get args(): TArgs | null {
        return this._tracking$.peek()?.keyed.value ?? null;
    }

    // ==================== Public API (IResourceClutch) ====================

    /**
     * Start observing with the args previously supplied to
     * {@link ResourceClutch.switch}, and trigger the query for them. A no-op
     * beyond flipping the started flag when no args have been set yet (or after
     * `SKIP`); the query then starts from the next
     * {@link ResourceClutch.switch}.
     */
    start(): void {
        this._isStarted = true;

        const tracking = this._tracking$.peek();

        if (!tracking) {
            return;
        }

        this._resource.getEntry(tracking.keyed, true);
    }

    /**
     * Engage the clutch on the given args. Before {@link start} this only
     * records them; once the clutch is started, changing the args also triggers
     * the query for them. `SKIP` disengages the clutch: it clears the
     * observation and drops back to `idle` (row 1).
     *
     * `options.markPending` (default `false`) makes an unstarted clutch report
     * `pending` rather than `idle` while no cache entry exists yet: the React
     * hooks create a clutch during render but only start it in a layout effect,
     * and marking hides that gap.
     */
    switch(args: TArgsOrVoidOrSkip<TArgs>, options?: TClutchSwitchOptions): void {
        this._isMarked = options?.markPending ?? false;
        const tracking = this._tracking$.peek();

        if (args === SKIP) {
            if (!tracking) return;

            this._previous$ = null;
            this._placeholder = null;
            this._tracking$.set(null);
            return;
        }

        const keyed = this._resource.toKeyed(args as TArgsOrKeyed<TArgs>);

        // Early return if same args
        if (tracking && tracking.keyed.key === keyed.key) {
            return;
        }

        if (tracking) {
            this._promoteToPrevious(tracking);
        }

        // The memoized placeholder belonged to the old args key. The SWR
        // fallback is deliberately kept: a placeholder only hides previous data,
        // it never drops it.
        this._placeholder = null;

        const newEntry = this._resource.getEntry$(keyed);

        Batcher.run(() => {
            if (this._isStarted) {
                this._resource.getEntry(keyed, true);
            }

            this._tracking$.set({
                keyed,
                current$: newEntry,
            });
        });
    }

    /**
     * @deprecated Renamed to {@link switch}; the boolean `mark` argument became
     * `{ markPending: true }`. Will be removed in 0.14.0.
     */
    set(args: TArgsOrVoidOrSkip<TArgs>, mark: boolean = false): void {
        this.switch(args, { markPending: mark });
    }

    /**
     * Take over `source`'s data as this clutch's SWR fallback, exactly as
     * {@link ResourceClutch.switch} would keep the previous entry when the args
     * change on a single clutch: `source`'s current entry if it holds settled
     * data, else whatever `source` itself was falling back on.
     *
     * For consumers that *replace* the clutch instead of mutating it — the
     * React hooks create one clutch per args so render stays pure, and hand the
     * stale data over from the last committed clutch to its successor.
     *
     * The placeholder memo is not carried over: it belongs to the clutch that
     * computed it, and the successor recomputes it from the adopted fallback.
     */
    adoptPrevious(source: IResourceClutch<TArgs, TData, TError>): void {
        if (!(source instanceof ResourceClutch)) return;

        const tracking = source._tracking$.peek() as Tracking<TArgs, TData> | null;

        this._previous$ = tracking && hasSettledData(tracking.current$) ? tracking.current$ : source._previous$;
    }

    /**
     * Re-run the failed query keeping the failure on screen: rows 7 → 10,
     * 8 → 11, 9 → 12, 13 → 14. Outside those edges the cache entry logs a
     * warning and does nothing.
     */
    retry = () => {
        this._tracking$.peek()?.current$.peek()?.retry();
    };

    /**
     * Re-query the current args and clear the failure: rows 5 → 6, 8 → 4,
     * 9 → 6, 13 → 3. Outside those edges it is a warning and a no-op.
     */
    invalidate = () => {
        const state = this.state$.peek();

        // Rows 7, 8 and 13 are one and the same entry status (`error`): which
        // of them is on screen depends on previous / placeholder data, and both
        // live in the clutch, invisible to the entry. The entry therefore has to
        // accept `invalidate()` from `error` (edges 8 → 4 and 13 → 3), and only
        // the clutch can reject row 7, where there is nothing to re-validate —
        // `retry()` is the edge the matrix draws out of it.
        if (state.status === "error" && state.dataSource === "none") {
            console.warn(
                "[ResourceClutch] invalidate() called with nothing on screen to re-validate: " +
                    "use retry() to re-run the failed query.",
            );
            return;
        }

        this._tracking$.peek()?.current$.peek()?.invalidate();
    };

    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh = (): void => {
        this.invalidate();
    };

    /**
     * Promise resolving once the clutch has something to render (see
     * {@link IResourceClutch.whenSettled}).
     *
     * Consumed by `useSuspenseResource`: a suspended render aborts its effects,
     * so this promise — created during render — is the only thing that can wake
     * React once the query settles. It never rejects; the actual error is read
     * from the derived state on the next render, keeping error handling inside
     * the React tree (Error Boundary) and avoiding unhandled rejections.
     *
     * The instance is cached for the duration of one loading phase so repeated
     * renders throw the same promise (a fresh promise every render would loop),
     * and cleared on settle so a later argument change can suspend again.
     */
    whenSettled(): Promise<void> {
        if (this._settledPromise) {
            return this._settledPromise;
        }

        if (this._isSettled(this.state$.peek())) {
            return Promise.resolve();
        }

        // Never rejects: a settle resolves it; teardown (clutch disposed before
        // settling — the source completes → EmptyError) merely clears the cache so a
        // later loading phase can suspend again. The instance is cached so repeated
        // renders throw the same promise.
        const settle = (): void => {
            this._settledPromise = null;
        };
        const promise = firstValueFrom(this.state$.obs.pipe(first((state) => this._isSettled(state)))).then(
            settle,
            settle,
        );

        this._settledPromise = promise;
        return promise;
    }

    // ==================== Private ====================

    /**
     * The Suspense rule: a state is settled once there is something to render
     * (`hasData` — current, placeholder or previous data) or the query failed
     * with nothing to show. Only rows 1, 2 and 10 are unsettled: a switching or
     * invalidating load is `pending`, but it has data and must not re-suspend.
     */
    private _isSettled(state: TResourceClutchState<TArgs, TData, TError>): boolean {
        return state.hasData || state.status === "error";
    }

    private _deriveState(): TResourceClutchState<TArgs, TData, TError> {
        const tracking = this._tracking$();
        if (!tracking) return this._idleState;

        const entry = tracking.current$();

        if (!entry) {
            if (this._isStarted) {
                // Entry creation has side effects (creates a cache entry + starts a
                // fetch), so it cannot run synchronously inside this computed. Defer it —
                // but on the microtask re-check that `tracking` is still the live one:
                // args may have advanced, or the clutch may have been stopped/cleared,
                // within the same tick. Creating the captured key then would spawn a
                // phantom cache entry + fetch for args nobody tracks anymore.
                queueMicrotask(() => {
                    if (this._isStarted && this._tracking$.peek()?.keyed.key === tracking.keyed.key) {
                        this._resource.getEntry(tracking.keyed, true);
                    }
                });

                return this._createLoadingState(tracking.keyed, null);
            }

            if (this._isMarked) {
                return this._createLoadingState(tracking.keyed, null);
            }

            return this._idleState;
        }

        return this._deriveNotIdleState(tracking.keyed, entry.state$());
    }

    private _promoteToPrevious(tracking: Tracking<TArgs, TData>): void {
        if (hasSettledData(tracking.current$)) {
            this._previous$ = tracking.current$;
        }
    }

    private _deriveNotIdleState(
        keyed: TKeyed<TArgs>,
        entryState: TQueryEntryState<TArgs, TData>,
    ): TResourceClutchState<TArgs, TData, TError> {
        // Rows whose data comes from the entry itself are the entry rows, shared
        // with `Resource.getState`; the clutch only adds its methods. Rows that
        // show what the entry does not have — a placeholder, or the previous
        // args' data — are built here, in display priority.
        switch (entryState.status) {
            // Rows 2 / 3 / 4, or 10 / 14 / 11 when the run retries a failure.
            case "pending": {
                return this._createLoadingState(keyed, entryState);
            }

            case "success": {
                // Row 5. Fresh data of the observed args outranks everything the
                // clutch held for them: the SWR fallback and the placeholder memo
                // have done their job and are dropped.
                this._previous$ = null;
                this._placeholder = null;

                return this._withMethods(buildEntryState<TArgs, TData, TError>(keyed.value, entryState));
            }

            case "error": {
                // Rows 13 / 8 / 7 — the entry holds nothing, so whatever the clutch
                // can still show stays on screen. An entry `error` always carries
                // its failure; the cast is sound per the mapError contract.
                const errorSlot = { hasError: true, error: entryState.error as TError } as const;
                const placeholder = this._placeholderFor(keyed);

                if (placeholder) {
                    return {
                        status: "error",
                        dataSource: "placeholder",
                        data: placeholder.data,
                        dataArgs: null,
                        hasData: true,
                        args: keyed.value,
                        ...errorSlot,
                        ...SETTLED_FLAGS,
                        ...this._methods,
                    };
                }

                const previous = this._previous();

                if (previous) {
                    return {
                        status: "error",
                        dataSource: "previous",
                        data: previous.data,
                        dataArgs: previous.args,
                        hasData: true,
                        args: keyed.value,
                        ...errorSlot,
                        ...SETTLED_FLAGS,
                        ...this._methods,
                    };
                }

                return this._withMethods(buildEntryState<TArgs, TData, TError>(keyed.value, entryState));
            }

            // Rows 6 / 12 and row 9 — the entry's own data is on screen, so
            // neither the placeholder nor the SWR fallback is consulted.
            case "invalidating":
            case "invalidate-error": {
                return this._withMethods(buildEntryState<TArgs, TData, TError>(keyed.value, entryState));
            }
        }
    }

    /** An entry row as a clutch row: the same fields plus the state methods. */
    private _withMethods(state: TResourceEntryState<TArgs, TData, TError>): TResourceClutchState<TArgs, TData, TError> {
        return { ...state, ...this._methods };
    }

    /**
     * Stale data of the previous entry (SWR fallback) together with the args it
     * was loaded for, or `null` when there is no previous entry or it holds no
     * data. Reads the previous entry's state signal, subscribing the deriving
     * computed to its changes.
     */
    private _previous(): { data: TData; args: TArgs } | null {
        const previousEntry = this._previous$?.();
        if (!previousEntry) return null;

        // Presence is a property of the entry's state, never of `data`: a query
        // that resolved `null` holds data, and dropping it here would silently
        // turn row 4 into row 2 and row 8 into row 7.
        const state = previousEntry.state$();
        return isDataState(state) ? { data: state.data, args: previousEntry.keyedArgs.value } : null;
    }

    /**
     * The resource's `placeholderData` result for these args, memoized on the
     * args key: the option is consulted once per key, so a retry, an
     * invalidation or a plain re-derivation reuses the first answer and the
     * `previous` it was handed stays a snapshot of that moment. The memo is
     * dropped when the args change, on `SKIP` and on `success`; a cache hit
     * never reaches this branch at all.
     */
    private _placeholderFor(keyed: TKeyed<TArgs>): { data: TData } | null {
        const placeholderData = this._resource._placeholderData;
        if (!placeholderData) return null;

        const memo = this._placeholder;
        if (memo && memo.key === keyed.key) return memo.result;

        const result = placeholderData(keyed.value, this._previous());
        this._placeholder = { key: keyed.key, result };
        return result;
    }

    /**
     * The in-flight state for `keyed`: a placeholder when the resource
     * synthesizes one (rows 3 / 14), else the previous args' data (rows 4 / 11),
     * else nothing (rows 2 / 10). `entryState` is the entry's pending state,
     * or `null` before the entry exists — a started (or marked) clutch is
     * already loading, and the entry it is about to create starts without a
     * failure.
     */
    private _createLoadingState(
        keyed: TKeyed<TArgs>,
        entryState: TQueryEntryPendingState<TArgs> | null,
    ): TResourceClutchState<TArgs, TData, TError> {
        const error = entryState?.error ?? null;
        const placeholder = this._placeholderFor(keyed);

        if (placeholder) {
            return {
                status: "pending",
                dataSource: "placeholder",
                data: placeholder.data,
                dataArgs: null,
                hasData: true,
                args: keyed.value,
                ...errorSlotOf<TError>(error),
                isPending: true,
                isInitialLoading: true,
                isSwitching: false,
                isInvalidating: false,
                ...this._methods,
            };
        }

        const previous = this._previous();

        if (previous) {
            return {
                status: "pending",
                dataSource: "previous",
                data: previous.data,
                dataArgs: previous.args,
                hasData: true,
                args: keyed.value,
                ...errorSlotOf<TError>(error),
                isPending: true,
                isInitialLoading: false,
                isSwitching: true,
                isInvalidating: false,
                ...this._methods,
            };
        }

        return this._withMethods(buildPendingEntryState<TArgs, TError>(keyed.value, error));
    }

    // Declared after the method fields above: a field initializer may only
    // read fields already initialized.

    /** The state methods, identical on every row; spread into each of them. */
    private readonly _methods = {
        retry: this.retry,
        invalidate: this.invalidate,
        refresh: this.refresh,
    };

    /** Row 1 — the clutch observes nothing. */
    private _idleState: TResourceClutchState<TArgs, TData, TError> = {
        ...IDLE_ENTRY_STATE,
        ...this._methods,
    };
}
