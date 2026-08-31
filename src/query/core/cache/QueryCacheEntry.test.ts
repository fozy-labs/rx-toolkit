import { Observable, of, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { toKeyed } from "@/query/lib/toKeyed";
import type { IQueryCacheEntryOptions, Keyed } from "@/query/types";

import { QueryCacheEntry } from "./QueryCacheEntry";

// ==================== Helpers ====================

type TData = { items: { n: number }[] };

function createEntry<TArgs, TData>(
    options: Pick<IQueryCacheEntryOptions<TArgs, TData>, "queryFn" | "onStreamPatch"> & {
        keyedArgs?: Keyed<TArgs>;
    },
): QueryCacheEntry<TArgs, TData> {
    return new QueryCacheEntry<TArgs, TData>({
        retentionTime: false,
        keyedArgs: options.keyedArgs ?? toKeyed(undefined as TArgs),
        queryFn: options.queryFn,
        onStreamPatch: options.onStreamPatch,
    });
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
 * (refresh) while the aborted run's `subscribe` call is still on the stack —
 * so that run's abort listener was never attached.
 *
 * Shared choreography of each test:
 *   run 1 — stream delivering `{ items: [{ n: 1 }] }` (baseline data);
 *   patch — pending optimistic patch on `items[0]` (flag closed, no signal);
 *   run 2 — refresh; the stream synchronously emits `{ items: [] }`, the
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
        expect(entry.machine$.peek().state.status).toBe("success");

        // Pending patch over closed stream — must not signal.
        entry.createPatch((draft) => {
            draft.items[0]!.n = 99;
        });
        expect(onStreamPatch).not.toHaveBeenCalled();

        // Run 2: the sync `{ items: [] }` emission invalidates the patch path
        // → consistency violation → nested refresh aborts run 2 in-subscribe.
        entry.refresh();
        expect(call).toBe(3);

        return { entry, onStreamPatch };
    }

    it("superseding promise run: the flag is released — later patches do not signal", async () => {
        const run3 = deferred<TData>();
        const { entry, onStreamPatch } = runViolationScenario(() => run3.promise, syncEmit<TData>({ items: [] }));

        run3.resolve({ items: [{ n: 5 }] });
        await flushMicrotasks();

        const state = entry.machine$.peek().state;
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

        expect(entry.machine$.peek().state.status).toBe("success");

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
