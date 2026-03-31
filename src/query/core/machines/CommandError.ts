import type { TCommandErrorState } from "@/query/types/command-machine.types";

import { CommandLoading } from "./CommandLoading";

/** Stub — full implementation in Phase 2 */
export class CommandError<TArgs, TData> {
    readonly status = "error" as const;
    readonly args: TArgs;
    readonly data = null;
    readonly error: unknown;

    constructor(args: TArgs, error: unknown) {
        this.args = args;
        this.error = error;
    }

    get state(): TCommandErrorState<TArgs> {
        return { status: this.status, args: this.args, data: this.data, error: this.error };
    }

    start(args: TArgs): CommandLoading<TArgs, TData> {
        return new CommandLoading(args);
    }
}
