/**
 * Thrown when a stream-returning queryFn completes without emitting a single
 * value: the run has neither data nor a producer error to settle with, so it
 * fails explicitly instead of leaving the entry pending forever.
 */
export class EmptyStreamError extends Error {
    override readonly name = "EmptyStreamError";

    constructor() {
        super("Query stream completed without emitting a value");
    }
}
