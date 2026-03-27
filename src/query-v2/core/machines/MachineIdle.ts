import type { TIdleState } from "@/query-v2/types";

import { MachinePending } from "./MachinePending";

/**
 * Idle state — initial, no data.
 * Immutable: all transitions return new instances.
 */
export class MachineIdle<TArgs, TData> {
    readonly status = "idle" as const;
    readonly args = null;
    readonly data = null;
    readonly error = null;
    readonly updatedAt = null;

    get state(): TIdleState {
        return {
            status: this.status,
            args: this.args,
            data: this.data,
            error: this.error,
            updatedAt: this.updatedAt,
        };
    }

    start(args: TArgs): MachinePending<TArgs, TData> {
        return new MachinePending<TArgs, TData>(args);
    }

    reset(): MachineIdle<TArgs, TData> {
        return new MachineIdle<TArgs, TData>();
    }
}
