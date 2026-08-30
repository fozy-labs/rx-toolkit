/**
 * Thrown when a batch query settles without covering every requested id: the
 * wrapped resource resolved, but `parseData` produced no item for some of the
 * ids the batch entry asked for.
 */
export class BatchItemMissingError extends Error {
    override readonly name = "BatchItemMissingError";

    /** The requested ids that no parsed item matched. */
    readonly ids: readonly unknown[];

    constructor(ids: readonly unknown[], serializedIds: readonly string[]) {
        super(`Batch response is missing items for ids: ${serializedIds.join(", ")}`);
        this.ids = ids;
    }
}
