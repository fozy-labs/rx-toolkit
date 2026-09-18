import type {
    ICommandClutch,
    IQueryCacheEntry,
    TArgsOrKeyed,
    TCommandClutchState,
    TMachineState,
    TTriggerPromise,
} from "@/query/types";
import { Signal } from "@/signals";
import type { ReadonlySignal } from "@/signals/types";

import { isKeyed } from "../../lib/toKeyed";
import { wrapTrigger } from "../../lib/wrapTrigger";

// Minimal contract that CommandClutch needs from Command.
// If Command class doesn't exist yet, any object satisfying this works.
export interface ICommandForClutch<TArgs, TData> {
    execute(args: TArgsOrKeyed<TArgs>, entryKey?: string): Promise<TData>;
    getEntry$(entryKey: string): IQueryCacheEntry<TArgs, TData> | null;
}

// ==================== CommandClutch ====================

interface Tracking<TArgs, TData> {
    entryKey: string;
    current$: ReadonlySignal<IQueryCacheEntry<TArgs, TData> | null>;
}

export class CommandClutch<TArgs, TData, TError = unknown> implements ICommandClutch<TArgs, TData, TError> {
    private readonly _command: ICommandForClutch<TArgs, TData>;

    private readonly _tracking$: ReturnType<typeof Signal.state<Tracking<TArgs, TData> | null>>;

    /** Cache-entry key the clutch is bound to (via constructor/setEntryKey), reused by trigger. */
    private _boundEntryKey: string | undefined;

    readonly state$: ReadonlySignal<TCommandClutchState<TArgs, TData, TError>>;

    constructor(command: ICommandForClutch<TArgs, TData>, entryKey?: string) {
        this._command = command;
        this._tracking$ = Signal.state<Tracking<TArgs, TData> | null>(null, { isDisabled: true });
        this.state$ = Signal.compute<TCommandClutchState<TArgs, TData, TError>>(
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

        if (entryKey != null) {
            this.setEntryKey(entryKey);
        }
    }

    /**
     * Execute the mutation and track its cache entry via {@link state$}.
     *
     * Returns a {@link TTriggerPromise}: the envelope promise never rejects, so
     * a fire-and-forget call site cannot surface an unhandled rejection (the
     * failure still lands in {@link state$}); `unwrap()` hands back the raw
     * throwing promise.
     */
    trigger(args: TArgsOrKeyed<TArgs>, entryKey?: string): TTriggerPromise<TData, TError> {
        const resolvedEntryKey = isKeyed(args) ? args.key : (entryKey ?? this._boundEntryKey ?? crypto.randomUUID());

        // Command.execute never throws synchronously and normalizes every
        // rejection to TError itself. This guard only covers foreign
        // ICommandForClutch implementations that may still throw — such an error
        // reaches the envelope unmapped (best effort), since the clutch has no
        // access to the api's mapError.
        let result: Promise<TData>;
        try {
            result = this._command.execute(args, resolvedEntryKey);
            this._observeEntryKey(resolvedEntryKey);
        } catch (error) {
            result = Promise.reject(error);
        }

        return wrapTrigger<TData, TError>(result);
    }

    /** Bind the clutch to a cache-entry key: it observes that entry's state. */
    setEntryKey(entryKey: string): void {
        this._boundEntryKey = entryKey;
        this._observeEntryKey(entryKey);
    }

    /** @deprecated Renamed to {@link setEntryKey}. Will be removed in 0.14.0. */
    setKey(entryKey: string): void {
        this.setEntryKey(entryKey);
    }

    retry = (): void => {
        this._tracking$.peek()?.current$.peek()?.retry();
    };

    // ==================== Private ====================

    private _observeEntryKey(entryKey: string): void {
        const tracking = this._tracking$.peek();
        if (tracking && tracking.entryKey === entryKey) return;

        const current$ = Signal.compute(() => this._command.getEntry$(entryKey), { isDisabled: true });

        this._tracking$.set({ entryKey, current$ });
    }

    private _deriveState(
        entry: IQueryCacheEntry<TArgs, TData>,
        machineState: TMachineState<TArgs, TData>,
    ): TCommandClutchState<TArgs, TData, TError> {
        // Each machine status maps to one state variant, constructed per branch so
        // the compiler verifies every field against the discriminated union.
        switch (machineState.status) {
            // Command clutch uses a simplified status mapping: invalidating /
            // invalidate-error are not applicable to commands → remapped to pending
            // defensively, carrying their stale data / error through.
            case "pending":
            case "invalidating":
            case "invalidate-error": {
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

    private _createIdleState(): TCommandClutchState<TArgs, TData, TError> {
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
