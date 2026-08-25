/**
 * Thrown by `createMachine()` for an invalid or unsupported config, and by
 * `new Statechart()` for names missing from the implementation table.
 *
 * `path` is the config path of the object owning the problem
 * (`"states.foo.on.BAR[0]"`, `"implementations.actions"`); the root is `""`.
 * The message is `"<path>: <detail>"`, or just `"<detail>"` for the root.
 */
export class MachineConfigError extends Error {
    override readonly name = "MachineConfigError";
    readonly path: string;
    readonly detail: string;

    constructor(path: string, detail: string) {
        super(formatMachineConfigError(path, detail));
        this.path = path;
        this.detail = detail;
    }
}

export function formatMachineConfigError(path: string, detail: string): string {
    return path ? `${path}: ${detail}` : detail;
}
