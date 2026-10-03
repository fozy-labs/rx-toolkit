/**
 * Thrown when a query-entry state transition is invalid for the current status.
 */
export class QueryEntryTransitionError extends Error {
    override readonly name = "QueryEntryTransitionError";

    constructor(method: string, status: string) {
        super(`QueryCacheEntry.${method}(): invalid transition from "${status}"`);
    }
}
