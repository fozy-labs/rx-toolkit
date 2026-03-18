import type { NO_VALUE } from "@/query-v2/lib/NO_VALUE";
import { NO_VALUE as NO_VALUE_VALUE } from "@/query-v2/lib/NO_VALUE";
import type { TResourceV2Patch, TResourceV2RefreshingState } from "@/query-v2/types/machine.types";

import { MachineIdle } from "./MachineIdle";
import { MachineSuccess } from "./MachineSuccess";
import { MachineWithData, type MachineWithDataState } from "./MachineWithData";

export class MachineRefreshing<TData = unknown> extends MachineWithData<TData> {
    readonly state: TResourceV2RefreshingState<TData>;

    private constructor(
        data: TData,
        args: unknown,
        updatedAt: number,
        originalData: TData | NO_VALUE = NO_VALUE_VALUE as NO_VALUE,
        patches: TResourceV2Patch[] | null = null,
    ) {
        super();
        this.state = {
            status: "refreshing",
            args,
            data,
            error: null,
            updatedAt,
            originalData,
            patches,
        };
    }

    protected cloneWith(updates: Partial<MachineWithDataState<TData>>): this {
        return new MachineRefreshing<TData>(
            updates.data ?? this.state.data,
            this.state.args,
            this.state.updatedAt,
            updates.originalData !== undefined ? updates.originalData : this.state.originalData,
            updates.patches !== undefined ? updates.patches : this.state.patches,
        ) as this;
    }

    successHappened(data: TData): MachineSuccess<TData> {
        // Fresh data supersedes optimistic patches — abort all pending (per ADR-4, E11)
        const cleaned = this.abortAllPendingPatches();
        // Ignore cleaned data — fresh data from server replaces everything
        void cleaned;
        return MachineSuccess.create(data, this.state.args);
    }

    errorHappened(_error: unknown): MachineSuccess<TData> {
        // ADR-2: Preserve stale data on refresh error
        // Return MachineSuccess with original stale data, same updatedAt, preserve patches
        return MachineSuccess.deploy<TData>({
            status: "success",
            args: this.state.args,
            data: this.state.data,
            updatedAt: this.state.updatedAt,
        });
    }

    reset(): MachineIdle {
        this.abortAllPendingPatches();
        return MachineIdle.create();
    }

    static create<TData>(
        data: TData,
        args: unknown,
        updatedAt: number,
        originalData: TData | NO_VALUE = NO_VALUE_VALUE as NO_VALUE,
        patches: TResourceV2Patch[] | null = null,
    ): MachineRefreshing<TData> {
        return new MachineRefreshing<TData>(data, args, updatedAt, originalData, patches);
    }
}
