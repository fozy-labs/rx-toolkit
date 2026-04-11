/**
 * Thrown when a Machine method requires state that doesn't exist
 * (e.g. createPatch on a state without data, finishPatch without patchState).
 */
export class MachineStateError extends Error {
    override readonly name = "MachineStateError";

    constructor(method: string, detail: string) {
        super(`Machine.${method}(): ${detail}`);
    }
}
