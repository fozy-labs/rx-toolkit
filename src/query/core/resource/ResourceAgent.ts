import { first, firstValueFrom } from "rxjs";

import type { Args, ArgsOrVoidOrSkip, IResourceAgent, Keyed, TMachineState, TResourceAgentState } from "@/query/types";
import { Batcher, Signal, type ReadonlySignal } from "@/signals";

import { SKIP } from "../../constants";
import type { QueryCacheEntry } from "../cache/QueryCacheEntry";

import type { Resource } from "./Resource";

// ==================== ResourceAgent ====================

interface Tracking<TArgs, TData> {
    keyed: Keyed<TArgs>;
    current$: ReadonlySignal<QueryCacheEntry<TArgs, TData> | null>;
}

/**
 * Reactive observer for a {@link Resource} with SWR behaviour.
 *
 * The agent tracks a single cache entry at a time, deriving a flat
 * {@link TResourceAgentState} signal. When arguments change via {@link set},
 * the previous entry's data is preserved as stale fallback (SWR).
 *
 * @template TArgs - Query argument type.
 * @template TData - Query return data type.
 */
export class ResourceAgent<TArgs, TData, TError = unknown> implements IResourceAgent<TArgs, TData, TError> {
    private readonly _resource;

    private readonly _tracking$ = Signal.state<Tracking<TArgs, TData> | null>(null, { isDisabled: true });

    readonly state$ = Signal.compute<TResourceAgentState<TArgs, TData, TError>>(() => this._deriveState(), {
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

    // ==================== Public API (IResourceAgent) ====================

    /**
     * Start observing with the args previously supplied to {@link set}, and
     * trigger the query for them. A no-op beyond flipping the started flag when
     * no args have been set yet (or after `SKIP`); the query then starts from
     * the next {@link set}.
     */
    start(): void {
        this._isStarted = true;

        const tracking = this._tracking$.peek();

        if (!tracking) {
            return;
        }

        this._resource.trigger(tracking.keyed);
    }

    /**
     * Set the observed args. Before {@link start} this only records them; once
     * the agent is started, changing the args also triggers the query for them.
     * `SKIP` clears the observation and drops the agent back to `idle`.
     *
     * `mark` (default `false`) makes an unstarted agent report `pending` rather
     * than `idle` while no cache entry exists yet: `useResource` sets args during
     * render but only starts in a layout effect, and marking hides that gap.
     */
    set(args: ArgsOrVoidOrSkip<TArgs>, mark: boolean = false): void {
        this._isMarked = mark;
        const tracking = this._tracking$.peek();

        if (args === SKIP) {
            if (!tracking) return;

            this._previous$ = null;
            this._tracking$.set(null);
            return;
        }

        const keyed = this._resource.toKeyed(args as Args<TArgs>);

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
                this._resource.trigger(keyed);
            }

            this._tracking$.set({
                keyed,
                current$: newEntry,
            });
        });
    }

    /** Retry the last failed query. Only meaningful after an error state. */
    retry = () => {
        this._tracking$.peek()?.current$.peek()?.retry();
    };

    /** Force a background refresh of the current entry (SWR). */
    refresh = () => {
        this._tracking$.peek()?.current$.peek()?.refresh();
    };

    /**
     * Promise resolving once the agent leaves the initial-loading phase (see
     * {@link IResourceAgent.whenSettled}).
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

        // Never rejects: a settle resolves it; teardown (agent disposed before
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
    private _isSettled(state: TResourceAgentState<TArgs, TData, TError>): boolean {
        return state.status !== "idle" && state.status !== "pending";
    }

    private _deriveState(): TResourceAgentState<TArgs, TData, TError> {
        const tracking = this._tracking$();
        if (!tracking) return this._idleState;

        const entry = tracking.current$();

        if (!entry) {
            if (this._isStarted) {
                // A trigger has side effects (creates a cache entry + starts a fetch),
                // so it cannot run synchronously inside this computed. Defer it — but on
                // the microtask re-check that `tracking` is still the live one: args may
                // have advanced, or the agent may have been stopped/cleared, within the
                // same tick. Triggering the captured key then would spawn a phantom cache
                // entry + fetch for args nobody tracks anymore.
                queueMicrotask(() => {
                    if (this._isStarted && this._tracking$.peek()?.keyed.key === tracking.keyed.key) {
                        this._resource.trigger(tracking.keyed);
                    }
                });

                return this._createPendingState(tracking.keyed.value);
            }

            if (this._isMarked) {
                return this._createPendingState(tracking.keyed.value);
            }

            return this._idleState;
        }

        const machine = entry.machine$();

        return this._deriveNotIdleState(machine.state);
    }

    private _promoteToPrevious(tracking: Tracking<TArgs, TData> | null): void {
        if (!tracking) return;

        const current$ = tracking.current$;

        if (current$) {
            const status = current$.peek()?.machine$.peek().state.status;
            if (status === "success" || status === "refreshing" || status === "refresh-error") {
                this._previous$ = current$;
            }
        }
    }

    private _deriveNotIdleState(machineState: TMachineState<TArgs, TData>): TResourceAgentState<TArgs, TData, TError> {
        // Each machine status maps to one state variant, constructed per branch so
        // the compiler verifies every field against the discriminated union.
        switch (machineState.status) {
            case "pending": {
                // SWR: pending + previous data → refreshing
                const prevData = this._previousData();

                if (prevData != null) {
                    return {
                        status: "refreshing",
                        data: prevData,
                        error: null,
                        args: machineState.args,
                        isLoading: true,
                        isInitialLoading: false,
                        isRefreshing: true,
                        isRefreshError: false,
                        isSuccess: false,
                        isError: false,
                        retry: this.retry,
                        refresh: this.refresh,
                    };
                }

                return this._createPendingState(machineState.args);
            }

            case "success": {
                // Clear previous once success
                this._previous$ = null;

                return {
                    status: "success",
                    data: machineState.data,
                    error: null,
                    args: machineState.args,
                    isLoading: false,
                    isInitialLoading: false,
                    isRefreshing: false,
                    isRefreshError: false,
                    isSuccess: true,
                    isError: false,
                    retry: this.retry,
                    refresh: this.refresh,
                };
            }

            case "error": {
                return {
                    status: "error",
                    // SWR: error + previous data → keep stale data
                    data: this._previousData(),
                    // Sound per the mapError contract: the machine only ever holds errors
                    // already normalized to TError at the queryFn boundary.
                    error: machineState.error as TError,
                    args: machineState.args,
                    isLoading: false,
                    isInitialLoading: false,
                    isRefreshing: false,
                    isRefreshError: false,
                    isSuccess: false,
                    isError: true,
                    retry: this.retry,
                    refresh: this.refresh,
                };
            }

            case "refreshing": {
                return {
                    status: "refreshing",
                    data: machineState.data,
                    error: null,
                    args: machineState.args,
                    isLoading: true,
                    isInitialLoading: false,
                    isRefreshing: true,
                    isRefreshError: false,
                    isSuccess: false,
                    isError: false,
                    retry: this.retry,
                    refresh: this.refresh,
                };
            }

            case "refresh-error": {
                return {
                    status: "refresh-error",
                    data: machineState.data,
                    // Sound per the mapError contract (see the error branch above).
                    error: machineState.error as TError,
                    args: machineState.args,
                    isLoading: false,
                    isInitialLoading: false,
                    isRefreshing: false,
                    isRefreshError: true,
                    isSuccess: false,
                    isError: true,
                    retry: this.retry,
                    refresh: this.refresh,
                };
            }
        }
    }

    /**
     * Stale data from the previous entry (SWR fallback), or `null` when there is
     * no previous entry or it holds no data. Reads the previous machine signal,
     * subscribing the deriving computed to its changes.
     */
    private _previousData(): TData | null {
        const previousEntry = this._previous$?.();
        if (!previousEntry) return null;

        const data = previousEntry.machine$().state.data;
        return data != null ? data : null;
    }

    private _createPendingState(args: TArgs): TResourceAgentState<TArgs, TData, TError> {
        return {
            status: "pending",
            data: null,
            error: null,
            args,
            isLoading: true,
            isInitialLoading: true,
            isRefreshing: false,
            isRefreshError: false,
            isSuccess: false,
            isError: false,
            retry: this.retry,
            refresh: this.refresh,
        };
    }

    private _idleState: TResourceAgentState<TArgs, TData, TError> = {
        status: "idle",
        data: null,
        error: null,
        args: null,
        isLoading: false,
        isInitialLoading: false,
        isRefreshing: false,
        isRefreshError: false,
        isSuccess: false,
        isError: false,
        retry: this.retry,
        refresh: this.refresh,
    };
}
