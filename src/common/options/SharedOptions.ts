import { DevtoolsLike, MachineDevtoolsLike } from "@/common/devtools";

export class SharedOptions {
    static DEVTOOLS: DevtoolsLike | null = null;
    /** Default Stately Inspector adapter for every `Statechart` (overridable per instance). */
    static MACHINE_DEVTOOLS: MachineDevtoolsLike | null = null;
    static onQueryError: ((error: unknown) => void) | null = null;
    static getScopeName: (() => string | null) | null = null;

    static reset(): void {
        SharedOptions.DEVTOOLS = null;
        SharedOptions.MACHINE_DEVTOOLS = null;
        SharedOptions.onQueryError = null;
        SharedOptions.getScopeName = null;
    }
}
