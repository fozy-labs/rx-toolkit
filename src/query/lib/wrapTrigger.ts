import type { TTriggerPromise, TTriggerResult } from "@/query/types";

/**
 * Wrap a raw mutation promise into a {@link TTriggerPromise}: the returned
 * promise never rejects — it resolves with a {@link TTriggerResult} envelope
 * (`{ status: "success", data }` / `{ status: "error", error }`), while
 * `unwrap()` hands back the original throwing promise.
 *
 * Backs agent/hook-level `trigger`; also usable directly to wrap the raw
 * `Command.trigger` promise.
 */
export function wrapTrigger<TData, TError = unknown>(promise: Promise<TData>): TTriggerPromise<TData, TError> {
    const wrapped = promise.then(
        (data): TTriggerResult<TData, TError> => ({ status: "success", data }),
        // Sound per the mapError contract: every rejection of Command.trigger's
        // promise is normalized to TError before reaching here — queryFn failures
        // at the machine boundary, entry-removal and pre-entry sync throws at
        // their escape points inside Command / QueryCacheEntry.
        (error: unknown): TTriggerResult<TData, TError> => ({ status: "error", error: error as TError }),
    ) as TTriggerPromise<TData, TError>;

    wrapped.unwrap = () => promise;

    return wrapped;
}
