import type { TResourceV2Patch } from '@/query-v2/types/machine.types';
import type { TResourceV2SnapshotSlice } from '@/query-v2/types/snapshot.types';
import type { TResourceV2SuccessState } from '@/query-v2/types/machine.types';
import type { NO_VALUE } from '@/query-v2/lib/NO_VALUE';
import { NO_VALUE as NO_VALUE_VALUE } from '@/query-v2/lib/NO_VALUE';
import { MachineWithData, type MachineWithDataState } from './MachineWithData';
import { MachineIdle } from './MachineIdle';
import { MachinePending } from './MachinePending';
import { MachineRefreshing } from './MachineRefreshing';

export class MachineSuccess<TData = unknown> extends MachineWithData<TData> {
    readonly state: TResourceV2SuccessState<TData>;

    private constructor(
        data: TData,
        args: unknown,
        updatedAt: number,
        originalData: TData | NO_VALUE = NO_VALUE_VALUE as NO_VALUE,
        patches: TResourceV2Patch[] | null = null,
    ) {
        super();
        this.state = {
            status: 'success',
            args,
            data,
            error: null,
            updatedAt,
            originalData,
            patches,
        };
    }

    protected cloneWith(updates: Partial<MachineWithDataState<TData>>): this {
        return new MachineSuccess<TData>(
            updates.data ?? this.state.data,
            this.state.args,
            this.state.updatedAt,
            updates.originalData !== undefined ? updates.originalData : this.state.originalData,
            updates.patches !== undefined ? updates.patches : this.state.patches,
        ) as this;
    }

    invalidate(): MachineRefreshing<TData> {
        return MachineRefreshing.create(
            this.state.data,
            this.state.args,
            this.state.updatedAt,
            this.state.originalData,
            this.state.patches,
        );
    }

    start(args: unknown): MachinePending<TData> {
        // Abort pending patches before transitioning (per ADR-4)
        this.abortAllPendingPatches();
        return MachinePending.create<TData>(args);
    }

    reset(): MachineIdle {
        // Abort pending patches before transitioning (per ADR-4)
        this.abortAllPendingPatches();
        return MachineIdle.create();
    }

    static create<TData>(data: TData, args: unknown): MachineSuccess<TData> {
        return new MachineSuccess<TData>(data, args, Date.now());
    }

    static deploy<TData = unknown>(snapshotSlice: TResourceV2SnapshotSlice<TData>): MachineSuccess<TData> {
        return new MachineSuccess<TData>(
            snapshotSlice.data,
            snapshotSlice.args,
            snapshotSlice.updatedAt,
        );
    }
}
