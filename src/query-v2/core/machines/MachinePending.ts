import type { TPendingState } from "@/query-v2/types";

import { MachineError } from "./MachineError";
import { MachineIdle } from "./MachineIdle";
import { MachineSuccess } from "./MachineSuccess";

/**
 * Pending state — in-flight query with no previous data.
 * Immutable: all transitions return new instances.
 */
export class MachinePending<TArgs, TData> {
    readonly status = "pending" as const;
    readonly args: TArgs;
    readonly data = null;
    readonly error = null;
    readonly updatedAt = null;

    constructor(args: TArgs) {
        this.args = args;
    }

    get state(): TPendingState<TArgs> {
        return {
            status: this.status,
            args: this.args,
            data: this.data,
            error: this.error,
            updatedAt: this.updatedAt,
        };
    }

    successHappened(data: TData): MachineSuccess<TArgs, TData> {
        return new MachineSuccess<TArgs, TData>(this.args, data, null, Date.now());
    }

    errorHappened(error: unknown): MachineError<TArgs, TData> {
        return new MachineError<TArgs, TData>(this.args, error);
    }

    reset(): MachineIdle<TArgs, TData> {
        return new MachineIdle<TArgs, TData>();
    }
}
