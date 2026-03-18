import { NO_VALUE as NO_VALUE_VALUE } from "@/query-v2/lib/NO_VALUE";
import type { TMachineStatus } from "@/query-v2/types/machine.types";

import { MachineError } from "./MachineError";
import { MachineIdle } from "./MachineIdle";
import { MachinePending } from "./MachinePending";
import { MachineRefreshing } from "./MachineRefreshing";
import { MachineSuccess } from "./MachineSuccess";

export type TMachineInstance<TData = unknown, TError = Error> =
    | MachineIdle
    | MachinePending<TData>
    | MachineSuccess<TData>
    | MachineError<TError>
    | MachineRefreshing<TData>;

export const Machine = {
    idle(): MachineIdle {
        return MachineIdle.create();
    },

    fromSnapshot<TData>(state: { status: TMachineStatus } & Record<string, unknown>): TMachineInstance<TData> {
        switch (state.status) {
            case "idle":
                return MachineIdle.create();
            case "pending":
                return MachinePending.create<TData>(state.args ?? null);
            case "success":
                return MachineSuccess.deploy<TData>({
                    status: "success",
                    args: state.args ?? null,
                    data: state.data as TData,
                    updatedAt: (state.updatedAt as number) ?? Date.now(),
                });
            case "error":
                return MachineError.create((state.error ?? new Error("Unknown error")) as Error, state.args ?? null);
            case "refreshing":
                return MachineRefreshing.create<TData>(
                    state.data as TData,
                    state.args ?? null,
                    (state.updatedAt as number) ?? Date.now(),
                    NO_VALUE_VALUE,
                    null,
                );
            default:
                throw new Error(`Unknown machine status: ${state.status as string}`);
        }
    },
} as const;

export { MachineIdle, MachinePending, MachineSuccess, MachineError, MachineRefreshing };
