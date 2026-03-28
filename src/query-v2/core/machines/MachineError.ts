import type { TErrorState } from "@/query-v2/types";

import { MachinePending } from "./MachinePending";

/**
 * Error state — fetch failed, no data.
 * Immutable: all transitions return new instances.
 */
export class MachineError<TArgs, TData> {
    readonly status = "error" as const;
    readonly args: TArgs;
    readonly data = null;
    readonly error: unknown;
    readonly updatedAt = null;

    constructor(args: TArgs, error: unknown) {
        this.args = args;
        this.error = error;
    }

    get state(): TErrorState<TArgs> {
        return {
            status: this.status,
            args: this.args,
            data: null,
            error: this.error,
            updatedAt: null,
        };
    }

    retry(): MachinePending<TArgs, TData> {
        return new MachinePending<TArgs, TData>(this.args);
    }

    start(args: TArgs): MachinePending<TArgs, TData> {
        return new MachinePending<TArgs, TData>(args);
    }
}
