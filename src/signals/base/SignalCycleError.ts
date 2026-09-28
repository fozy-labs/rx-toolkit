/**
 * Thrown when a computed signal reads itself, directly or through a chain of
 * other computeds. `chain` lists the computeds from the first one of the cycle
 * back to it again, by their devtools `key` (`<anonymous>` when there is none).
 */
export class SignalCycleError extends Error {
    readonly chain: readonly string[];

    constructor(chain: readonly string[]) {
        super(`Cycle detected in computed signals: ${chain.join(" → ")}`);
        this.name = "SignalCycleError";
        this.chain = chain;
    }
}
