/**
 * Thrown when a computed signal reads itself, directly or through a chain of
 * other computeds. `chain` lists the computeds from the first one of the cycle
 * back to it again, by their devtools `key` (`<anonymous>` when there is none).
 * A loop of reactions that never settles (effects or bridges writing each
 * other's sources) is reported with an empty `chain` and its own message.
 */
export class SignalCycleError extends Error {
    readonly chain: readonly string[];

    constructor(chain: readonly string[], message?: string) {
        super(message ?? `Cycle detected in computed signals: ${chain.join(" → ")}`);
        this.name = "SignalCycleError";
        this.chain = chain;
    }
}
