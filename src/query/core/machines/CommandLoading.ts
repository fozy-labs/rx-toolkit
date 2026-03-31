import type { TCommandLoadingState } from "@/query/types/command-machine.types";

import { CommandError } from "./CommandError";
import { CommandSuccess } from "./CommandSuccess";

/** Stub — full implementation in Phase 2 */
export class CommandLoading<TArgs, TData> {
    readonly status = "loading" as const;
    readonly args: TArgs;
    readonly data = null;
    readonly error = null;

    constructor(args: TArgs) {
        this.args = args;
    }

    get state(): TCommandLoadingState<TArgs> {
        return { status: this.status, args: this.args, data: this.data, error: this.error };
    }

    successHappened(data: TData): CommandSuccess<TArgs, TData> {
        return new CommandSuccess(this.args, data, null);
    }

    errorHappened(error: unknown): CommandError<TArgs, TData> {
        return new CommandError(this.args, error);
    }
}
