import { Observable, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { toKeyed } from "@/query/lib/toKeyed";
import type { IQueryCacheEntryOptions, TInFlightPolicy, TKeyed, TQueryEntryState } from "@/query/types";
import { Signal } from "@/signals";

import { QueryCacheEntry, type TQueryCacheEntryInternals } from "./QueryCacheEntry";

// ==================== Helpers ====================

type TData = { items: { n: number }[] };

function createEntry<TArgs, TData>(
    options: Pick<
        IQueryCacheEntryOptions<TArgs, TData>,
        "queryFn" | "onStreamPatch" | "errorSource" | "initialState" | "isInvalidated" | "invalidateInFlight"
    > &
        TQueryCacheEntryInternals & {
            keyedArgs?: TKeyed<TArgs>;
            retentionTime?: IQueryCacheEntryOptions<TArgs, TData>["retentionTime"];
            resourceKey?: string;
        },
): QueryCacheEntry<TArgs, TData> {
    return new QueryCacheEntry<TArgs, TData>(
        {
            // Absence defaults to `false`; any value given is passed through as it
            // is, so a test can hand the entry something the types forbid.
            retentionTime: options.retentionTime === undefined ? false : options.retentionTime,
            keyedArgs: options.keyedArgs ?? toKeyed(undefined as TArgs),
            queryFn: options.queryFn,
            onStreamPatch: options.onStreamPatch,
            errorSource: options.errorSource,
            resourceKey: options.resourceKey,
            initialState: options.initialState,
            isInvalidated: options.isInvalidated,
            invalidateInFlight: options.invalidateInFlight,
        },
        { revalidateInRun: options.revalidateInRun },
    );
}

/** Deferred run handles of a queryFn, one per `_execute()` call. */
type TRun = { resolve: (data: number) => void; reject: (error: unknown) => void; signal: AbortSignal };

/**
 * An entry whose every run is settled by the test. `runs.length` is the number
 * of times the query was actually started.
 *
 * Held from birth unless `isHeld: false` — as an entry with a mounted consumer
 * is — so `invalidate()` re-runs at once. The lazy path (a melting entry) is
 * exercised by the suites that opt out.
 */
function createControlledEntry(
    options: { errorSource?: "query" | "command"; isHeld?: boolean; invalidateInFlight?: TInFlightPolicy } = {},
): {
    entry: QueryCacheEntry<void, number>;
    runs: TRun[];
    release: () => void;
} {
    const runs: TRun[] = [];
    const entry = createEntry<void, number>({
        errorSource: options.errorSource,
        invalidateInFlight: options.invalidateInFlight,
        queryFn: (_args, signal) =>
            new Promise<number>((resolve, reject) => {
                runs.push({ resolve, reject, signal });
            }),
    });
    const release = options.isHeld === false ? () => {} : entry.hold();
    return { entry, runs, release };
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

        // A held entry: the nested invalidate below must re-run at once.
        entry.hold();

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

/** `invalidate()` on an active (held) entry: the re-run starts at once. */
describe("QueryCacheEntry — invalidate() on an active entry", () => {
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

    // `pending` / `invalidating` — a run in flight — are covered by the
    // "invalidate() with a … run in flight" suites below.

    it.each(["cancel", "trail", "join"] as const)(
        "invalidateInFlight: %s does not change a settled entry: from success it goes invalidating and re-runs",
        async (invalidateInFlight) => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight });

            runs[0]!.resolve(1);
            await flushMicrotasks();

            entry.invalidate();
            expect(runs).toHaveLength(2);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.state$.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });
        },
    );
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
        const { entry, runs } = createControlledEntry({ errorSource: "command" });
        runs[0]!.resolve(1);
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        entry.invalidate();

        expect(runs).toHaveLength(1);
        expect(entry.state$.peek().status).toBe("success");
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("invalidate() from error warns and leaves the entry state untouched", async () => {
        const { entry, runs } = createControlledEntry({ errorSource: "command" });
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
        const { entry, runs } = createControlledEntry({ errorSource: "command" });
        const failure = new Error("boom");
        runs[0]!.reject(failure);
        await flushMicrotasks();

        entry.retry();

        expect(runs).toHaveLength(2);
        expect(entry.state$.peek()).toMatchObject({ status: "pending", error: failure });
    });
});

// ==================== Holding ====================

/**
 * What holds an entry — keeps it `active` — and what does not. A hold is a
 * subscription to `obs`, a `hold()`, or a signal read inside a *subscribed*
 * Computed / Effect; plain reads never are.
 */
describe("QueryCacheEntry — holds", () => {
    it("is born melting: nobody holds a fresh entry", () => {
        const { entry } = createControlledEntry({ isHeld: false });
        expect(entry.isMelting).toBe(true);
    });

    it("hold() makes the entry active; the release is idempotent", () => {
        const { entry } = createControlledEntry({ isHeld: false });

        const release = entry.hold();
        expect(entry.isMelting).toBe(false);

        release();
        expect(entry.isMelting).toBe(true);

        // A second release must not drive the count negative.
        release();
        const other = entry.hold();
        expect(entry.isMelting).toBe(false);
        other();
        expect(entry.isMelting).toBe(true);
    });

    it("subscribing to obs holds the entry for the life of the subscription", () => {
        const { entry } = createControlledEntry({ isHeld: false });

        const subscription = entry.obs.subscribe();
        expect(entry.isMelting).toBe(false);

        subscription.unsubscribe();
        expect(entry.isMelting).toBe(true);
    });

    it("peek() and state$.peek() do not hold", async () => {
        const { entry, runs } = createControlledEntry({ isHeld: false });
        runs[0]!.resolve(1);
        await flushMicrotasks();

        expect(entry.peek().status).toBe("success");
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$().status).toBe("success");
        expect(entry.isMelting).toBe(true);
    });

    it("state$ read by an unsubscribed Computed does not hold", () => {
        const { entry } = createControlledEntry({ isHeld: false });

        const status$ = Signal.compute(() => entry.state$().status);
        expect(status$.peek()).toBe("pending");
        expect(entry.isMelting).toBe(true);
    });

    it("state$ read by a Signal.effect holds until the effect is unsubscribed", () => {
        const { entry } = createControlledEntry({ isHeld: false });
        const seen: string[] = [];

        const effect = Signal.effect(() => {
            seen.push(entry.state$().status);
        });
        expect(entry.isMelting).toBe(false);
        expect(seen).toEqual(["pending"]);

        effect.unsubscribe();
        expect(entry.isMelting).toBe(true);
    });

    it("state$ read by a subscribed Computed holds until the subscriber leaves", () => {
        const { entry } = createControlledEntry({ isHeld: false });

        const status$ = Signal.compute(() => entry.state$().status);
        const subscription = status$.obs.subscribe();
        expect(entry.isMelting).toBe(false);

        subscription.unsubscribe();
        expect(entry.isMelting).toBe(true);
    });

    it("whenLoaded / whenFetched hold the entry until they settle", async () => {
        const { entry, runs } = createControlledEntry({ isHeld: false });

        const loaded = entry.whenLoaded();
        const fetched = entry.whenFetched();
        expect(entry.isMelting).toBe(false);

        runs[0]!.resolve(1);
        await expect(loaded).resolves.toBe(1);
        await expect(fetched).resolves.toBe(1);
        expect(entry.isMelting).toBe(true);
    });

    it("a detached whenLoaded releases its hold", async () => {
        const { entry } = createControlledEntry({ isHeld: false });
        const controller = new AbortController();

        const loaded = entry.whenLoaded(controller.signal);
        expect(entry.isMelting).toBe(false);

        controller.abort();
        await expect(loaded).rejects.toBeDefined();
        expect(entry.isMelting).toBe(true);
    });

    it("currentResult() and whenFirstLoaded() do not hold", () => {
        const { entry } = createControlledEntry({ isHeld: false });

        void entry.currentResult();
        void entry.whenFirstLoaded();
        expect(entry.isMelting).toBe(true);
    });

    it("hold() on a completed entry is a no-op", () => {
        const { entry } = createControlledEntry({ isHeld: false });
        entry.complete();

        const release = entry.hold();
        expect(entry.isMelting).toBe(true);
        release();
        expect(entry.isMelting).toBe(true);
    });
});

// ==================== Lazy invalidation ====================

/**
 * `invalidate()` on a melting entry — nobody is looking — only marks it: the
 * re-run waits for the first hold. Every row of the state table is exercised
 * for both what the mark does and what it does not do.
 */
describe("QueryCacheEntry — invalidate() on a melting entry", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** A melting entry parked in the given status, `runs` exhausted. */
    async function createMeltingEntry(status: "success" | "error" | "invalidate-error") {
        const { entry, runs } = createControlledEntry({ isHeld: false });

        if (status === "error") {
            runs[0]!.reject(new Error("boom"));
            await flushMicrotasks();
            return { entry, runs };
        }

        runs[0]!.resolve(1);
        await flushMicrotasks();

        if (status === "invalidate-error") {
            // Only an active entry re-runs at once: hold it for the failing run.
            const release = entry.hold();
            entry.invalidate();
            runs[1]!.reject(new Error("invalidate-boom"));
            await flushMicrotasks();
            release();
        }

        return { entry, runs };
    }

    it.each(["success", "error", "invalidate-error"] as const)(
        "from %s: marks the entry, keeps its state and starts no run",
        async (status) => {
            const { entry, runs } = await createMeltingEntry(status);
            const runsBefore = runs.length;
            const stateBefore = entry.peek();

            entry.invalidate();

            expect(entry.isInvalidated).toBe(true);
            expect(runs).toHaveLength(runsBefore);
            expect(entry.peek()).toBe(stateBefore);
        },
    );

    it("a second invalidate() on a marked entry is a no-op", async () => {
        const { entry, runs } = await createMeltingEntry("success");

        entry.invalidate();
        entry.invalidate();

        expect(entry.isInvalidated).toBe(true);
        expect(runs).toHaveLength(1);
    });

    // `pending` / `invalidating` — a run in flight — are covered by the
    // "invalidate() with a … run in flight" suites below.

    it.each(["cancel", "trail", "join"] as const)(
        "invalidateInFlight: %s does not change a settled melting entry: it is marked, nothing runs",
        async (invalidateInFlight) => {
            const { entry, runs } = createControlledEntry({ isHeld: false, invalidateInFlight });
            runs[0]!.resolve(1);
            await flushMicrotasks();

            entry.invalidate();

            expect(entry.isInvalidated).toBe(true);
            expect(runs).toHaveLength(1);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });
        },
    );

    it("on a command entry: warns, does not mark", async () => {
        const { entry, runs } = createControlledEntry({ errorSource: "command", isHeld: false });
        runs[0]!.resolve(1);
        await flushMicrotasks();

        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        entry.invalidate();

        expect(entry.isInvalidated).toBe(false);
        expect(runs).toHaveLength(1);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("from success: the first hold revalidates — invalidating, run started, mark cleared", async () => {
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        const release = entry.hold();

        expect(runs).toHaveLength(2);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });

        runs[1]!.resolve(2);
        await flushMicrotasks();
        expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        release();
    });

    it("from error: the first hold revalidates — pending with the error cleared", async () => {
        const { entry, runs } = await createMeltingEntry("error");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        entry.hold();

        expect(runs).toHaveLength(2);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.peek()).toMatchObject({ status: "pending", error: null });
    });

    it("from invalidate-error: the first hold revalidates — invalidating with the error cleared", async () => {
        const { entry, runs } = await createMeltingEntry("invalidate-error");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(2);
        expect(entry.isInvalidated).toBe(true);

        entry.hold();

        expect(runs).toHaveLength(3);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });
    });

    it("a subscriber's first state is the in-flight one, not the marked data", async () => {
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        const statuses: string[] = [];
        const subscription = entry.obs.subscribe((state) => statuses.push(state.status));

        expect(statuses).toEqual(["invalidating"]);
        expect(runs).toHaveLength(2);
        subscription.unsubscribe();
    });

    it("state$ read by a Signal.effect sees the in-flight state on its first run", async () => {
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        const statuses: string[] = [];
        const effect = Signal.effect(() => {
            statuses.push(entry.state$().status);
        });

        expect(statuses).toEqual(["invalidating"]);
        expect(runs).toHaveLength(2);
        effect.unsubscribe();
    });

    it("the deferred run does not leak the queryFn's signal reads into the subscribing effect", async () => {
        // `onActive` fires inside the effect's run, with the tracker collecting
        // dependencies: a `queryFn` reading a signal there must not make the
        // effect depend on it.
        const token = Signal.state("a");
        const runs: TRun[] = [];
        const entry = createEntry<void, number>({
            queryFn: (_args, signal) => {
                token();
                return new Promise<number>((resolve, reject) => {
                    runs.push({ resolve, reject, signal });
                });
            },
        });
        runs[0]!.resolve(1);
        await flushMicrotasks();
        entry.invalidate();
        expect(entry.isInvalidated).toBe(true);

        let effectRuns = 0;
        const effect = Signal.effect(() => {
            entry.state$();
            effectRuns += 1;
        });
        expect(runs).toHaveLength(2);
        expect(effectRuns).toBe(1);

        token.set("b");
        await flushMicrotasks();

        expect(effectRuns).toBe(1);
        effect.unsubscribe();
    });

    it("only the first hold revalidates: a second concurrent hold starts nothing", async () => {
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        const releaseA = entry.hold();
        const releaseB = entry.hold();

        expect(runs).toHaveLength(2);
        releaseA();
        releaseB();
    });

    it("whenFetched on a marked entry resolves with the fresh result", async () => {
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        const fetched = entry.whenFetched();
        expect(runs).toHaveLength(2);

        runs[1]!.resolve(2);
        await expect(fetched).resolves.toBe(2);
    });

    it("whenLoaded on a marked entry resolves with the marked data while the run goes out behind", async () => {
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        await expect(entry.whenLoaded()).resolves.toBe(1);
        expect(runs).toHaveLength(2);
        expect(entry.peek().status).toBe("invalidating");
    });

    it("retry() on a marked failed entry clears the mark and runs as usual", async () => {
        const { entry, runs } = await createMeltingEntry("error");
        entry.invalidate();

        entry.retry();

        expect(entry.isInvalidated).toBe(false);
        expect(runs).toHaveLength(2);
        expect(entry.peek()).toMatchObject({ status: "pending", error: expect.any(Error) });

        // The retry's run has satisfied the invalidation: a later hold starts nothing.
        runs[1]!.resolve(3);
        await flushMicrotasks();
        entry.hold();
        expect(runs).toHaveLength(2);
    });

    it("complete() before the first hold: no revalidation, subscribers just complete", async () => {
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();

        entry.complete();

        let isCompleted = false;
        entry.obs.subscribe({ complete: () => (isCompleted = true) });

        expect(isCompleted).toBe(true);
        expect(runs).toHaveLength(1);
    });

    it("the mark is dropped when a run settles the invalidation by other means", async () => {
        // A consistency-violation invalidate while melting only marks; the
        // stream run that follows through `retry()` clears it (covered above).
        // Here: the marked entry gets held, revalidated and released — the next
        // hold must not revalidate again.
        const { entry, runs } = await createMeltingEntry("success");
        entry.invalidate();
        // Nothing happens before the hold: the run below is the hold's.
        expect(runs).toHaveLength(1);
        expect(entry.isInvalidated).toBe(true);

        const release = entry.hold();
        runs[1]!.resolve(2);
        await flushMicrotasks();
        release();

        entry.hold();
        expect(runs).toHaveLength(2);
    });
});

// ==================== Hydration ====================

describe("QueryCacheEntry — hydrated with isInvalidated", () => {
    const hydrated: TQueryEntryState<number, string> = {
        status: "success",
        args: 1,
        data: "snapshot",
        error: null,
        updatedAt: 1000,
        patchState: null,
    };

    it("starts as marked settled data and runs no query until held", async () => {
        const queryFn = vi.fn(async () => "fresh");
        const entry = createEntry<number, string>({
            keyedArgs: toKeyed(1),
            queryFn,
            initialState: hydrated,
            isInvalidated: true,
        });

        expect(entry.peek()).toMatchObject({ status: "success", data: "snapshot" });
        expect(entry.isInvalidated).toBe(true);
        expect(entry.isMelting).toBe(true);
        expect(queryFn).not.toHaveBeenCalled();

        const release = entry.hold();

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.peek()).toMatchObject({ status: "invalidating", data: "snapshot" });

        await flushMicrotasks();
        expect(entry.peek()).toMatchObject({ status: "success", data: "fresh" });
        release();
    });

    it("whenFirstLoaded() settles with the snapshot data at once", async () => {
        const entry = createEntry<number, string>({
            keyedArgs: toKeyed(1),
            queryFn: async () => "fresh",
            initialState: hydrated,
            isInvalidated: true,
        });

        await expect(entry.whenFirstLoaded()).resolves.toBe("snapshot");
        expect(entry.isMelting).toBe(true);
    });

    it("isInvalidated on a pending initial state is kept: the first hold starts the owed run", async () => {
        // A mark on `pending` is a normal state (a cancelled run leaves one
        // behind), so the constructor takes the option as it is: nothing is in
        // flight, and the first hold runs the query it owes.
        const queryFn = vi.fn(async () => "fresh");
        const entry = createEntry<number, string>({
            keyedArgs: toKeyed(1),
            queryFn,
            initialState: {
                status: "pending",
                args: 1,
                data: null,
                error: null,
                updatedAt: null,
            },
            isInvalidated: true,
        });

        expect(entry.isInvalidated).toBe(true);
        expect(queryFn).not.toHaveBeenCalled();

        entry.hold();

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry.isInvalidated).toBe(false);
        expect(entry.peek().status).toBe("pending");
        await flushMicrotasks();
        expect(entry.peek()).toMatchObject({ status: "success", data: "fresh" });
    });
});

// ==================== Invalidation in flight ====================

/**
 * `invalidate()` while a promise run is in flight (`pending` / `invalidating`).
 * One rule drives every cell: the entry revalidates when it is held, nothing is
 * in flight and the mark is set — checked in `invalidate()` itself, on the
 * settle of any run and on the first hold. `cancel` (the default) aborts the
 * run to get there at once; `trail` lets it settle first; `join` takes the run
 * as the answer and does nothing.
 */
describe("QueryCacheEntry — invalidate() with a promise run in flight", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** A held entry parked in `invalidating`: run 1 delivered `1`, run 2 is in flight. */
    async function createInvalidating(options: { isHeld?: boolean; invalidateInFlight?: TInFlightPolicy } = {}) {
        const { entry, runs, release } = createControlledEntry({ invalidateInFlight: options.invalidateInFlight });
        runs[0]!.resolve(1);
        await flushMicrotasks();
        entry.invalidate();
        expect(entry.peek().status).toBe("invalidating");
        expect(runs).toHaveLength(2);
        if (options.isHeld === false) {
            release();
            expect(entry.isMelting).toBe(true);
        }
        return { entry, runs, release };
    }

    it("never warns: a run in flight is a normal state to invalidate from", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const held = createControlledEntry();
        held.entry.invalidate();
        held.entry.invalidate({ inFlight: "trail" });

        const melting = createControlledEntry({ isHeld: false });
        melting.entry.invalidate();
        melting.entry.invalidate({ inFlight: "trail" });

        const joined = createControlledEntry({ invalidateInFlight: "join" });
        joined.entry.invalidate();
        joined.entry.invalidate({ inFlight: "join" });

        expect(warn).not.toHaveBeenCalled();
    });

    // ---------- cancel ----------

    describe("cancel (default)", () => {
        it("active, pending: aborts the run and starts another at once; the status does not change", async () => {
            const { entry, runs } = createControlledEntry();

            entry.invalidate();

            expect(runs).toHaveLength(2);
            expect(runs[0]!.signal.aborted).toBe(true);
            expect(runs[1]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "pending", error: null });

            // The aborted run's late result is ignored.
            runs[0]!.resolve(1);
            await flushMicrotasks();
            expect(entry.peek().status).toBe("pending");

            runs[1]!.resolve(2);
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        });

        it("active, invalidating: aborts the run and starts another at once; the data stays on screen", async () => {
            const { entry, runs } = await createInvalidating();

            entry.invalidate();

            expect(runs).toHaveLength(3);
            expect(runs[1]!.signal.aborted).toBe(true);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });

            runs[2]!.resolve(3);
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: 3 });
        });

        it("melting, pending: aborts the run and marks the entry; the status stays pending", async () => {
            const { entry, runs } = createControlledEntry({ isHeld: false });

            entry.invalidate();

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(true);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek().status).toBe("pending");

            // The aborted run's settle neither clears the mark nor revalidates.
            runs[0]!.resolve(1);
            await flushMicrotasks();
            expect(entry.isInvalidated).toBe(true);
            expect(runs).toHaveLength(1);
            expect(entry.peek().status).toBe("pending");
        });

        it("melting, pending: the first hold runs the query from pending, clearing the mark", async () => {
            const { entry, runs } = createControlledEntry({ isHeld: false });
            entry.invalidate();

            const statuses: string[] = [];
            const subscription = entry.obs.subscribe((state) => statuses.push(state.status));

            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(false);
            expect(statuses).toEqual(["pending"]);

            runs[1]!.resolve(2);
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
            subscription.unsubscribe();
        });

        it("melting, invalidating: aborts the run and marks the entry; the status stays invalidating", async () => {
            const { entry, runs } = await createInvalidating({ isHeld: false });

            entry.invalidate();

            expect(runs).toHaveLength(2);
            expect(runs[1]!.signal.aborted).toBe(true);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });

            // The aborted run's late failure is ignored as well.
            runs[1]!.reject(new Error("late"));
            await flushMicrotasks();
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });
        });

        it("melting, invalidating: the first hold runs the query from invalidating, clearing the mark", async () => {
            const { entry, runs } = await createInvalidating({ isHeld: false });
            entry.invalidate();

            const release = entry.hold();

            expect(runs).toHaveLength(3);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });

            runs[2]!.resolve(3);
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: 3 });
            release();
        });

        it("whenFetched on a cancelled melting run resolves with the run its hold starts", async () => {
            const { entry, runs } = createControlledEntry({ isHeld: false });
            entry.invalidate();
            expect(runs).toHaveLength(1);

            const fetched = entry.whenFetched();
            expect(runs).toHaveLength(2);

            runs[1]!.resolve(2);
            await expect(fetched).resolves.toBe(2);
        });
    });

    // ---------- trail ----------

    describe("trail", () => {
        it("active, pending: marks the entry and lets the run settle; the settle revalidates at once", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "trail" });

            entry.invalidate();

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek().status).toBe("pending");

            const statuses: string[] = [];
            const subscription = entry.obs.subscribe((state) => statuses.push(state.status));
            runs[0]!.resolve(1);
            await flushMicrotasks();

            // The run's data landed and was immediately re-checked.
            expect(statuses).toEqual(["pending", "success", "invalidating"]);
            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });

            runs[1]!.resolve(2);
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
            subscription.unsubscribe();
        });

        it("active, pending, run fails: the failure lands in error and the revalidation restarts from pending", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "trail" });
            entry.invalidate();

            const statuses: string[] = [];
            const subscription = entry.obs.subscribe((state) => statuses.push(state.status));
            runs[0]!.reject(new Error("boom"));
            await flushMicrotasks();

            expect(statuses).toEqual(["pending", "error", "pending"]);
            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "pending", error: null });
            subscription.unsubscribe();
        });

        it("active, invalidating: marks the entry and lets the run settle; the settle revalidates at once", async () => {
            const { entry, runs } = await createInvalidating({ invalidateInFlight: "trail" });

            entry.invalidate();

            expect(runs).toHaveLength(2);
            expect(runs[1]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(true);

            runs[1]!.resolve(2);
            await flushMicrotasks();

            expect(runs).toHaveLength(3);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 2, error: null });

            runs[2]!.resolve(3);
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: 3 });
        });

        it("active, invalidating, run fails: invalidate-error, then the revalidation clears the failure", async () => {
            const { entry, runs } = await createInvalidating({ invalidateInFlight: "trail" });
            entry.invalidate();

            runs[1]!.reject(new Error("boom"));
            await flushMicrotasks();

            expect(runs).toHaveLength(3);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });
        });

        it("whenFetched settles with the trailed run's result, not the revalidation's", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "trail" });
            const fetched = entry.whenFetched();
            entry.invalidate();

            runs[0]!.resolve(1);
            await expect(fetched).resolves.toBe(1);
            expect(runs).toHaveLength(2);
        });

        it("a second invalidate() while trailing is a no-op", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "trail" });
            entry.invalidate();
            entry.invalidate();

            expect(runs).toHaveLength(1);
            runs[0]!.resolve(1);
            await flushMicrotasks();
            // One revalidation for both marks.
            expect(runs).toHaveLength(2);
        });

        it("melting, pending: marks the entry; the settle does nothing; the first hold revalidates", async () => {
            const { entry, runs } = createControlledEntry({ isHeld: false, invalidateInFlight: "trail" });

            entry.invalidate();

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(true);

            runs[0]!.resolve(1);
            await flushMicrotasks();

            // Settled with the mark kept: nobody is looking.
            expect(runs).toHaveLength(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });

            const release = entry.hold();
            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });
            release();
        });

        it("melting, invalidating: marks the entry; the settle does nothing; the first hold revalidates", async () => {
            const { entry, runs } = await createInvalidating({ isHeld: false, invalidateInFlight: "trail" });

            entry.invalidate();

            expect(runs).toHaveLength(2);
            expect(runs[1]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(true);

            runs[1]!.resolve(2);
            await flushMicrotasks();

            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });

            entry.hold();
            expect(runs).toHaveLength(3);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 2 });
        });

        it("a hold taken while trailing starts nothing: the settle revalidates, because the entry is now held", async () => {
            const { entry, runs } = createControlledEntry({ isHeld: false, invalidateInFlight: "trail" });
            entry.invalidate();

            const release = entry.hold();
            // In flight: the hold has nothing to start yet.
            expect(runs).toHaveLength(1);
            expect(entry.isInvalidated).toBe(true);

            runs[0]!.resolve(1);
            await flushMicrotasks();

            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });
            release();
        });

        it("a release before the settle turns the trailing run into a mark: the settle does nothing", async () => {
            const { entry, runs, release } = createControlledEntry({ invalidateInFlight: "trail" });
            entry.invalidate();
            release();

            runs[0]!.resolve(1);
            await flushMicrotasks();

            expect(runs).toHaveLength(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });
        });

        it("retry() on the failed trailed run of a melting entry clears the mark", async () => {
            const { entry, runs } = createControlledEntry({ isHeld: false, invalidateInFlight: "trail" });
            entry.invalidate();
            runs[0]!.reject(new Error("boom"));
            await flushMicrotasks();
            expect(entry.peek().status).toBe("error");
            expect(entry.isInvalidated).toBe(true);

            entry.retry();

            expect(entry.isInvalidated).toBe(false);
            expect(runs).toHaveLength(2);
        });
    });

    // ---------- join ----------

    describe("join", () => {
        it("active, pending: a no-op — the run is not aborted, the entry is not marked, the settle re-queries nothing", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "join" });

            entry.invalidate();

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek().status).toBe("pending");

            const statuses: string[] = [];
            const subscription = entry.obs.subscribe((state) => statuses.push(state.status));
            runs[0]!.resolve(1);
            await flushMicrotasks();

            // The joined run's result is the answer to the invalidation.
            expect(statuses).toEqual(["pending", "success"]);
            expect(runs).toHaveLength(1);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });
            subscription.unsubscribe();
        });

        it("active, invalidating: a no-op — the revalidation in flight settles and nothing follows it", async () => {
            const { entry, runs } = await createInvalidating({ invalidateInFlight: "join" });

            entry.invalidate();

            expect(runs).toHaveLength(2);
            expect(runs[1]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });

            runs[1]!.resolve(2);
            await flushMicrotasks();

            expect(runs).toHaveLength(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        });

        it("active, pending, run fails: the failure lands in error and nothing re-queries", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "join" });
            entry.invalidate();

            runs[0]!.reject(new Error("boom"));
            await flushMicrotasks();

            expect(runs).toHaveLength(1);
            expect(entry.peek().status).toBe("error");
        });

        it("melting, pending: a no-op — not marked, so the first hold after the settle starts nothing", async () => {
            const { entry, runs } = createControlledEntry({ isHeld: false, invalidateInFlight: "join" });

            entry.invalidate();

            expect(runs[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);

            runs[0]!.resolve(1);
            await flushMicrotasks();

            const release = entry.hold();
            expect(runs).toHaveLength(1);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });
            release();
        });

        it("melting, invalidating: a no-op — not marked, the run settles as usual", async () => {
            const { entry, runs } = await createInvalidating({ isHeld: false, invalidateInFlight: "join" });

            entry.invalidate();

            expect(runs[1]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);

            runs[1]!.resolve(2);
            await flushMicrotasks();
            entry.hold();

            expect(runs).toHaveLength(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        });

        it("whenFetched settles with the joined run's result", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "join" });
            const fetched = entry.whenFetched();
            entry.invalidate();

            runs[0]!.resolve(1);
            await expect(fetched).resolves.toBe(1);
            expect(runs).toHaveLength(1);
        });

        it("leaves a mark set earlier (by a trailing call) as it is: the settle still revalidates", async () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "join" });
            entry.invalidate({ inFlight: "trail" });
            expect(entry.isInvalidated).toBe(true);

            entry.invalidate();
            expect(entry.isInvalidated).toBe(true);

            runs[0]!.resolve(1);
            await flushMicrotasks();
            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(false);
        });
    });

    // ---------- the call parameter ----------

    describe("a rebase that discards its own result (consistency violation)", () => {
        /** A held entry with data and a run in flight behind a pending patch on `items[0]`. */
        function createPatchedInvalidating(options: { invalidateInFlight?: TInFlightPolicy } = {}) {
            const runs: { resolve: (value: TData) => void; signal: AbortSignal }[] = [];
            const entry = createEntry<void, TData>({
                invalidateInFlight: options.invalidateInFlight,
                queryFn: (_args, signal) =>
                    new Promise<TData>((resolve) => {
                        runs.push({ resolve, signal });
                    }),
            });
            const release = entry.hold();
            runs[0]!.resolve({ items: [{ n: 1 }] });
            return { entry, runs, release };
        }

        it("held: the run settled nothing, so the entry re-queries at once and stays invalidating", async () => {
            const { entry, runs } = createPatchedInvalidating();
            await flushMicrotasks();
            entry.invalidate();
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });

            // The patch cannot replay over an empty list: the result is discarded.
            runs[1]!.resolve({ items: [] });
            await flushMicrotasks();

            expect(runs).toHaveLength(3);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: { items: [{ n: 99 }] } });

            runs[2]!.resolve({ items: [{ n: 5 }] });
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
        });

        it("melting: the violation only marks the entry; the first hold re-queries", async () => {
            const { entry, runs, release } = createPatchedInvalidating();
            await flushMicrotasks();
            entry.invalidate();
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });
            release();
            expect(entry.isMelting).toBe(true);

            runs[1]!.resolve({ items: [] });
            await flushMicrotasks();

            // Nobody is looking: no follow-up run, the entry owes one.
            expect(runs).toHaveLength(2);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek().status).toBe("invalidating");

            entry.hold();
            expect(runs).toHaveLength(3);
            expect(entry.isInvalidated).toBe(false);

            runs[2]!.resolve({ items: [{ n: 5 }] });
            await flushMicrotasks();
            expect(entry.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
        });

        it("under a join default a violation raised by a settled promise run re-queries: that run is no longer in flight to join", async () => {
            const { entry, runs } = createPatchedInvalidating({ invalidateInFlight: "join" });
            await flushMicrotasks();
            entry.invalidate();
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });

            runs[1]!.resolve({ items: [] });
            await flushMicrotasks();

            expect(runs).toHaveLength(3);
            expect(entry.peek().status).toBe("invalidating");
        });
    });

    describe("the call parameter overrides the entry's default", () => {
        it("{ inFlight: 'join' } on a cancel entry is a no-op for the run in flight", () => {
            const { entry, runs } = createControlledEntry();

            entry.invalidate({ inFlight: "join" });

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(false);
        });

        it("{ inFlight: 'cancel' } / { inFlight: 'trail' } on a join entry override it", () => {
            const cancel = createControlledEntry({ invalidateInFlight: "join" });
            cancel.entry.invalidate({ inFlight: "cancel" });
            expect(cancel.runs).toHaveLength(2);
            expect(cancel.runs[0]!.signal.aborted).toBe(true);

            const trail = createControlledEntry({ invalidateInFlight: "join" });
            trail.entry.invalidate({ inFlight: "trail" });
            expect(trail.runs).toHaveLength(1);
            expect(trail.entry.isInvalidated).toBe(true);
        });

        it("{ inFlight: 'trail' } on a cancel entry marks instead of aborting", () => {
            const { entry, runs } = createControlledEntry();

            entry.invalidate({ inFlight: "trail" });

            expect(runs).toHaveLength(1);
            expect(runs[0]!.signal.aborted).toBe(false);
            expect(entry.isInvalidated).toBe(true);
        });

        it("{ inFlight: 'cancel' } on a trail entry aborts and restarts", () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "trail" });

            entry.invalidate({ inFlight: "cancel" });

            expect(runs).toHaveLength(2);
            expect(runs[0]!.signal.aborted).toBe(true);
            expect(entry.isInvalidated).toBe(false);
        });

        it("an empty options object falls back to the entry's default", () => {
            const { entry, runs } = createControlledEntry({ invalidateInFlight: "trail" });

            entry.invalidate({});

            expect(runs).toHaveLength(1);
            expect(entry.isInvalidated).toBe(true);
        });
    });
});

/**
 * `invalidate()` while a stream run is in flight. For a stream "in flight" is
 * an open subscription — `success` with a live stream included — so `trail`
 * waits for the stream to complete or fail, an emission never clears the
 * mark, and `join` leaves the open stream as it is.
 */
describe("QueryCacheEntry — invalidate() with a stream run in flight", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Subscriber handle and counters of a cold stream, one subscriber at a time. */
    function trackedStream<T>() {
        const state = {
            subscribeCount: 0,
            teardownCount: 0,
            subscriber: null as { next: (v: T) => void; error: (e: unknown) => void; complete: () => void } | null,
        };
        const stream = new Observable<T>((subscriber) => {
            state.subscribeCount += 1;
            state.subscriber = subscriber;
            return () => {
                state.teardownCount += 1;
            };
        });
        return { stream, state };
    }

    function createStreamEntry(options: { isHeld?: boolean; invalidateInFlight?: TInFlightPolicy } = {}) {
        const { stream, state } = trackedStream<number>();
        const entry = createEntry<void, number>({
            queryFn: () => stream,
            invalidateInFlight: options.invalidateInFlight,
        });
        const release = options.isHeld === false ? () => {} : entry.hold();
        return { entry, state, release };
    }

    describe("cancel (default)", () => {
        it("active, before the first emission: unsubscribes and resubscribes; the status stays pending", () => {
            const { entry, state } = createStreamEntry();

            entry.invalidate();

            expect(state.teardownCount).toBe(1);
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek().status).toBe("pending");

            state.subscriber!.next(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        });

        it("active, stream open with data: unsubscribes and resubscribes; the first emission rebases", () => {
            const { entry, state } = createStreamEntry();
            state.subscriber!.next(1);

            entry.invalidate();

            expect(state.teardownCount).toBe(1);
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });

            state.subscriber!.next(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        });

        it("a rebase discarded on the new stream's first emission restarts the stream (cancel semantics)", () => {
            const { stream, state } = trackedStream<TData>();
            const entry = createEntry<void, TData>({ queryFn: () => stream });
            entry.hold();
            state.subscriber!.next({ items: [{ n: 1 }] });

            entry.invalidate();
            expect(state.subscribeCount).toBe(2);
            const run2 = state.subscriber!;
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });

            // The patch cannot replay over an empty list: the emission is
            // discarded and the violation invalidates under the entry's
            // policy — `cancel` reopens the stream at once.
            run2.next({ items: [] });

            expect(state.teardownCount).toBe(2);
            expect(state.subscribeCount).toBe(3);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: { items: [{ n: 99 }] } });

            state.subscriber!.next({ items: [{ n: 5 }] });
            expect(entry.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
        });

        it("melting, stream open with data: unsubscribes now and marks the entry; the first hold resubscribes", () => {
            const { entry, state } = createStreamEntry({ isHeld: false });
            const run1 = state.subscriber!;
            run1.next(1);

            entry.invalidate();

            // The data is declared unreliable: the socket is not worth keeping.
            expect(state.teardownCount).toBe(1);
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });

            // The torn-down producer keeps pushing — it no longer reaches the entry.
            run1.next(99);
            expect(entry.peek().data).toBe(1);

            entry.hold();
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });

            state.subscriber!.next(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        });

        it("melting, before the first emission: unsubscribes now and marks; the first hold resubscribes from pending", () => {
            const { entry, state } = createStreamEntry({ isHeld: false });

            entry.invalidate();

            expect(state.teardownCount).toBe(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek().status).toBe("pending");

            entry.hold();
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek().status).toBe("pending");
        });
    });

    describe("trail", () => {
        it("active, stream open with data: marks; emissions land without clearing the mark; completion resubscribes", () => {
            const { entry, state } = createStreamEntry({ invalidateInFlight: "trail" });
            const run1 = state.subscriber!;
            run1.next(1);

            entry.invalidate();

            expect(state.teardownCount).toBe(0);
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });

            run1.next(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
            expect(entry.isInvalidated).toBe(true);

            run1.complete();

            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 2, error: null });

            state.subscriber!.next(3);
            expect(entry.peek()).toMatchObject({ status: "success", data: 3 });
        });

        it("active, stream open with data: a stream error lands in invalidate-error and then revalidates", () => {
            const { entry, state } = createStreamEntry({ invalidateInFlight: "trail" });
            const run1 = state.subscriber!;
            run1.next(1);
            entry.invalidate();

            const statuses: string[] = [];
            const subscription = entry.obs.subscribe((s) => statuses.push(s.status));
            run1.error(new Error("boom"));

            expect(statuses).toEqual(["success", "invalidate-error", "invalidating"]);
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1, error: null });
            subscription.unsubscribe();
        });

        it("active, before the first emission: the first emission does not clear the mark; completion does", () => {
            const { entry, state } = createStreamEntry({ invalidateInFlight: "trail" });
            const run1 = state.subscriber!;

            entry.invalidate();
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek().status).toBe("pending");

            run1.next(1);
            // `success` with an open stream is still in flight under trail.
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });
            expect(entry.isInvalidated).toBe(true);
            expect(state.subscribeCount).toBe(1);

            run1.complete();
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 1 });
        });

        it("active, empty completion: the run fails with EmptyStreamError and the revalidation restarts from pending", () => {
            const { entry, state } = createStreamEntry({ invalidateInFlight: "trail" });
            entry.invalidate();

            const statuses: string[] = [];
            const subscription = entry.obs.subscribe((s) => statuses.push(s.status));
            state.subscriber!.complete();

            expect(statuses).toEqual(["pending", "error", "pending"]);
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "pending", error: null });
            subscription.unsubscribe();
        });

        it("melting, stream open with data: marks and keeps the stream; completion does nothing; the first hold resubscribes", () => {
            const { entry, state } = createStreamEntry({ isHeld: false, invalidateInFlight: "trail" });
            const run1 = state.subscriber!;
            run1.next(1);

            entry.invalidate();

            expect(state.teardownCount).toBe(0);
            expect(entry.isInvalidated).toBe(true);

            run1.next(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
            expect(entry.isInvalidated).toBe(true);

            run1.complete();
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });

            entry.hold();
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: 2 });
        });

        it("melting, stream still open: the first hold trusts the trailed stream and waits for its completion", () => {
            const { entry, state } = createStreamEntry({ isHeld: false, invalidateInFlight: "trail" });
            state.subscriber!.next(1);
            entry.invalidate();

            entry.hold();

            // Held, marked, a run in flight: the hold waits for the stream.
            expect(state.teardownCount).toBe(0);
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(true);

            state.subscriber!.complete();
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
        });

        it("a rebase discarded on the new stream's first emission trails too: the stream lives on, its next emission settles", () => {
            const { stream, state } = trackedStream<TData>();
            const entry = createEntry<void, TData>({ queryFn: () => stream, invalidateInFlight: "trail" });
            entry.hold();
            state.subscriber!.next({ items: [{ n: 1 }] });

            // Run 2 opened by an explicit cancel; the violation below falls
            // back to the entry's own policy.
            entry.invalidate({ inFlight: "cancel" });
            expect(state.subscribeCount).toBe(2);
            const run2 = state.subscriber!;
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });

            // Discarded: under `trail` the open stream is trusted and kept.
            run2.next({ items: [] });

            expect(state.teardownCount).toBe(1);
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek()).toMatchObject({ status: "invalidating", data: { items: [{ n: 99 }] } });

            // The next emission rebases over the now empty patch list and lands
            // in a clean success; the mark waits for the stream to complete.
            run2.next({ items: [{ n: 5 }] });
            expect(entry.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
            expect(entry.isInvalidated).toBe(true);

            run2.complete();
            expect(state.subscribeCount).toBe(3);
            expect(entry.isInvalidated).toBe(false);
        });

        it("a consistency violation on a stream emission trails too: the stream lives on until it completes", () => {
            const { stream, state } = trackedStream<TData>();
            const entry = createEntry<void, TData>({ queryFn: () => stream, invalidateInFlight: "trail" });
            entry.hold();
            const run1 = state.subscriber!;
            run1.next({ items: [{ n: 1 }] });

            // A pending patch on items[0]; the next emission drops the item, so
            // the patch cannot be replayed — a consistency violation.
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });
            run1.next({ items: [] });

            expect(state.teardownCount).toBe(0);
            expect(entry.isInvalidated).toBe(true);

            run1.complete();
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
        });
    });

    describe("join", () => {
        it("active, stream open with data: a no-op — the stream lives on, nothing is marked, completion resubscribes nothing", () => {
            const { entry, state } = createStreamEntry({ invalidateInFlight: "join" });
            const run1 = state.subscriber!;
            run1.next(1);

            entry.invalidate();

            expect(state.teardownCount).toBe(0);
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });

            run1.next(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });

            run1.complete();
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        });

        it("active, before the first emission: a no-op — the first emission settles the entry", () => {
            const { entry, state } = createStreamEntry({ invalidateInFlight: "join" });

            entry.invalidate();
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek().status).toBe("pending");

            state.subscriber!.next(1);
            state.subscriber!.complete();

            expect(state.subscribeCount).toBe(1);
            expect(entry.peek()).toMatchObject({ status: "success", data: 1 });
        });

        it("melting, stream open with data: a no-op — the stream is kept, the first hold starts nothing", () => {
            const { entry, state } = createStreamEntry({ isHeld: false, invalidateInFlight: "join" });
            state.subscriber!.next(1);

            entry.invalidate();

            expect(state.teardownCount).toBe(0);
            expect(entry.isInvalidated).toBe(false);

            entry.hold();
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(false);
        });

        // Consistency violations re-query through `invalidate()` under the
        // entry's own policy — `join` included: the open stream is trusted to
        // bring the correction itself.

        it("a rebase discarded on the new stream's first emission joins: the stream lives on unmarked, completion re-queries nothing", () => {
            const { stream, state } = trackedStream<TData>();
            const entry = createEntry<void, TData>({ queryFn: () => stream, invalidateInFlight: "join" });
            entry.hold();
            state.subscriber!.next({ items: [{ n: 1 }] });

            entry.invalidate({ inFlight: "cancel" });
            expect(state.subscribeCount).toBe(2);
            const run2 = state.subscriber!;
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });

            run2.next({ items: [] });

            expect(state.teardownCount).toBe(1);
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek().status).toBe("invalidating");

            // The next emission rebases over the now empty patch list.
            run2.next({ items: [{ n: 5 }] });
            expect(entry.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });

            run2.complete();
            expect(state.subscribeCount).toBe(2);
            expect(entry.isInvalidated).toBe(false);
        });

        /** Join entry, held: stream 2's first emission is discarded by a violation and joined. */
        function createJoinedDiscardedRebase() {
            const { stream, state } = trackedStream<TData>();
            const entry = createEntry<void, TData>({ queryFn: () => stream, invalidateInFlight: "join" });
            const release = entry.hold();
            state.subscriber!.next({ items: [{ n: 1 }] });

            entry.invalidate({ inFlight: "cancel" });
            const run2 = state.subscriber!;
            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });
            run2.next({ items: [] });
            expect(entry.peek().status).toBe("invalidating");
            expect(state.subscribeCount).toBe(2);
            return { entry, state, run2, release };
        }

        it("held: a joined stream that ends without landing the rebase leaves flight owing it — the entry re-queries at once", () => {
            const { entry, state, run2 } = createJoinedDiscardedRebase();

            run2.complete();

            expect(state.subscribeCount).toBe(3);
            expect(entry._isInFlight).toBe(true);
            expect(entry.isInvalidated).toBe(false);
            expect(entry.peek().status).toBe("invalidating");

            state.subscriber!.next({ items: [{ n: 5 }] });
            expect(entry.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
        });

        it("melting: a joined stream that ends without landing the rebase marks the entry; the first hold re-queries", () => {
            const { entry, state, run2, release } = createJoinedDiscardedRebase();
            release();
            expect(entry.isMelting).toBe(true);

            run2.complete();

            expect(state.subscribeCount).toBe(2);
            expect(entry._isInFlight).toBe(false);
            expect(entry.isInvalidated).toBe(true);
            expect(entry.peek().status).toBe("invalidating");

            entry.hold();
            expect(state.subscribeCount).toBe(3);
            expect(entry.isInvalidated).toBe(false);

            state.subscriber!.next({ items: [{ n: 5 }] });
            expect(entry.peek()).toMatchObject({ status: "success", data: { items: [{ n: 5 }] } });
        });

        it.each(["cancel", "trail", "join"] as const)(
            "_fetch(%s) over a joined discarded rebase settles once the stream ends and the owed run lands",
            async (policy) => {
                const { entry, state, run2 } = createJoinedDiscardedRebase();

                const fetched = entry._fetch(policy);
                // `cancel` reopened the stream; `trail` / `join` wait for run 2.
                if (policy !== "cancel") run2.complete();

                expect(state.subscribeCount).toBe(3);
                state.subscriber!.next({ items: [{ n: 5 }] });
                await expect(fetched).resolves.toEqual({ items: [{ n: 5 }] });
            },
        );

        it("a consistency violation on a stream emission joins: nothing is marked or re-queried", () => {
            const { stream, state } = trackedStream<TData>();
            const entry = createEntry<void, TData>({ queryFn: () => stream, invalidateInFlight: "join" });
            entry.hold();
            const run1 = state.subscriber!;
            run1.next({ items: [{ n: 1 }] });

            entry.createPatch((draft) => {
                draft.items[0]!.n = 99;
            });
            run1.next({ items: [] });

            expect(state.teardownCount).toBe(0);
            expect(entry.isInvalidated).toBe(false);

            run1.complete();
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(false);
        });

        it("a consistency violation on a patch settle joins: nothing is marked or re-queried", () => {
            const { stream, state } = trackedStream<TData>();
            const entry = createEntry<void, TData>({ queryFn: () => stream, invalidateInFlight: "join" });
            entry.hold();
            const run1 = state.subscriber!;
            run1.next({ items: [{ n: 1 }] });

            // Patch 2 depends on the item patch 1 adds; aborting patch 1 makes
            // patch 2's replay fail on settle — a consistency violation.
            const h1 = entry.createPatch((draft) => {
                draft.items.push({ n: 2 });
            })!;
            entry.createPatch((draft) => {
                draft.items[1]!.n = 3;
            });
            h1.abort();

            expect(entry.peek()).toMatchObject({ patchState: { isConsistencyViolation: true } });
            expect(state.teardownCount).toBe(0);
            expect(entry.isInvalidated).toBe(false);

            run1.complete();
            expect(state.subscribeCount).toBe(1);
            expect(entry.isInvalidated).toBe(false);
        });
    });
});

// ==================== _fetch with nothing in flight ====================

/**
 * `_fetch` on an entry that waits for a load (`pending` / `invalidating`) with
 * nothing in flight — the owner's `beforeQuery` round-trip, a hydrated state —
 * starts a run of its own instead of only awaiting one that may never come.
 */
describe("QueryCacheEntry — _fetch with nothing in flight", () => {
    const idleStates: Array<[string, TQueryEntryState<number, string>]> = [
        ["pending", { status: "pending", args: 1, data: null, error: null, updatedAt: null }],
        [
            "invalidating",
            { status: "invalidating", args: 1, data: "stale", error: null, updatedAt: 1, patchState: null },
        ],
    ];

    describe.each(idleStates)("%s", (_status, initialState) => {
        it.each(["cancel", "trail", "join"] as const)(
            "_fetch(%s) starts a run and resolves with it",
            async (policy) => {
                const queryFn = vi.fn(async () => "fresh");
                const entry = createEntry<number, string>({ keyedArgs: toKeyed(1), queryFn, initialState });

                const fetched = entry._fetch(policy);

                expect(queryFn).toHaveBeenCalledTimes(1);
                expect(entry._invalidationRunPolicy).toBe(policy);
                await expect(fetched).resolves.toBe("fresh");
                expect(entry.peek()).toMatchObject({ status: "success", data: "fresh" });
            },
        );
    });
});

// ==================== In-place revalidation ====================

/**
 * `revalidateInRun`: the run in flight takes a revalidation over instead of
 * being restarted (the projection resource's live runs).
 */
describe("QueryCacheEntry — revalidateInRun", () => {
    function createInPlaceEntry(options: { isHeld?: boolean; accepts?: boolean } = {}) {
        let subscribeCount = 0;
        let teardownCount = 0;
        let subscriber: { next: (value: number) => void; complete: () => void } | null = null;
        const signals: AbortSignal[] = [];
        const stream = (signal: AbortSignal) =>
            new Observable<number>((sub) => {
                subscribeCount += 1;
                signals.push(signal);
                subscriber = sub;
                return () => {
                    teardownCount += 1;
                };
            });
        const revalidateInRun = vi.fn((_signal: AbortSignal, _policy: TInFlightPolicy) => options.accepts ?? true);
        const entry = createEntry<void, number>({
            queryFn: (_args, signal) => stream(signal),
            revalidateInRun,
        });
        if (options.isHeld !== false) entry.hold();
        subscriber!.next(1);
        return {
            entry,
            revalidateInRun,
            signals,
            emit: (value: number) => subscriber!.next(value),
            complete: () => subscriber!.complete(),
            counts: () => ({ subscribeCount, teardownCount }),
        };
    }

    it("a run that ends before the emission settling its in-place revalidation is restarted under the policy", () => {
        const { entry, revalidateInRun, complete, emit, counts } = createInPlaceEntry();
        entry.invalidate({ inFlight: "trail" });
        expect(revalidateInRun).toHaveBeenCalledTimes(1);
        expect(entry.peek().status).toBe("invalidating");

        complete();

        expect(counts().subscribeCount).toBe(2);
        expect(entry._isInFlight).toBe(true);
        expect(entry.isInvalidated).toBe(false);
        expect(entry._invalidationRunPolicy).toBe("trail");
        expect(entry.peek().status).toBe("invalidating");

        emit(2);
        expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
    });

    it.each(["cancel", "trail", "join"] as const)(
        "held, %s: hands the revalidation to the open run with the policy — nothing is aborted",
        (inFlight) => {
            const { entry, revalidateInRun, signals, emit, counts } = createInPlaceEntry();

            entry.invalidate({ inFlight });

            expect(revalidateInRun).toHaveBeenCalledTimes(1);
            expect(revalidateInRun).toHaveBeenCalledWith(signals[0], inFlight);
            expect(counts()).toEqual({ subscribeCount: 1, teardownCount: 0 });
            expect(entry.peek().status).toBe("invalidating");
            expect(entry.isInvalidated).toBe(false);
            expect(entry._invalidationRunPolicy).toBe(inFlight);

            // The run's next emission settles the revalidation.
            emit(2);
            expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
        },
    );

    it("melting: only marks it; the first hold hands the strongest policy since the mark over", () => {
        const { entry, revalidateInRun } = createInPlaceEntry({ isHeld: false });

        entry.invalidate({ inFlight: "join" });
        entry.invalidate({ inFlight: "trail" });
        expect(revalidateInRun).not.toHaveBeenCalled();
        expect(entry.isInvalidated).toBe(true);
        expect(entry.peek().status).toBe("success");

        entry.hold();

        expect(revalidateInRun).toHaveBeenCalledTimes(1);
        expect(revalidateInRun.mock.calls[0]![1]).toBe("trail");
        expect(entry.isInvalidated).toBe(false);
        expect(entry.peek().status).toBe("invalidating");
    });

    it("the policy defaults to the entry's invalidateInFlight", () => {
        let subscriber: { next: (value: number) => void } | null = null;
        const revalidateInRun = vi.fn(() => true);
        const entry = createEntry<void, number>({
            queryFn: () =>
                new Observable<number>((sub) => {
                    subscriber = sub;
                }),
            invalidateInFlight: "join",
            revalidateInRun,
        });
        entry.hold();
        subscriber!.next(1);

        entry.invalidate();

        expect(revalidateInRun).toHaveBeenCalledWith(expect.any(AbortSignal), "join");
    });

    it("a run that turns the revalidation down is restarted under the policy instead", () => {
        const { entry, revalidateInRun, signals, emit, counts } = createInPlaceEntry({ accepts: false });

        entry.invalidate({ inFlight: "trail" });

        expect(revalidateInRun).toHaveBeenCalledTimes(1);
        expect(signals[0]!.aborted).toBe(true);
        expect(counts()).toEqual({ subscribeCount: 2, teardownCount: 1 });
        expect(entry._invalidationRunPolicy).toBe("trail");
        expect(entry.peek().status).toBe("invalidating");

        emit(2);
        expect(entry.peek()).toMatchObject({ status: "success", data: 2 });
    });

    it("with no run in flight, invalidate() starts a run that carries the policy", () => {
        const runs: Array<{ reject: (error: unknown) => void }> = [];
        const revalidateInRun = vi.fn(() => true);
        const entry = createEntry<void, number>({
            queryFn: () =>
                new Observable<number>((sub) => {
                    runs.push({ reject: (error) => sub.error(error) });
                }),
            revalidateInRun,
        });
        entry.hold();
        runs[0]!.reject(new Error("boom"));
        expect(entry.peek().status).toBe("error");
        expect(entry._invalidationRunPolicy).toBeNull();

        entry.invalidate({ inFlight: "join" });

        expect(revalidateInRun).not.toHaveBeenCalled();
        expect(runs).toHaveLength(2);
        expect(entry._invalidationRunPolicy).toBe("join");

        // A retry keeps the policy of the invalidation it repeats.
        runs[1]!.reject(new Error("boom"));
        entry.retry();
        expect(runs).toHaveLength(3);
        expect(entry._invalidationRunPolicy).toBe("join");
    });
});

// ==================== retentionTime normalization ====================

/**
 * The normalization table holds for a static option value and for the result of
 * a `retentionTime` function alike. Every row is exercised end to end: a cycle
 * is armed by dropping the entry's last subscriber (the `active → retention`
 * transition), and "removed" is read off {@link QueryCacheEntry.isCompleted} —
 * the retainer's timer completes the entry.
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
