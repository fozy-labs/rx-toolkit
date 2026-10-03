// Helpers of the submit tests: a real command on a fresh api whose runs the test settles by hand.
import { createApi, type TMapError } from "@/query";

/** One run of the command's `queryFn`. */
export interface Run<A, D> {
    readonly args: A;
    readonly requestId: string;
    resolve(data: D): void;
    reject(error: unknown): void;
}

/**
 * A command whose every run waits for the test: `runs` records them in order. `retentionTime`
 * defaults to the library's 0.
 */
export function manualCommand<A, D = { id: string }, E = unknown>(
    options: { mapError?: TMapError<E>; retentionTime?: number } = {},
) {
    const runs: Run<A, D>[] = [];
    const queryFn = vi.fn(
        (args: A, requestId: string) =>
            new Promise<D>((resolve, reject) => runs.push({ args, requestId, resolve, reject })),
    );
    const api = createApi({ mapError: options.mapError });
    const command = api.createCommand<A, D>({ queryFn, retentionTime: options.retentionTime });
    return {
        api,
        command,
        runs,
        queryFn,
        /** The last run. */
        last(): Run<A, D> {
            const run = runs[runs.length - 1];
            if (!run) throw new Error("the command has not run");
            return run;
        },
    };
}

/** Lets the microtasks and the timers due within `ms` run (fake timers). */
export function advance(ms = 0): Promise<void> {
    return vi.advanceTimersByTimeAsync(ms).then(() => {});
}

/** Lets the pending microtasks run. */
export async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}
