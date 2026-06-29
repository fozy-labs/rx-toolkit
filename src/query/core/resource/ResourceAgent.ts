import { first, firstValueFrom } from "rxjs";

import type {
    Args,
    ArgsOrVoidOrSkip,
    IResourceAgent,
    Keyed,
    TAgentStatus,
    TMachineState,
    TResourceAgentState,
} from "@/query/types";
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
 * {@link TResourceAgentState} signal. When arguments change via {@link start},
 * the previous entry's data is preserved as stale fallback (SWR).
 *
 * @template TArgs - Query argument type.
 * @template TData - Query return data type.
 */
export class ResourceAgent<TArgs, TData> implements IResourceAgent<TArgs, TData> {
    private readonly _resource;

    private readonly _tracking$ = Signal.state<Tracking<TArgs, TData> | null>(null, { isDisabled: true });

    readonly state$ = Signal.compute<TResourceAgentState<TArgs, TData>>(() => this._deriveState(), {
        isDisabled: true,
    });

    private _previous$: ReadonlySignal<QueryCacheEntry<TArgs, TData> | null> | null = null;
    private _isStarted = false;
    private _isMarked = false;
    private _settledPromise: Promise<void> | null = null;

    constructor(resource: Resource<TArgs, TData>) {
        this._resource = resource;
    }

    get args(): TArgs | null {
        return this._tracking$.peek()?.keyed.value ?? null;
    }

    // ==================== Public API (IResourceAgent) ====================

    /**
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
     */
    set(args: ArgsOrVoidOrSkip<TArgs>, mark: boolean): void {
        this._isMarked = mark ?? false;
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
    private _isSettled(state: TResourceAgentState<TArgs, TData>): boolean {
        return state.status !== "idle" && state.status !== "pending";
    }

    private _deriveState(): TResourceAgentState<TArgs, TData> {
        const tracking = this._tracking$();
        if (!tracking) return this._idleState;

        const entry = tracking.current$();

        if (!entry) {
            if (this._isStarted) {
                queueMicrotask(() => this._resource.trigger(tracking.keyed));

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

    private _deriveNotIdleState(machineState: TMachineState<TArgs, TData>): TResourceAgentState<TArgs, TData> {
        let agentStatus: TAgentStatus = machineState.status;
        let data: TData | null = machineState.data;

        const previousEntry = this._previous$?.();

        // SWR: pending + previous data → refreshing
        if (machineState.status === "pending" && previousEntry) {
            const prevMachine = previousEntry.machine$();

            if (prevMachine.state.data != null) {
                agentStatus = "refreshing";
                data = prevMachine.state.data;
            }
        }

        // SWR: error + previous data → keep stale data
        if (machineState.status === "error" && previousEntry) {
            const prevMachine = previousEntry.machine$();

            if (prevMachine.state.data != null) {
                data = prevMachine.state.data;
            }
        }

        // Clear previous once success
        if (machineState.status === "success") {
            this._previous$ = null;
        }

        return {
            status: agentStatus,
            data,
            error: machineState.error,
            args: machineState.args,
            isLoading: agentStatus === "pending" || agentStatus === "refreshing",
            isInitialLoading: agentStatus === "pending",
            isRefreshing: agentStatus === "refreshing",
            isRefreshError: agentStatus === "refresh-error",
            isSuccess: agentStatus === "success",
            isError: agentStatus === "error" || agentStatus === "refresh-error",
            retry: this.retry,
            refresh: this.refresh,
        };
    }

    private _createPendingState(args: TArgs): TResourceAgentState<TArgs, TData> {
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

    private _idleState: TResourceAgentState<TArgs, TData> = {
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
