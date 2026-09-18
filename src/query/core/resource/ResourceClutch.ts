import { first, firstValueFrom } from "rxjs";

import type {
    IResourceClutch,
    TArgsOrKeyed,
    TArgsOrVoidOrSkip,
    TClutchSwitchOptions,
    TKeyed,
    TMachineState,
    TResourceClutchState,
    TRetrying,
} from "@/query/types";
import { Batcher, Signal, type ReadonlySignal } from "@/signals";

import { SKIP } from "../../constants";
import type { QueryCacheEntry } from "../cache/QueryCacheEntry";
import { NOT_RETRYING, retryingOf } from "../machine/machine-helpers";

import type { Resource } from "./Resource";

// ==================== ResourceClutch ====================

interface Tracking<TArgs, TData> {
    keyed: TKeyed<TArgs>;
    current$: ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
}

/** Whether the entry behind `entry$` holds data worth keeping as SWR fallback. */
function hasSettledData<TArgs, TData>(entry$: ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>): boolean {
    const status = entry$.peek()?.machine$.peek().state.status;
    return status === "success" || status === "invalidating" || status === "invalidate-error";
}

/**
 * Reactive observer for a {@link Resource} with SWR behaviour.
 *
 * The clutch tracks a single cache entry at a time, deriving a flat
 * {@link TResourceClutchState} signal. When arguments change via
 * {@link ResourceClutch.switch}, the previous entry's data is preserved as
 * stale fallback (SWR).
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
     * observation and drops back to `idle`.
     *
     * `options.markPending` (default `false`) makes an unstarted clutch report
     * `pending` (or `invalidating` over adopted stale data) rather than `idle`
     * while no cache entry exists yet: the React hooks create a clutch during
     * render but only start it in a layout effect, and marking hides that gap.
     */
    switch(args: TArgsOrVoidOrSkip<TArgs>, options?: TClutchSwitchOptions): void {
        this._isMarked = options?.markPending ?? false;
        const tracking = this._tracking$.peek();

        if (args === SKIP) {
            if (!tracking) return;

            this._previous$ = null;
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
     */
    adoptPrevious(source: IResourceClutch<TArgs, TData, TError>): void {
        if (!(source instanceof ResourceClutch)) return;

        const tracking = source._tracking$.peek() as Tracking<TArgs, TData> | null;

        this._previous$ = tracking && hasSettledData(tracking.current$) ? tracking.current$ : source._previous$;
    }

    /** Retry the last failed query. Only meaningful after an error state. */
    retry = () => {
        this._tracking$.peek()?.current$.peek()?.retry();
    };

    /** Force a background invalidation of the current entry (SWR). */
    invalidate = () => {
        this._tracking$.peek()?.current$.peek()?.invalidate();
    };

    /** @deprecated Renamed to {@link invalidate}. Will be removed in 0.14.0. */
    refresh = (): void => {
        this.invalidate();
    };

    /**
     * Promise resolving once the clutch leaves the initial-loading phase (see
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

    /** Whether a derived state represents anything other than initial loading. */
    private _isSettled(state: TResourceClutchState<TArgs, TData, TError>): boolean {
        return state.status !== "idle" && state.status !== "pending";
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

                return this._createLoadingState(tracking.keyed.value, NOT_RETRYING);
            }

            if (this._isMarked) {
                return this._createLoadingState(tracking.keyed.value, NOT_RETRYING);
            }

            return this._idleState;
        }

        const machine = entry.machine$();

        return this._deriveNotIdleState(machine.state);
    }

    private _promoteToPrevious(tracking: Tracking<TArgs, TData>): void {
        if (hasSettledData(tracking.current$)) {
            this._previous$ = tracking.current$;
        }
    }

    private _deriveNotIdleState(machineState: TMachineState<TArgs, TData>): TResourceClutchState<TArgs, TData, TError> {
        // Each machine status maps to one state variant, constructed per branch so
        // the compiler verifies every field against the discriminated union.
        switch (machineState.status) {
            case "pending": {
                return this._createLoadingState(machineState.args, retryingOf(machineState));
            }

            case "success": {
                // Clear previous once success
                this._previous$ = null;

                return {
                    status: "success",
                    data: machineState.data,
                    error: null,
                    args: machineState.args,
                    dataArgs: machineState.args,
                    isLoading: false,
                    isInitialLoading: false,
                    isRefreshing: false,
                    isSwitching: false,
                    isRetrying: false,
                    isRefreshError: false,
                    isSuccess: true,
                    isError: false,
                    retry: this.retry,
                    invalidate: this.invalidate,
                    refresh: this.refresh,
                };
            }

            case "error": {
                // SWR: error + previous data → keep stale data
                const previous = this._previous();

                return {
                    status: "error",
                    data: previous?.data ?? null,
                    // Sound per the mapError contract: the machine only ever holds errors
                    // already normalized to TError at the queryFn boundary.
                    error: machineState.error as TError,
                    args: machineState.args,
                    dataArgs: previous?.args ?? null,
                    isLoading: false,
                    isInitialLoading: false,
                    isRefreshing: false,
                    isSwitching: false,
                    isRetrying: false,
                    isRefreshError: false,
                    isSuccess: false,
                    isError: true,
                    retry: this.retry,
                    invalidate: this.invalidate,
                    refresh: this.refresh,
                };
            }

            case "invalidating": {
                return {
                    status: "invalidating",
                    data: machineState.data,
                    args: machineState.args,
                    dataArgs: machineState.args,
                    isLoading: true,
                    isInitialLoading: false,
                    isRefreshing: true,
                    isSwitching: false,
                    isRefreshError: false,
                    isSuccess: false,
                    isError: false,
                    retry: this.retry,
                    invalidate: this.invalidate,
                    refresh: this.refresh,
                    ...retryingOf<TArgs, TData, TError>(machineState),
                };
            }

            case "invalidate-error": {
                return {
                    status: "invalidate-error",
                    data: machineState.data,
                    // Sound per the mapError contract (see the error branch above).
                    error: machineState.error as TError,
                    args: machineState.args,
                    dataArgs: machineState.args,
                    isLoading: false,
                    isInitialLoading: false,
                    isRefreshing: false,
                    isSwitching: false,
                    isRetrying: false,
                    isRefreshError: true,
                    isSuccess: false,
                    isError: true,
                    retry: this.retry,
                    invalidate: this.invalidate,
                    refresh: this.refresh,
                };
            }
        }
    }

    /**
     * Stale data of the previous entry (SWR fallback) together with the args it
     * was loaded for, or `null` when there is no previous entry or it holds no
     * data. Reads the previous machine signal, subscribing the deriving computed
     * to its changes.
     */
    private _previous(): { data: TData; args: TArgs } | null {
        const previousEntry = this._previous$?.();
        if (!previousEntry) return null;

        const data = previousEntry.machine$().state.data;
        return data != null ? { data, args: previousEntry.keyedArgs.value } : null;
    }

    /**
     * Initial-loading state for `args`: `invalidating` (with `isSwitching`) over
     * the stale data of the previous entry when there is any (SWR), plain
     * `pending` otherwise. `retrying` carries the retry bookkeeping of the
     * underlying machine state (a `retry()` of a failed initial load).
     */
    private _createLoadingState(args: TArgs, retrying: TRetrying<TError>): TResourceClutchState<TArgs, TData, TError> {
        const previous = this._previous();

        if (previous) {
            return {
                status: "invalidating",
                data: previous.data,
                args,
                dataArgs: previous.args,
                isLoading: true,
                isInitialLoading: false,
                isRefreshing: true,
                isSwitching: true,
                isRefreshError: false,
                isSuccess: false,
                isError: false,
                retry: this.retry,
                invalidate: this.invalidate,
                refresh: this.refresh,
                ...retrying,
            };
        }

        return {
            status: "pending",
            data: null,
            args,
            dataArgs: null,
            isLoading: true,
            isInitialLoading: true,
            isRefreshing: false,
            isSwitching: false,
            isRefreshError: false,
            isSuccess: false,
            isError: false,
            retry: this.retry,
            invalidate: this.invalidate,
            refresh: this.refresh,
            ...retrying,
        };
    }

    private _idleState: TResourceClutchState<TArgs, TData, TError> = {
        status: "idle",
        data: null,
        error: null,
        args: null,
        dataArgs: null,
        isLoading: false,
        isInitialLoading: false,
        isRefreshing: false,
        isSwitching: false,
        isRetrying: false,
        isRefreshError: false,
        isSuccess: false,
        isError: false,
        retry: this.retry,
        invalidate: this.invalidate,
        refresh: this.refresh,
    };
}
