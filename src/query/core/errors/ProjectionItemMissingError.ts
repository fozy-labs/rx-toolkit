/**
 * Thrown when a projection query settles without covering every requested id: the
 * wrapped resource resolved, but `parseData` produced no item for some of the
 * ids the projection entry asked for.
 */
export class ProjectionItemMissingError extends Error {
    override readonly name = "ProjectionItemMissingError";

    /** The requested ids that no parsed item matched. */
    readonly ids: readonly unknown[];

    constructor(ids: readonly unknown[], serializedIds: readonly string[]) {
        super(`Projection response is missing items for ids: ${serializedIds.join(", ")}`);
        this.ids = ids;
    }
}
