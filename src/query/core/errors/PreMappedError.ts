/**
 * Transport envelope for an error that already passed the api's `mapError` at
 * an upstream entry's normalization boundary. A queryFn that re-surfaces
 * another entry's failure (e.g. a projection run propagating its wrapped resource's
 * rejection) wraps it in this envelope; the receiving entry's normalization
 * boundary then unwraps it instead of mapping it a second time.
 *
 * Not an `Error` on purpose: it is never meant to reach a consumer — it only
 * travels between a queryFn and the entry that runs it.
 *
 * @internal Not part of the public API.
 */
export class PreMappedError {
    constructor(readonly error: unknown) {}
}
