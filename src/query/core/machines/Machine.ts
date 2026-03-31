import type { TMachineInstance, TMachineState } from "@/query/types";

import { MachineError } from "./MachineError";
import { MachinePending } from "./MachinePending";
import { MachineRefreshing } from "./MachineRefreshing";
import { MachineSuccess } from "./MachineSuccess";

/**
 * Static factory for creating machine instances.
 */
export const Machine = {
    /** Creates an initial pending machine */
    pending<TArgs, TData>(args: TArgs): MachinePending<TArgs, TData> {
        return new MachinePending<TArgs, TData>(args);
    },

    /** Hydrates a machine from serialized state (for SSR snapshot support) */
    fromSnapshot<TArgs, TData>(state: TMachineState<TArgs, TData>): TMachineInstance<TArgs, TData> {
        switch (state.status) {
            case "pending":
                return new MachinePending<TArgs, TData>(state.args);
            case "success":
                return new MachineSuccess<TArgs, TData>(state.args, state.data, state.patchState, state.updatedAt);
            case "error":
                return new MachineError<TArgs, TData>(state.args, state.error);
            case "refreshing":
                return new MachineRefreshing<TArgs, TData>(state.args, state.data, state.patchState, state.updatedAt);
        }
    },
};
