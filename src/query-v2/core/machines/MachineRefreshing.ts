import type { TPatchState, TRefreshingState } from "@/query-v2/types";

import { MachineSuccess } from "./MachineSuccess";
import { MachineWithData } from "./MachineWithData";
import { Patcher } from "./Patcher";

/**
 * Refreshing state — re-fetching while previous data is available.
 * Extends MachineWithData for patch support.
 * Immutable: all transitions return new instances.
 */
export class MachineRefreshing<TArgs, TData> extends MachineWithData<TArgs, TData> {
    readonly status = "refreshing" as const;
    readonly error = null;
    readonly updatedAt: number;

    constructor(args: TArgs, data: TData, patchState: TPatchState<TData> | null, updatedAt: number) {
        super(args, data, patchState);
        this.updatedAt = updatedAt;
    }

    get state(): TRefreshingState<TArgs, TData> {
        return {
            status: this.status,
            args: this.args,
            data: this.data,
            error: null,
            updatedAt: this.updatedAt,
            patchState: this.patchState,
        };
    }

    /**
     * On success: resolves patches on top of fresh server data.
     * If patches exist, calls Patcher.resolvePatches(serverData, patches).
     */
    successHappened(data: TData): MachineSuccess<TArgs, TData> {
        if (this.patchState) {
            const resolution = Patcher.resolvePatches(data, this.patchState.patches);
            return new MachineSuccess<TArgs, TData>(this.args, resolution.data, resolution.patchState, Date.now());
        }
        return new MachineSuccess<TArgs, TData>(this.args, data, null, Date.now());
    }

    /**
     * Error on refreshing preserves stale data → returns MachineSuccess.
     * Existing data and patchState are preserved.
     */
    errorHappened(error: unknown): MachineSuccess<TArgs, TData> {
        return new MachineSuccess<TArgs, TData>(this.args, this.data, this.patchState, this.updatedAt, error);
    }

    protected cloneWith(updates: Record<string, unknown>): MachineRefreshing<TArgs, TData> {
        return new MachineRefreshing<TArgs, TData>(
            (updates.args as TArgs) ?? this.args,
            (updates.data as TData) ?? this.data,
            "patchState" in updates ? (updates.patchState as TPatchState<TData> | null) : this.patchState,
            (updates.updatedAt as number) ?? this.updatedAt,
        );
    }
}
