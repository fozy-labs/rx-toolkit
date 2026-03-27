import { vi } from "vitest";

import type { TQueryFn } from "@/query-v2/types";

/**
 * Creates a promise whose resolution/rejection is controlled externally.
 * Used in tests to simulate async queryFn behavior without real network calls.
 */
export function createControllablePromise<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
} {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/**
 * Creates a controllable queryFn that captures each call's resolve/reject.
 * Each invocation of the returned queryFn creates a new controllable promise.
 */
export function createControllableQueryFn<TArgs = { id: number }, TData = { name: string }>(): {
    queryFn: TQueryFn<TArgs, TData>;
    calls: Array<{
        args: TArgs;
        abortSignal: AbortSignal;
        resolve: (value: TData) => void;
        reject: (reason?: unknown) => void;
    }>;
} {
    const calls: Array<{
        args: TArgs;
        abortSignal: AbortSignal;
        resolve: (value: TData) => void;
        reject: (reason?: unknown) => void;
    }> = [];

    const queryFn = vi.fn(
        (args: TArgs, tools: { abortSignal: AbortSignal }) =>
            new Promise<TData>((resolve, reject) => {
                calls.push({ args, abortSignal: tools.abortSignal, resolve, reject });
            }),
    );

    return { queryFn, calls };
}
