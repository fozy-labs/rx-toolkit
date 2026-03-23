import type { NO_VALUE } from "@/query-v2/lib/NO_VALUE";
import { NO_VALUE as NO_VALUE_VALUE } from "@/query-v2/lib/NO_VALUE";
import type { TPatchFn, TResourceV2Patch } from "@/query-v2/types/machine.types";

import { Patcher } from "./Patcher";

export interface MachineWithDataState<TData> {
    data: TData;
    originalData: TData | NO_VALUE;
    patches: TResourceV2Patch[] | null;
}

export abstract class MachineWithData<TData = unknown> {
    abstract readonly state: MachineWithDataState<TData>;

    protected abstract cloneWith(updates: Partial<MachineWithDataState<TData>>): this;

    addPatch(patch: TResourceV2Patch): this {
        const { state } = this;
        const originalData = (state.originalData === NO_VALUE_VALUE ? state.data : state.originalData) as TData;
        const currentPatches = state.patches ? [...state.patches, patch] : [patch];
        const resolved = Patcher.resolvePatches(originalData, currentPatches);

        return this.cloneWith({
            data: resolved.data,
            originalData,
            patches: resolved.patches.length > 0 ? resolved.patches : null,
        });
    }

    finishPatch(type: "commit" | "abort", patch: TResourceV2Patch): this {
        const { state } = this;
        const result = Patcher.finishPatch(state.originalData, state.patches, type, patch);

        return this.cloneWith({
            data: result.data ?? state.data,
            originalData: result.originalData,
            patches: result.patches,
        });
    }

    createPatch<TSelf extends MachineWithData<TData>>(
        this: TSelf,
        patchFn: TPatchFn<TData>,
    ): { machine: TSelf; patch: TResourceV2Patch } {
        const { state } = this;
        const dataForPatch = state.data;
        const patch = Patcher.createPatch(patchFn, dataForPatch);
        const machine = this.addPatch(patch);
        return { machine, patch };
    }

    abortAllPendingPatches(): this {
        const { state } = this;
        const result = Patcher.abortAllPending(state.originalData, state.patches);

        return this.cloneWith({
            data: result.data ?? state.data,
            originalData: result.originalData,
            patches: result.patches,
        });
    }
}
