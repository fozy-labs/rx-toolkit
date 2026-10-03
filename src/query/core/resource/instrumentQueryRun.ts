import { finalize, isObservable, tap } from "rxjs";

import type { TQueryFnResult, TQueryStreamContext } from "@/query/types";

import { abortReason } from "../../lib/abortReason";
import { EmptyStreamError } from "../errors";

/** Lifecycle promises derived from a single query run (see {@link instrumentQueryRun}). */
export interface TQueryRunLifecycle<TData> {
    $queryFulfilled: Promise<{ data: TData }>;
    $queryStream: TQueryStreamContext<TData>;
}

export interface TInstrumentedQueryRun<TData> {
    /**
     * What to hand to the cache entry: the raw promise, or the stream
     * instrumented in place. The entry settling a promise run must report it
     * through {@link settleQueryRun}.
     */
    result: TQueryFnResult<TData>;
    lifecycle: TQueryRunLifecycle<TData>;
}

interface TDeferred<TData> {
    promise: Promise<TData>;
    resolve: (data: TData) => void;
    reject: (error: unknown) => void;
    isSettled: boolean;
}

function deferred<TData>(): TDeferred<TData> {
    const d = { isSettled: false } as TDeferred<TData>;
    d.promise = new Promise<TData>((resolve, reject) => {
        d.resolve = (data) => {
            d.isSettled = true;
            resolve(data);
        };
        d.reject = (error) => {
            d.isSettled = true;
            reject(error);
        };
    });
    // The hook may never consume the promise — suppress unhandled rejections;
    // awaiting hooks still see the rejection.
    void d.promise.catch(() => {});
    return d;
}

/** Settlers of the instrumented promise runs in flight, by the run's signal. */
const promiseRuns = new WeakMap<AbortSignal, (outcome: PromiseSettledResult<unknown>) => void>();

/**
 * Settle the lifecycle of an instrumented promise run with the outcome its
 * cache entry recorded. Wired as the entry's `onPromiseRunSettled`; a run
 * that was not instrumented is ignored.
 */
export function settleQueryRun(signal: AbortSignal, outcome: PromiseSettledResult<unknown>): void {
    const settle = promiseRuns.get(signal);
    promiseRuns.delete(signal);
    settle?.(outcome);
}

/**
 * Derive the `onQueryStarted` context promises from a single query run without
 * consuming it.
 *
 * A promise run settles all three promises together (`firstReceived` ≡
 * `allReceived` ≡ the run's outcome), and from the cache entry rather than
 * from the raw promise: once the entry has recorded the outcome (see
 * {@link settleQueryRun}), so a hook resuming on it finds the entry already
 * showing it; with the abort reason if the run is aborted first (a cancelling
 * invalidation, eviction), whatever the raw promise does later.
 *
 * A stream run is observed through a `tap` inserted into the observable
 * itself — the cache entry stays its only subscriber, so the producer runs
 * exactly once: `firstReceived` settles with the first emission, `allReceived`
 * with the last one at completion, both reject with the raw producer error (or
 * {@link EmptyStreamError} on an empty completion). If the run is torn down
 * before a milestone (invalidate / retry / eviction unsubscribes), the pending
 * promises reject with the abort reason.
 *
 * Like `$queryFulfilled`, all promises deliberately sit upstream of `mapError`
 * and carry raw errors.
 */
export function instrumentQueryRun<TData>(
    raw: TQueryFnResult<TData>,
    signal: AbortSignal,
): TInstrumentedQueryRun<TData> {
    if (!isObservable(raw)) {
        const outcome = deferred<TData>();
        promiseRuns.set(signal, (settled) => {
            if (settled.status === "fulfilled") outcome.resolve(settled.value as TData);
            else outcome.reject(settled.reason);
        });
        signal.addEventListener(
            "abort",
            () => {
                promiseRuns.delete(signal);
                if (!outcome.isSettled) outcome.reject(abortReason(signal));
            },
            { once: true },
        );

        const $queryFulfilled = outcome.promise.then((data) => ({ data }));
        void $queryFulfilled.catch(() => {});

        return {
            result: raw,
            lifecycle: {
                $queryFulfilled,
                $queryStream: { firstReceived: outcome.promise, allReceived: outcome.promise },
            },
        };
    }

    const first = deferred<TData>();
    const all = deferred<TData>();

    let lastValue: TData;
    let hasValue = false;

    const result = raw.pipe(
        tap({
            next: (value) => {
                hasValue = true;
                lastValue = value;
                if (!first.isSettled) first.resolve(value);
            },
            error: (error: unknown) => {
                if (!first.isSettled) first.reject(error);
                if (!all.isSettled) all.reject(error);
            },
            complete: () => {
                if (hasValue) {
                    if (!all.isSettled) all.resolve(lastValue);
                } else {
                    const error = new EmptyStreamError();
                    if (!first.isSettled) first.reject(error);
                    if (!all.isSettled) all.reject(error);
                }
            },
        }),
        // Teardown without a terminal event — the run was superseded or the
        // entry evicted; release pending waiters with the abort reason.
        finalize(() => {
            if (first.isSettled && all.isSettled) return;
            const reason = signal.aborted
                ? abortReason(signal)
                : new DOMException("The query run was torn down.", "AbortError");
            if (!first.isSettled) first.reject(reason);
            if (!all.isSettled) all.reject(reason);
        }),
    );

    const $queryFulfilled = first.promise.then((data) => ({ data }));
    void $queryFulfilled.catch(() => {});

    return {
        result,
        lifecycle: {
            $queryFulfilled,
            $queryStream: { firstReceived: first.promise, allReceived: all.promise },
        },
    };
}
