import type { Args, ICommandAgent, IQueryCacheEntry, TCommandAgentState, TMachineState } from "@/query/types";
import { Signal } from "@/signals";
import type { ReadonlySignal } from "@/signals/types";

import { isKeyed } from "../../lib/toKeyed";

// Minimal contract that CommandAgent needs from Command.
// If Command class doesn't exist yet, any object satisfying this works.
export interface ICommandForAgent<TArgs, TData> {
    execute(args: Args<TArgs>, key?: string): Promise<TData>;
    getEntry$(key: string): IQueryCacheEntry<TArgs, TData> | null;
}

// ==================== CommandAgent ====================

interface Tracking<TArgs, TData> {
    key: string;
    current$: ReadonlySignal<IQueryCacheEntry<TArgs, TData> | null>;
}

export class CommandAgent<TArgs, TData, TError = unknown> implements ICommandAgent<TArgs, TData, TError> {
    private readonly _command: ICommandForAgent<TArgs, TData>;

    private readonly _tracking$: ReturnType<typeof Signal.state<Tracking<TArgs, TData> | null>>;

    /** Cache key the agent is bound to (via constructor/setKey), reused by trigger. */
    private _boundKey: string | undefined;

    readonly state$: ReadonlySignal<TCommandAgentState<TArgs, TData, TError>>;

    constructor(command: ICommandForAgent<TArgs, TData>, key?: string) {
        this._command = command;
        this._tracking$ = Signal.state<Tracking<TArgs, TData> | null>(null, { isDisabled: true });
        this.state$ = Signal.compute<TCommandAgentState<TArgs, TData, TError>>(
            () => {
                const tracking = this._tracking$();
                if (!tracking) return this._createIdleState();

                const entry = tracking.current$();
                if (!entry) return this._createIdleState();

                const machineState = entry.state$().state;
                return this._deriveState(entry, machineState);
            },
            { isDisabled: true },
        );

        if (key != null) {
            this.setKey(key);
        }
    }

    /**
     * Execute the mutation and track its cache entry via {@link state$}.
     *
     * Returns the native mutation promise: resolves with the result, rejects
     * with the mapError-normalized error. The rejection is pre-handled here —
     * the internal no-op catch marks this promise as handled without consuming
     * the rejection — so a fire-and-forget call site never surfaces an
     * unhandled rejection (the failure still lands in {@link state$}), while
     * awaiting callers observe the rejection as usual.
     */
    trigger(args: Args<TArgs>, key?: string): Promise<TData> {
        const entryKey = isKeyed(args) ? args.key : (key ?? this._boundKey ?? crypto.randomUUID());

        // Command.execute never throws synchronously and normalizes every
        // rejection to TError itself. This guard only covers foreign
        // ICommandForAgent implementations that may still throw — such an error
        // reaches the caller unmapped (best effort), since the agent has no
        // access to the api's mapError.
        let result: Promise<TData>;
        try {
            result = this._command.execute(args, entryKey);
            this._observeKey(entryKey);
        } catch (error) {
            result = Promise.reject(error);
        }

        void result.catch(() => {});

        return result;
    }

    setKey(key: string): void {
        this._boundKey = key;
        this._observeKey(key);
    }

    retry = (): void => {
        this._tracking$.peek()?.current$.peek()?.retry();
    };

    // ==================== Private ====================

    private _observeKey(key: string): void {
        const tracking = this._tracking$.peek();
        if (tracking && tracking.key === key) return;

        const current$ = Signal.compute(() => this._command.getEntry$(key), { isDisabled: true });

        this._tracking$.set({ key, current$ });
    }

    private _deriveState(
        entry: IQueryCacheEntry<TArgs, TData>,
        machineState: TMachineState<TArgs, TData>,
    ): TCommandAgentState<TArgs, TData, TError> {
        // Each machine status maps to one state variant, constructed per branch so
        // the compiler verifies every field against the discriminated union.
        switch (machineState.status) {
            // Command agent uses a simplified status mapping: refreshing /
            // refresh-error are not applicable to commands → remapped to pending
            // defensively, carrying their stale data / error through.
            case "pending":
            case "refreshing":
            case "refresh-error": {
                return {
                    status: "pending",
                    data: machineState.data,
                    // Sound per the mapError contract: the machine only ever holds errors
                    // already normalized to TError at the queryFn boundary.
                    error: machineState.error as TError | null,
                    args: machineState.args,
                    isLoading: true,
                    isSuccess: false,
                    isError: false,
                    retry: this.retry,
                };
            }

            case "success": {
                return {
                    status: "success",
                    data: machineState.data,
                    error: null,
                    args: machineState.args,
                    isLoading: false,
                    isSuccess: true,
                    isError: false,
                    retry: this.retry,
                };
            }

            case "error": {
                return {
                    status: "error",
                    data: null,
                    // Sound per the mapError contract (see the pending branch above).
                    error: machineState.error as TError,
                    args: machineState.args,
                    isLoading: false,
                    isSuccess: false,
                    isError: true,
                    retry: this.retry,
                };
            }
        }
    }

    private _createIdleState(): TCommandAgentState<TArgs, TData, TError> {
        return {
            status: "idle",
            data: null,
            error: null,
            args: null,
            isLoading: false,
            isSuccess: false,
            isError: false,
            retry: this.retry,
        };
    }
}
