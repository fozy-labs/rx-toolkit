import type { TCommandSuccessState } from "@/query/types/command-machine.types";
import type { TPatchState } from "@/query/types/machine.types";

import { CommandLoading } from "./CommandLoading";

/** Stub — full implementation in Phase 2 */
export class CommandSuccess<TArgs, TData> {
    readonly status = "success" as const;
    readonly args: TArgs;
    readonly data: TData;
    readonly error = null;
    readonly patchState: TPatchState<TData> | null;

    constructor(args: TArgs, data: TData, patchState: TPatchState<TData> | null) {
        this.args = args;
        this.data = data;
        this.patchState = patchState;
    }

    get state(): TCommandSuccessState<TArgs, TData> {
        return {
            status: this.status,
            args: this.args,
            data: this.data,
            error: this.error,
            patchState: this.patchState,
        };
    }

    start(args: TArgs): CommandLoading<TArgs, TData> {
        return new CommandLoading(args);
    }
}
