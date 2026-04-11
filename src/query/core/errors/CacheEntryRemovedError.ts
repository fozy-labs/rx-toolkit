/**
 * Thrown when a cache entry is removed before an async operation settles.
 */
export class CacheEntryRemovedError extends Error {
    override readonly name = "CacheEntryRemovedError";

    constructor(detail: string) {
        super(`Cache entry removed before ${detail}`);
    }
}
