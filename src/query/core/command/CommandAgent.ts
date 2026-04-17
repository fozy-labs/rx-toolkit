import type { Args, ICommandAgent, IQueryCacheEntry, TCommandAgentState, TMachineState } from "@/query/types";
import { Signal } from "@/signals";
import type { ComputeFn } from "@/signals/types";

// Minimal contract that CommandAgent needs from Command.
// If Command class doesn't exist yet, any object satisfying this works.
export interface ICommandForAgent<TArgs, TData> {
    trigger(args: Args<TArgs>, key?: string): Promise<TData>;
    getEntry$(key: string): IQueryCacheEntry<TArgs, TData> | null;
}

// ==================== CommandAgent ====================

interface Tracking<TArgs, TData> {
    key: string;
    current$: ComputeFn<IQueryCacheEntry<TArgs, TData> | null>;
}

export class CommandAgent<TArgs, TData> implements ICommandAgent<TArgs, TData> {
    private readonly _command: ICommandForAgent<TArgs, TData>;

    private readonly _tracking$: ReturnType<typeof Signal.state<Tracking<TArgs, TData> | null>>;

    readonly state$: ComputeFn<TCommandAgentState<TArgs, TData>>;

    constructor(command: ICommandForAgent<TArgs, TData>, key?: string) {
        this._command = command;
        this._tracking$ = Signal.state<Tracking<TArgs, TData> | null>(null, { isDisabled: true });
        this.state$ = Signal.compute<TCommandAgentState<TArgs, TData>>(
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

    async trigger(args: Args<TArgs>, key?: string): Promise<TData> {
        const result = this._command.trigger(args, key);

        if (key != null) {
            this._observeKey(key);
        }

        return result;
    }

    setKey(key: string): void {
        this._observeKey(key);
    }

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
    ): TCommandAgentState<TArgs, TData> {
        // Command agent uses a simplified status mapping:
        // refreshing / refresh-error are not applicable to commands → map to pending.
        const machineStatus = machineState.status;
        const status: TCommandAgentState<TArgs, TData>["status"] =
            machineStatus === "refreshing" || machineStatus === "refresh-error" ? "pending" : machineStatus;

        return {
            status,
            data: machineState.data,
            error: machineState.error,
            args: machineState.args,
            isLoading: status === "pending",
            isSuccess: status === "success",
            isError: status === "error",
        };
    }

    private _createIdleState(): TCommandAgentState<TArgs, TData> {
        return {
            status: "idle",
            data: null,
            error: null,
            args: null,
            isLoading: false,
            isSuccess: false,
            isError: false,
        };
    }
}
