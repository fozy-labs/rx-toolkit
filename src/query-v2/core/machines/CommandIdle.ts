import type { TCommandIdleState } from "@/query-v2/types/command-machine.types";

import { CommandLoading } from "./CommandLoading";

/** Stub — full implementation in Phase 2 */
export class CommandIdle<TArgs, TData> {
    readonly status = "idle" as const;
    readonly args = null;
    readonly data = null;
    readonly error = null;

    get state(): TCommandIdleState {
        return { status: this.status, args: this.args, data: this.data, error: this.error };
    }

    start(args: TArgs): CommandLoading<TArgs, TData> {
        return new CommandLoading(args);
    }
}
