/**
 * The reason to reject an aborted operation with. Modern runtimes populate
 * `signal.reason` with an `AbortError` when `abort()` is called without an
 * explicit reason; the fallback covers environments that don't.
 */
export function abortReason(signal: AbortSignal): unknown {
    return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
