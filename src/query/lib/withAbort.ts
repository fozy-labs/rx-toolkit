import { abortReason } from "./abortReason";

/**
 * Detach a caller from `promise` when `signal` aborts: the returned promise
 * rejects with the signal's reason, while `promise` itself is left untouched
 * (other callers keep awaiting it). Returns `promise` unchanged when no signal
 * is given.
 */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(abortReason(signal));

    return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(abortReason(signal));
        signal.addEventListener("abort", onAbort, { once: true });

        const cleanup = (): void => signal.removeEventListener("abort", onAbort);
        promise.then(
            (value) => {
                cleanup();
                resolve(value);
            },
            (error: unknown) => {
                cleanup();
                reject(error);
            },
        );
    });
}
