/**
 * Thrown when a Machine state transition is invalid for the current status.
 */
export class MachineTransitionError extends Error {
    override readonly name = "MachineTransitionError";

    constructor(method: string, status: string) {
        super(`Machine.${method}(): invalid transition from "${status}"`);
    }
}
