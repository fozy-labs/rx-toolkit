import type { NO_VALUE } from "@/query-v2/lib/NO_VALUE";
import { NO_VALUE as NO_VALUE_VALUE } from "@/query-v2/lib/NO_VALUE";
import type { TResourceV2PendingState } from "@/query-v2/types/machine.types";

import { MachineError } from "./MachineError";
import { MachineIdle } from "./MachineIdle";
import { MachineSuccess } from "./MachineSuccess";

export class MachinePending<TData = unknown> {
    readonly state: TResourceV2PendingState<TData>;

    private constructor(args: unknown) {
        this.state = {
            status: "pending",
            args,
            data: null,
            error: null,
            updatedAt: null,
            originalData: NO_VALUE_VALUE as NO_VALUE,
        };
    }

    successHappened(data: TData): MachineSuccess<TData> {
        return MachineSuccess.create(data, this.state.args);
    }

    errorHappened<TError = Error>(error: TError): MachineError<TError> {
        return MachineError.create(error, this.state.args);
    }

    reset(): MachineIdle {
        return MachineIdle.create();
    }

    static create<TData = unknown>(args: unknown): MachinePending<TData> {
        return new MachinePending<TData>(args);
    }
}
