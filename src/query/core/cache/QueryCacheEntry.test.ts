import { Observable, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { toKeyed } from "@/query/lib/toKeyed";
import type { IQueryCacheEntryOptions, TKeyed, TQueryEntryState } from "@/query/types";

import { QueryCacheEntry } from "./QueryCacheEntry";

// ==================== Helpers ====================

type TData = { items: { n: number }[] };

function createEntry<TArgs, TData>(
    options: Pick<IQueryCacheEntryOptions<TArgs, TData>, "queryFn" | "onStreamPatch" | "errorSource"> & {
        keyedArgs?: TKeyed<TArgs>;
        retentionTime?: IQueryCacheEntryOptions<TArgs, TData>["retentionTime"];
        resourceKey?: string;
    },
): QueryCacheEntry<TArgs, TData> {
    return new QueryCacheEntry<TArgs, TData>({
        // Absence defaults to `false`; any value given is passed through as it
        // is, so a test can hand the entry something the types forbid.
        retentionTime: options.retentionTime === undefined ? false : options.retentionTime,
        keyedArgs: options.keyedArgs ?? toKeyed(undefined as TArgs),
        queryFn: options.queryFn,
        onStreamPatch: options.onStreamPatch,
        errorSource: options.errorSource,
        resourceKey: options.resourceKey,
    });
}

/** Deferred run handles of a queryFn, one per `_execute()` call. */
type TRun = { resolve: (data: number) => void; reject: (error: unknown) => void };

/**
 * An entry whose every run is settled by the test. `runs.length` is the number
 * of times the query was actually started.
 */
function createControlledEntry(errorSource?: "query" | "command"): {
    entry: QueryCacheEntry<void, number>;
    runs: TRun[];
} {
    const runs: TRun[] = [];
    const entry = createEntry<void, number>({
        errorSource,
        queryFn: () =>
            new Promise<number>((resolve, reject) => {
                runs.push({ resolve, reject });
            }),
    });
    return { entry, runs };
}

/** A cold observable that synchronously emits `value` on subscribe and never terminates. */
function syncEmit<T>(value: T): Observable<T> {
    return new Observable<T>((subscriber) => {
        subscriber.next(value);
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

// ==================== Sync-aborted stream runs (open-flag lifecycle) ====================

/**
 * Regression tests for the stream-open flag when a stream run is aborted
 * synchronously during subscribe: a sync emission rebases over a pending
 * patch, the rebase fails (consistency violation), and the entry re-executes
 * (invalidate) while the aborted run's `subscribe` call is still on the stack —
 * so that run's abort listener was never attached.
 *
 * Shared choreography of each test:
 *   run 1 — stream delivering `{ items: [{ n: 1 }] }` (baseline data);
 *   patch — pending optimistic patch on `items[0]` (flag closed, no signal);
 *   run 2 — invalidate; the stream synchronously emits `{ items: [] }`, the
 *           patch replay fails → consistency violation → nested re-execute
 *           aborts run 2 mid-subscribe;
 *   run 3 — the superseding run (shape varies per test).
 */
describe("QueryCacheEntry — stream run aborted synchronously during subscribe", () => {
    function runViolationScenario(run3: () => Promise<TData> | Observable<TData>, run2Stream: Observable<TData>) {
        const onStreamPatch = vi.fn();
        let call = 0;

        const entry = createEntry<void, TData>({
            queryFn: () => {
                call += 1;
                if (call === 1) return of({ items: [{ n: 1 }] });
                if (call === 2) return run2Stream;
                return run3();
            },
            onStreamPatch,
        });

        // Run 1 emitted and completed synchronously — the entry holds data.
        expect(entry.state$.peek().status).toBe("success");

        // Pending patch over closed stream — must not signal.
        entry.createPatch((draft) => {
            draft.items[0]!.n = 99;
        });
        expect(onStreamPatch).not.toHaveBeenCalled();

        // Run 2: the sync `{ items: [] }` emission invalidates the patch path
        // → consistency violation → a nested invalidate() aborts run 2 in-subscribe.
        entry.invalidate();
        expect(call).toBe(3);

        return { entry, onStreamPatch };
    }

    it("superseding promise run: the flag is released — later patches do not signal", async () => {
        const run3 = deferred<TData>();
        const { entry, onStreamPatch } = runViolationScenario(() => run3.promise, syncEmit<TData>({ items: [] }));

        run3.resolve({ items: [{ n: 5 }] });
        await flushMicrotasks();

        const state = entry.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toEqual({ items: [{ n: 5 }] });

        // No stream is open anymore — patching must not fire the stream signal.
        entry.createPatch((draft) => {
            draft.items[0]!.n = 6;
        });
        expect(onStreamPatch).not.toHaveBeenCalled();
    });

    it("superseding promise run after a sync-completing stream: the flag is released", async () => {
        // Same scenario, but run 2 also completes synchronously right after the
        // violating emission — teardown goes through the complete handler,
        // which runs after the superseding execute already swapped controllers.
        const run3 = deferred<TData>();
        const { entry, onStreamPatch } = runViolationScenario(() => run3.promise, of<TData>({ items: [] }));

        run3.resolve({ items: [{ n: 5 }] });
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");

        entry.createPatch((draft) => {
            draft.items[0]!.n = 6;
        });
        expect(onStreamPatch).not.toHaveBeenCalled();
    });

    it("superseding stream run: the aborted run's cleanup does not clobber the new run's open flag", () => {
        const run3Subject = new Subject<TData>();
        const { entry, onStreamPatch } = runViolationScenario(
            () => run3Subject.asObservable(),
            syncEmit<TData>({ items: [] }),
        );

        // Run 3's stream is genuinely open — patching must signal exactly once.
        entry.createPatch((draft) => {
            draft.items = [{ n: 7 }];
        });
        expect(onStreamPatch).toHaveBeenCalledTimes(1);
    });
});

// ==================== invalidate() / retry() guards ====================

describe("QueryCacheEntry — invalidate()", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("from error: clears the error, goes pending and re-runs the query", async () => {
        const { entry, runs } = createControlledEntry();
        const failure = new Error("boom");

        runs[0]!.reject(failure);
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("error");

        entry.invalidate();

        // The entry is `pending` before `_execute()` decides what to do, so
        // the run actually starts (the `case "error"` guard is not reached).
        expect(runs).toHaveLength(2);
        const state = entry.state$.peek();
        expect(state.status).toBe("pending");
        expect(state.error).toBeNull();

        runs[1]!.resolve(7);
        await flushMicrotasks();
        expect(entry.state$.peek()).toMatchObject({ status: "success", data: 7, error: null });
    });

    it("from success: goes invalidating with a cleared error and re-runs the query", async () => {
        const { entry, runs } = createControlledEntry();

        runs[0]!.resolve(1);
        await flushMicrotasks();

        entry.invalidate();
        expect(runs).toHaveLength(2);
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });
    });

    it("from invalidate-error: goes invalidating with a cleared error and re-runs the query", async () => {
        const { entry, runs } = createControlledEntry();

        runs[0]!.resolve(1);
        await flushMicrotasks();
        entry.invalidate();
        runs[1]!.reject(new Error("invalidate-boom"));
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("invalidate-error");

        entry.invalidate();
        expect(runs).toHaveLength(3);
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });
    });

    it("from pending: warns and does not re-run", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { entry, runs } = createControlledEntry();

        entry.invalidate();

        expect(runs).toHaveLength(1);
        expect(entry.state$.peek().status).toBe("pending");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("from invalidating: warns and does not re-run", async () => {
        const { entry, runs } = createControlledEntry();

        runs[0]!.resolve(1);
        await flushMicrotasks();
        entry.invalidate();
        expect(runs).toHaveLength(2);

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        entry.invalidate();

        expect(runs).toHaveLength(2);
        expect(entry.state$.peek().status).toBe("invalidating");
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe("QueryCacheEntry — retry()", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("from error: keeps the failure in `error`, goes pending and re-runs the query", async () => {
        const { entry, runs } = createControlledEntry();
        const failure = new Error("boom");

        runs[0]!.reject(failure);
        await flushMicrotasks();

        entry.retry();

        expect(runs).toHaveLength(2);
        expect(entry.state$.peek()).toMatchObject({ status: "pending", error: failure });
    });

    it("from invalidate-error: keeps the failure in `error`, goes invalidating and re-runs the query", async () => {
        const { entry, runs } = createControlledEntry();
        const failure = new Error("invalidate-boom");

        runs[0]!.resolve(1);
        await flushMicrotasks();
        entry.invalidate();
        runs[1]!.reject(failure);
        await flushMicrotasks();

        entry.retry();

        expect(runs).toHaveLength(3);
        expect(entry.state$.peek()).toMatchObject({
            status: "invalidating",
            data: 1,
            error: failure,
        });
    });

    it("from pending: warns and does not re-run", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { entry, runs } = createControlledEntry();

        entry.retry();

        expect(runs).toHaveLength(1);
        expect(entry.state$.peek().status).toBe("pending");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("from success: warns and does not re-run", async () => {
        const { entry, runs } = createControlledEntry();
        runs[0]!.resolve(1);
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        entry.retry();

        expect(runs).toHaveLength(1);
        expect(entry.state$.peek().status).toBe("success");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("from invalidating: warns and does not re-run", async () => {
        const { entry, runs } = createControlledEntry();
        runs[0]!.resolve(1);
        await flushMicrotasks();
        entry.invalidate();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        entry.retry();

        expect(runs).toHaveLength(2);
        expect(entry.state$.peek().status).toBe("invalidating");
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

/**
 * A command entry is never invalidated: that is what makes `invalidating` /
 * `invalidate-error` unreachable for a command, so the command clutch can treat
 * them as an exhaustive `never` branch.
 */
describe("QueryCacheEntry — command entries never invalidate", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("invalidate() from success warns and leaves the entry state untouched", async () => {
        const { entry, runs } = createControlledEntry("command");
        runs[0]!.resolve(1);
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        entry.invalidate();

        expect(runs).toHaveLength(1);
        expect(entry.state$.peek().status).toBe("success");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("invalidate() from error warns and leaves the entry state untouched", async () => {
        const { entry, runs } = createControlledEntry("command");
        const failure = new Error("boom");
        runs[0]!.reject(failure);
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        entry.invalidate();

        expect(runs).toHaveLength(1);
        expect(entry.state$.peek()).toMatchObject({ status: "error", error: failure });
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("retry() from error still re-runs the query", async () => {
        const { entry, runs } = createControlledEntry("command");
        const failure = new Error("boom");
        runs[0]!.reject(failure);
        await flushMicrotasks();

        entry.retry();

        expect(runs).toHaveLength(2);
        expect(entry.state$.peek()).toMatchObject({ status: "pending", error: failure });
    });
});

// ==================== retentionTime normalization ====================

/**
 * The normalization table holds for a static option value and for the result of
 * a `retentionTime` function alike. Every row is exercised end to end: a cycle
 * is armed by dropping the entry's last subscriber (the `active → retention`
 * transition), and "removed" is read off {@link QueryCacheEntry.isCompleted} —
 * the share's reset tears the state stream down and completes the entry.
 */
describe("QueryCacheEntry — retentionTime normalization", () => {
    /** Outlives any timer this suite may arm: nothing retained "forever" may fire within it. */
    const A_LONG_TIME = 24 * 60 * 60 * 1000;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** An entry parked in `success`, so every retention cycle observes a settled state. */
    async function createSettledEntry(
        retentionTime: IQueryCacheEntryOptions<number, string>["retentionTime"],
        resourceKey?: string,
    ): Promise<QueryCacheEntry<number, string>> {
        const entry = createEntry<number, string>({
            keyedArgs: toKeyed(1),
            queryFn: async () => "data",
            retentionTime,
            resourceKey,
        });
        await flushMicrotasks();
        return entry;
    }

    /** Arm one retention cycle: subscribe and drop the subscription again. */
    function armRetention(entry: QueryCacheEntry<number, string>): void {
        entry.obs.subscribe().unsubscribe();
    }

    /** Arms one cycle and asserts no timer was armed at all. */
    function expectRetained(entry: QueryCacheEntry<number, string>): void {
        armRetention(entry);
        vi.advanceTimersByTime(A_LONG_TIME);
        expect(entry.isCompleted).toBe(false);
    }

    /** Arms one cycle and asserts the entry is removed by `timer(delay)`, not earlier. */
    function expectRemovedAfter(entry: QueryCacheEntry<number, string>, delay: number): void {
        armRetention(entry);
        if (delay > 0) {
            vi.advanceTimersByTime(delay - 1);
            expect(entry.isCompleted).toBe(false);
        }
        vi.advanceTimersByTime(1);
        expect(entry.isCompleted).toBe(true);
    }

    // ==================== Static option value ====================

    it("static false: no timer is armed", async () => {
        expectRetained(await createSettledEntry(false));
    });

    it("static Infinity: no timer is armed", async () => {
        expectRetained(await createSettledEntry(Infinity));
    });

    it("static value above the setTimeout limit: no timer is armed", async () => {
        expectRetained(await createSettledEntry(2_147_483_648));
    });

    it("static value at the setTimeout limit: timer(v)", async () => {
        expectRemovedAfter(await createSettledEntry(2_147_483_647), 2_147_483_647);
    });

    it("static value within the limit: timer(v)", async () => {
        expectRemovedAfter(await createSettledEntry(5_000), 5_000);
    });

    it("static negative value: timer(0)", async () => {
        expectRemovedAfter(await createSettledEntry(-1), 0);
    });

    it("static NaN: timer(0)", async () => {
        expectRemovedAfter(await createSettledEntry(NaN), 0);
    });

    // ==================== Function result ====================

    it("function returning false: no timer is armed", async () => {
        expectRetained(await createSettledEntry(() => false));
    });

    it("function returning Infinity: no timer is armed", async () => {
        expectRetained(await createSettledEntry(() => Infinity));
    });

    it("function returning a value above the setTimeout limit: no timer is armed", async () => {
        expectRetained(await createSettledEntry(() => 2_147_483_648));
    });

    it("function returning a value within the limit: timer(v)", async () => {
        expectRemovedAfter(await createSettledEntry(() => 5_000), 5_000);
    });

    it("function returning a negative value: timer(0)", async () => {
        expectRemovedAfter(await createSettledEntry(() => -1), 0);
    });

    it("function returning NaN: timer(0)", async () => {
        expectRemovedAfter(await createSettledEntry(() => NaN), 0);
    });

    // ==================== Values the types forbid ====================

    /**
     * The option's type says `number | false`, but the boundary is not always
     * typed: a JS caller, an `any` or a code path that forgets to return can
     * hand over anything. Normalization must be total over that, and must not
     * let `null` masquerade as the internal "no timer" answer.
     */
    function untypedRetentionTime(value: unknown): IQueryCacheEntryOptions<number, string>["retentionTime"] {
        return value as IQueryCacheEntryOptions<number, string>["retentionTime"];
    }

    // `undefined` is not covered here: the option is required, so it reads as
    // "absent" and the callers default it long before this layer. It is covered
    // as a *result* below, where a policy forgetting to return produces it.
    it("static non-numeric value: timer(0)", async () => {
        expectRemovedAfter(await createSettledEntry(untypedRetentionTime(null)), 0);
        expectRemovedAfter(await createSettledEntry(untypedRetentionTime("60000")), 0);
    });

    it("function returning a non-numeric value: timer(0)", async () => {
        expectRemovedAfter(await createSettledEntry(untypedRetentionTime(() => null)), 0);
        expectRemovedAfter(await createSettledEntry(untypedRetentionTime(() => undefined)), 0);
        expectRemovedAfter(await createSettledEntry(untypedRetentionTime(() => "60000")), 0);
    });

    it("throwing function: logs the entry key and falls back to timer(0)", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const entry = await createSettledEntry(() => {
            throw new Error("retention boom");
        }, "users");

        // A throw escaping the teardown would surface here as an
        // UnsubscriptionError on the unsubscribing consumer.
        expectRemovedAfter(entry, 0);

        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(String(consoleError.mock.calls[0]?.[0])).toContain(`users:${toKeyed(1).key}`);
    });

    // ==================== One call per retention cycle ====================

    it("is called once per retention cycle, with the state the entry holds then", async () => {
        const seen: TQueryEntryState<number, string>[] = [];
        const retentionTime = vi.fn((state: TQueryEntryState<number, string>): number | false => {
            seen.push(state);
            return false;
        });

        const run = deferred<string>();
        const entry = createEntry<number, string>({
            keyedArgs: toKeyed(1),
            queryFn: () => run.promise,
            retentionTime,
        });

        // Cycle 1 — the query is still in flight, so the function sees `pending`.
        armRetention(entry);
        expect(retentionTime).toHaveBeenCalledTimes(1);
        expect(seen[0]).toMatchObject({ status: "pending", args: 1 });

        run.resolve("data");
        await flushMicrotasks();

        // Cycle 2 — the next loss of subscribers re-evaluates with the new state.
        armRetention(entry);
        expect(retentionTime).toHaveBeenCalledTimes(2);
        expect(seen[1]).toMatchObject({ status: "success", data: "data", args: 1 });
    });
});
