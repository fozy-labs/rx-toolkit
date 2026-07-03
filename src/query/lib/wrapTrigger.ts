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
export function wrapTrigger<TData>(promise: Promise<TData>): TTriggerPromise<TData> {
    const wrapped = promise.then(
        (data): TTriggerResult<TData> => ({ status: "success", data }),
        (error: unknown): TTriggerResult<TData> => ({ status: "error", error }),
    ) as TTriggerPromise<TData>;

    wrapped.unwrap = () => promise;

    return wrapped;
}
