/**
 * Thrown when a query-entry transition requires state that does not exist
 * (e.g. createPatch on a state without data, finishPatch without patchState).
 */
export class QueryEntryStateError extends Error {
    override readonly name = "QueryEntryStateError";

    constructor(method: string, detail: string) {
        super(`QueryCacheEntry.${method}(): ${detail}`);
    }
}
