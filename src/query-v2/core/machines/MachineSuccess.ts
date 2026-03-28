import type { TPatchState, TSuccessState } from "@/query-v2/types";

import { MachinePending } from "./MachinePending";
import { MachineRefreshing } from "./MachineRefreshing";
import { MachineWithData } from "./MachineWithData";

/**
 * Success state — data available.
 * Extends MachineWithData for patch support.
 * Immutable: all transitions return new instances.
 */
export class MachineSuccess<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "success" as const;
    readonly error = null;
    readonly updatedAt: number;

    constructor(args: TArgs, data: TData, patchState: TPatchState<TData> | null, updatedAt: number) {
        super(args, data, patchState);
        this.updatedAt = updatedAt;
    }

    get state(): TSuccessState<TArgs, TData> {
        return {
            status: this.status,
            args: this.args,
            data: this.data,
            error: null,
            updatedAt: this.updatedAt,
            patchState: this.patchState,
        };
    }

    invalidate(): MachineRefreshing<TArgs, TData> {
        return new MachineRefreshing<TArgs, TData>(this.args, this.data, this.patchState, this.updatedAt);
    }

    start(args: TArgs): MachinePending<TArgs, TData> {
        return new MachinePending<TArgs, TData>(args);
    }

    protected cloneWith(updates: Record<string, unknown>): MachineSuccess<TArgs, TData> {
        return new MachineSuccess<TArgs, TData>(
            (updates.args as TArgs) ?? this.args,
            (updates.data as TData) ?? this.data,
            "patchState" in updates ? (updates.patchState as TPatchState<TData> | null) : this.patchState,
            (updates.updatedAt as number) ?? this.updatedAt,
        );
    }
}
