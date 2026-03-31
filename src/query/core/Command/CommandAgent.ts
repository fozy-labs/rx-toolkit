import type { ArgsOrVoid, ICommandAgent, TCommandAgentState } from "@/query/types";
import { Signal } from "@/signals";
import type { ComputeFn } from "@/signals/types";

import type { Command } from "./Command";
import type { CommandCacheEntry } from "./CommandCacheEntry";

function deriveAgentState<TArgs, TResult>(
    entry: CommandCacheEntry<TArgs, TResult> | null,
): TCommandAgentState<TArgs, TResult> {
    if (!entry) {
        return {
            status: "idle",
            data: null,
            error: null,
            args: null,
            isLoading: false as const,
            isSuccess: false as const,
            isError: false as const,
        };
    }

    const machine = entry.peek();
    const { status } = machine;

    switch (status) {
        case "idle":
            return {
                status: "idle",
                data: null,
                error: null,
                args: null,
                isLoading: false as const,
                isSuccess: false as const,
                isError: false as const,
            };
        case "loading":
            return {
                status: "loading",
                data: null,
                error: null,
                args: machine.args,
                isLoading: true as const,
                isSuccess: false as const,
                isError: false as const,
            };
        case "success":
            return {
                status: "success",
                data: machine.data,
                error: null,
                args: machine.args,
                isLoading: false as const,
                isSuccess: true as const,
                isError: false as const,
            };
        case "error":
            return {
                status: "error",
                data: null,
                error: machine.error,
                args: machine.args,
                isLoading: false as const,
                isSuccess: false as const,
                isError: true as const,
            };
        default:
            throw new Error(`Unexpected command status: ${status as string}`);
    }
}

export class CommandAgent<TArgs, TResult> implements ICommandAgent<TArgs, TResult> {
    private _command: Command<TArgs, TResult>;
    private _key: symbol;
    private _entry$ = Signal.state<CommandCacheEntry<TArgs, TResult> | null>(null);

    readonly state$: ComputeFn<TCommandAgentState<TArgs, TResult>>;

    constructor(command: Command<TArgs, TResult>, key: symbol) {
        this._command = command;
        this._key = key;

        this.state$ = Signal.compute<TCommandAgentState<TArgs, TResult>>(() => {
            const entry = this._entry$();
            if (!entry) {
                return deriveAgentState<TArgs, TResult>(null);
            }
            // Subscribe to entry's reactive state to track changes
            entry.state$();
            return deriveAgentState(entry);
        }) as ComputeFn<TCommandAgentState<TArgs, TResult>>;
    }

    trigger(...args: ArgsOrVoid<TArgs>): Promise<TResult> {
        const entry = this._command._getOrCreateEntry(this._key);
        this._entry$.set(entry);
        return entry.initiate(args[0] as TArgs);
    }

    reset(): void {
        const entry = this._entry$.peek();
        if (entry) {
            entry.resetToIdle();
        }
    }
}
