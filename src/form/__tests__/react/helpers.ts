// Helpers of the React tests: resources and commands the test settles by hand.
import { act } from "@testing-library/react";

import type { IResource } from "@/query/types";

/** A promise with its `resolve` / `reject` outside. */
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

/** Runs of a `queryFn` that wait for the test, recorded in order. */
export function manualRuns<A, D>() {
    const runs: { args: A; resolve: (data: D) => void; reject: (error: unknown) => void }[] = [];
    const queryFn = vi.fn((args: A) => {
        const { promise, resolve, reject } = deferred<D>();
        runs.push({ args, resolve, reject });
        return promise;
    });
    return {
        runs,
        queryFn,
        last() {
            const run = runs[runs.length - 1];
            if (!run) throw new Error("the queryFn has not run");
            return run;
        },
    };
}

/** Lets the microtasks, the deferred `useSignal` updates and the renders they cause run. */
export async function settle(): Promise<void> {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    });
}

/** Whether a cache entry of `args` exists and nobody holds it. */
export function isMelting(resource: IResource<string, unknown>, args: string): boolean | undefined {
    return resource.getEntry(args)?.isMelting;
}
