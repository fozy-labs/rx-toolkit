import type { DevtoolsLike, MachineDevtoolsLike } from "@/common/devtools";

import { SharedOptions } from "./SharedOptions";

type Update = Partial<{
    DEVTOOLS: DevtoolsLike | null;
    MACHINE_DEVTOOLS: MachineDevtoolsLike | null;
    onQueryError: (error: unknown) => void;
    getScopeName: () => string | null;
}>;

export class DefaultOptions {
    static update(part: Update) {
        if (part.DEVTOOLS !== undefined) SharedOptions.DEVTOOLS = part.DEVTOOLS;
        if (part.MACHINE_DEVTOOLS !== undefined) SharedOptions.MACHINE_DEVTOOLS = part.MACHINE_DEVTOOLS;
        if (part.onQueryError !== undefined) SharedOptions.onQueryError = part.onQueryError;
        if (part.getScopeName !== undefined) SharedOptions.getScopeName = part.getScopeName;
    }
}
