import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { flushUnhandledRejections, trackUnhandledRejections } from "@/__tests__/helpers/unhandled-rejections";
import { CacheEntryRemovedError } from "@/query/core/errors";
import { pendingEntryState } from "@/query/core/machine/machine-helpers";
import { Resource } from "@/query/core/resource/Resource";
import { ResourceClutch } from "@/query/core/resource/ResourceClutch";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceConfig, TResourceSnapshot } from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// ==================== Helpers ====================

function createConfig<TArgs, TData>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
): IResourceConfig<TArgs, TData> {
    return {
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        ...overrides,
    };
}

function createResource<TArgs = void, TData = string>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Resource<TArgs, TData>(createConfig(overrides));
}

// ==================== Constructor ====================

describe("Resource constructor", () => {
    it("creates resource with idle status and empty cache", () => {
        const resource = createResource({
            queryFn: async () => "data",
        });

        const entries = [...resource.getEntries()];
        expect(entries).toEqual([]);
    });

    it("hydrates entries from snapshot", async () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(42)]: {
                    status: "success",
                    args: 42,
                    data: "cached",
                    updatedAt: 1000,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        const entry = resource.getEntry(42);
        expect(entry).not.toBeNull();
        const state = entry!.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("cached");
    });

    it("hydration with isStale produces entry in invalidating state with the query in flight", () => {
        const queryFn = vi.fn(async () => "fresh");
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            snapshot,
        });

        const entry = resource.getEntry(99);
        expect(entry).not.toBeNull();
        const state = entry!.state$.peek();
        expect(state.status).toBe("invalidating");
        expect(state.data).toBe("stale-data");
        // "invalidating" must mean an actual query is in flight — otherwise the
        // entry is stuck: invalidate()/retry() are invalid from this state.
        expect(queryFn).toHaveBeenCalledWith(99, expect.any(AbortSignal));
    });

    it("hydration with isStale runs the SWR invalidation and settles to success", async () => {
        const queryFn = vi.fn(async () => "fresh");
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            snapshot,
        });

        await flushMicrotasks();

        const state = resource.getEntry(99)!.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("fresh");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("hydration with isStale settles to invalidate-error when the invalidation fails, keeping stale data", async () => {
        const error = new Error("invalidation failed");
        const queryFn = vi.fn(async () => {
            throw error;
        });
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            snapshot,
        });

        await flushMicrotasks();

        const state = resource.getEntry(99)!.state$.peek();
        expect(state.status).toBe("invalidate-error");
        expect(state.data).toBe("stale-data");
        expect(state.error).toBe(error);
    });

    it("fetch() on a stale-hydrated entry resolves with the invalidated data", { timeout: 1000 }, async () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(99)]: {
                    status: "success",
                    args: 99,
                    data: "stale-data",
                    updatedAt: 1000,
                    isStale: true,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        // fetch() sees "invalidating" and awaits the in-flight query's outcome —
        // it must not hang forever on a hydrated entry.
        await expect(resource.fetch(99)).resolves.toBe("fresh");
    });

    it("hydration skips entries where serialized key doesn't match snapshot key", () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                "wrong-key": {
                    status: "success",
                    args: 42,
                    data: "cached",
                    updatedAt: 1000,
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        const entries = [...resource.getEntries()];
        expect(entries).toEqual([]);
    });
});

// ==================== trigger ====================

describe("Resource.trigger", () => {
    it("creates a new cache entry and starts a query", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        expect(queryFn).toHaveBeenCalledWith(1, expect.any(AbortSignal));

        await flushMicrotasks();
        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("success");
        expect(entry!.state$.peek().data).toBe("data");
    });

    it("returns existing entry without re-fetching on cache hit (doForce=false)", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        await flushMicrotasks();

        resource.trigger(1); // second call, same args
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("forces an invalidation on an existing entry when doForce=true", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        await flushMicrotasks();

        resource.trigger(1, true);
        // queryFn called twice: initial + forced invalidation
        expect(queryFn).toHaveBeenCalledTimes(2);
    });

    it("multiple calls with same args reuse the same QueryCacheEntry instance", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        const entry1 = resource.getEntry(1);

        resource.trigger(1);
        const entry2 = resource.getEntry(1);

        expect(entry1).toBe(entry2);
    });

    it("creates separate entries for different args", async () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        resource.trigger(1);
        resource.trigger(2);

        const entry1 = resource.getEntry(1);
        const entry2 = resource.getEntry(2);

        expect(entry1).not.toBe(entry2);
        expect(entry1).not.toBeNull();
        expect(entry2).not.toBeNull();
    });
});

// ==================== invalidate ====================

describe("Resource.invalidate", () => {
    it("triggers a background SWR invalidation on an existing entry", async () => {
        const calls: string[] = [];
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `data-${callCount}`;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data-1");

        resource.invalidate(1);

        // During the invalidation, the entry transitions to the invalidating state
        // but data is still accessible
        const midInvalidate = entry.state$.peek();
        expect(midInvalidate.status).toBe("invalidating");
        expect(midInvalidate.data).toBe("data-1");

        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data-2");
    });

    it("is a no-op when no cache entry exists for given args", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        // Should not throw
        resource.invalidate(999);

        const entry = resource.getEntry(999);
        expect(entry).toBeNull();
    });
});

// ==================== getEntry ====================

describe("Resource.getEntry", () => {
    it("returns cached entry for known args", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("data");
    });

    it("returns null for unknown args when doInitiate=false", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry = resource.getEntry(42, false);
        expect(entry).toBeNull();
    });

    it("returns null for unknown args by default (doInitiate defaults to false)", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry = resource.getEntry(42);
        expect(entry).toBeNull();
    });

    it("creates and starts entry when doInitiate=true and entry absent", async () => {
        const queryFn = vi.fn(async () => "initiated");
        const resource = createResource<number, string>({ queryFn });

        const entry = resource.getEntry(42, true);
        expect(entry).not.toBeNull();
        expect(queryFn).toHaveBeenCalledWith(42, expect.any(AbortSignal));

        await flushMicrotasks();
        expect(entry!.state$.peek().data).toBe("initiated");
    });

    it("handles void args correctly", async () => {
        const resource = createResource<void, string>({
            queryFn: async () => "void-data",
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("void-data");
    });
});

// ==================== getEntry$ (reactive) ====================

describe("Resource.getEntry$ reactivity", () => {
    it("re-evaluates inside Signal.effect when entry is created", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry$());
        });

        // Initially null (no entry yet)
        expect(results).toEqual([null]);

        resource.trigger(1);
        await flushMicrotasks();

        // Effect should have re-run with the entry present
        expect(results.length).toBeGreaterThanOrEqual(2);
        expect(results[results.length - 1]).not.toBeNull();

        eff.unsubscribe();
    });

    it("re-evaluates inside Signal.compute when entry is created", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const hasEntry$ = Signal.compute(() => {
            const entry$ = resource.getEntry$(1);
            return entry$() !== null;
        });

        // Track via effect to activate the computed
        const values: boolean[] = [];
        const eff = Signal.effect(() => {
            values.push(hasEntry$());
        });

        expect(values).toEqual([false]);

        resource.trigger(1);
        await flushMicrotasks();

        expect(values.length).toBeGreaterThanOrEqual(2);
        expect(values[values.length - 1]).toBe(true);

        eff.unsubscribe();
        hasEntry$.dispose();
    });

    it("re-evaluates inside Signal.effect when entry is completed and removed", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry$());
        });

        // Initially null
        expect(results).toEqual([null]);

        resource.trigger(1);
        await flushMicrotasks();

        expect(results.length).toBeGreaterThanOrEqual(2);
        const entry = results[results.length - 1];
        expect(entry).not.toBeNull();

        // Complete the entry — removes it from cache, status goes back to idle
        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // Effect should have re-run, returning null again
        expect(results.length).toBeGreaterThanOrEqual(3);
        expect(results[results.length - 1]).toBeNull();

        eff.unsubscribe();
    });

    it("getEntry$ for one key is not confused by triggering another key", async () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.trigger(2);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);
        const entry2$ = resource.getEntry$(2);

        const entry1 = entry1$();
        const entry2 = entry2$();

        expect(entry1).not.toBeNull();
        expect(entry2).not.toBeNull();
        expect(entry1).not.toBe(entry2);
        expect(entry1!.state$.peek().data).toBe("data-1");
        expect(entry2!.state$.peek().data).toBe("data-2");
    });

    it("getEntry$ reads as null after entry is removed via complete()", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entry$ = resource.getEntry$(1);
        expect(entry$()).toBeNull();

        resource.trigger(1);
        await flushMicrotasks();

        expect(entry$()).not.toBeNull();
        expect(entry$()!.state$.peek().data).toBe("data");

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(entry$()).toBeNull();
    });

    it("getEntry$ with doInitiate=true creates and starts the entry on read", async () => {
        const queryFn = vi.fn(async () => "initiated");
        const resource = createResource<number, string>({ queryFn });

        const entry$ = resource.getEntry$(42, true);

        // Reading the signal creates the missing entry and starts its query —
        // creation is lazy: it happens on read, not at the getEntry$ call.
        expect(entry$()).not.toBeNull();
        expect(queryFn).toHaveBeenCalledWith(42, expect.any(AbortSignal));

        await flushMicrotasks();
        expect(entry$()!.state$.peek().data).toBe("initiated");
    });

    it("getEntry$ with doInitiate=true is idempotent (reuses the existing entry)", () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const first = resource.getEntry$(1, true)();
        const second = resource.getEntry$(1, true)();

        expect(first).not.toBeNull();
        expect(first).toBe(second);
        expect(first).toBe(resource.getEntry(1));
        // Only one entry created despite two doInitiate calls.
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("getEntry$ with doInitiate=true does not spin a re-creation loop when observed", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const entry$ = resource.getEntry$(1, true);
        const results: (object | null)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry$());
        });

        await flushMicrotasks();

        // Bounded reactivity: initiation is a one-shot side effect, so the query
        // runs exactly once and the effect settles instead of looping forever.
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(results.length).toBeLessThanOrEqual(3);
        expect(results[results.length - 1]).not.toBeNull();

        eff.unsubscribe();
    });

    it("getEntry$ without doInitiate is read-only — reading it creates no entry and starts no query", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        // A different key holds a live entry, so the resource status is "running".
        resource.trigger(2);
        await flushMicrotasks();
        queryFn.mockClear();

        // Reading getEntry$(1) WITHOUT doInitiate must stay a pure observer: no
        // entry for key 1 is created and no query is started, even though the
        // resource is "running" because key 2 exists. This mirrors the sync
        // getEntry(1), which returns null without side effects.
        const e1$ = resource.getEntry$(1);

        expect(e1$()).toBeNull();
        expect(resource.getEntry(1)).toBeNull();
        expect(queryFn).not.toHaveBeenCalled();
    });
});

// ==================== getEntry$ — non-last entry removal (N1 regression) ====================
//
// getEntry$ currently tracks only _status$ and _lastEntry$, while the fallback
// `_cache.get(key)` is non-reactive. Removing a NON-last entry (one that is not
// the most recently created, so it is not _lastEntry$) while the cache still
// holds other entries changes neither signal: _status$ stays "running" and
// _lastEntry$ keeps pointing at the other entry. The observer therefore keeps a
// completed entry. Every test below creates key 2 AFTER key 1 so that key 1 is
// the non-last entry. The removal repros are RED on the current code and GREEN
// once the cache itself becomes reactive.
describe("Resource.getEntry$ — non-last entry removal (N1 regression)", () => {
    it("effect over a NON-last entry re-evaluates to null when that entry is completed", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.trigger(1);
        resource.trigger(2); // key 2 becomes _lastEntry$, so key 1 is the non-last entry
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry1$());
        });

        expect(results[results.length - 1]).not.toBeNull();

        // Cache still holds key 2 → _status$ stays "running" and _lastEntry$ still
        // points at entry 2. The observer must nevertheless drop to null.
        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        expect(results[results.length - 1]).toBeNull();

        eff.unsubscribe();
    });

    it("cold read of a NON-last entry returns null after that entry is completed", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);

        // Prime the cold ComputeCache with the live entry and the signals it tracked.
        expect(entry1$()).toBe(resource.getEntry(1));

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // Neither tracked signal changed, so the memoised (now completed) entry is
        // wrongly returned until the cache is made reactive.
        expect(entry1$()).toBeNull();
    });

    it("cold read of a NON-last entry returns null after retention GC removes it", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async (n: number) => `d-${n}`,
                retentionTime: 5000,
            });

            resource.trigger(1);
            resource.trigger(2);
            await flushMicrotasks();

            const entry1 = resource.getEntry(1)!;
            const entry2 = resource.getEntry(2)!;

            // Hold a live subscription on entry 2 so its retention timer never
            // fires — only entry 1 (the non-last entry) is GC'd below.
            const keepAlive2 = entry2.obs.subscribe();

            const entry1$ = resource.getEntry$(1);
            expect(entry1$()).toBe(entry1); // prime cold cache with the live entry

            // Subscribe + unsubscribe to arm entry 1's retention countdown.
            const sub1 = entry1.obs.subscribe();
            sub1.unsubscribe();

            vi.advanceTimersByTime(5001);
            await flushMicrotasks();

            expect(resource.getEntry(1)).toBeNull(); // sanity: really GC'd
            expect(resource.getEntry(2)).not.toBeNull(); // key 2 kept alive
            expect(entry1$()).toBeNull();

            keepAlive2.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it("doInitiate re-creates a NON-last entry on read after it was removed", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1, true);
        const results: (object | null)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry1$());
        });

        const firstEntry = results[results.length - 1];
        expect(firstEntry).not.toBeNull();

        resource.getEntry(1)!.complete();
        await flushMicrotasks();

        // doInitiate must revive the removed non-last entry on the next read —
        // today the observer never re-runs, so it keeps the completed entry.
        const revived = results[results.length - 1];
        expect(revived).not.toBeNull();
        expect(revived).not.toBe(firstEntry);
        expect(resource.getEntry(1)).toBe(revived);

        eff.unsubscribe();
    });

    // ---- contract guards: define the post-fix behaviour, must stay GREEN ----

    it("an unrelated entry mutation does not spuriously notify a getEntry$ observer", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.trigger(1);
        await flushMicrotasks();

        const entry1$ = resource.getEntry$(1);
        const results: (null | object)[] = [];
        const eff = Signal.effect(() => {
            results.push(entry1$());
        });

        const countAfterInit = results.length;
        expect(results[results.length - 1]).not.toBeNull();

        // Creating an unrelated entry (key 2) must not emit a new value for key 1:
        // the observed entry object is unchanged, so distinctUntilChanged drops it.
        resource.trigger(2);
        await flushMicrotasks();

        expect(results.length).toBe(countAfterInit);

        eff.unsubscribe();
    });

    it("reset() with multiple entries drives every getEntry$ observer to null", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const e1$ = resource.getEntry$(1);
        const e2$ = resource.getEntry$(2);
        const r1: (null | object)[] = [];
        const r2: (null | object)[] = [];
        const eff = Signal.effect(() => {
            r1.push(e1$());
            r2.push(e2$());
        });

        expect(r1[r1.length - 1]).not.toBeNull();
        expect(r2[r2.length - 1]).not.toBeNull();

        resource.reset();
        await flushMicrotasks();

        expect(r1[r1.length - 1]).toBeNull();
        expect(r2[r2.length - 1]).toBeNull();

        eff.unsubscribe();
    });
});

// ==================== serialize / toKeyed ====================

describe("Resource.serialize", () => {
    it("returns deterministic string key", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const key1 = resource.serialize(42);
        const key2 = resource.serialize(42);
        expect(key1).toBe(key2);
    });

    it("produces same key for equivalent args", () => {
        const resource = createResource<{ a: number; b: number }, string>({
            queryFn: async () => "data",
        });

        const key1 = resource.serialize({ a: 1, b: 2 });
        const key2 = resource.serialize({ b: 2, a: 1 });
        expect(key1).toBe(key2);
    });
});

describe("Resource.toKeyed", () => {
    it("returns { value, key } wrapper", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const keyed = resource.toKeyed(42);
        expect(keyed.value).toBe(42);
        expect(keyed.key).toBe(resource.serialize(42));
    });
});

// ==================== bind ====================

describe("Resource.bind", () => {
    it("returns an inert { kind, resource, args } descriptor", () => {
        const queryFn = vi.fn(async (n: number) => `data-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const bound = resource.bind(42);

        expect(bound).toEqual({ kind: "resource", resource, args: 42 });
        // bind must not execute the query
        expect(queryFn).not.toHaveBeenCalled();
        expect([...resource.getEntries()]).toEqual([]);
    });

    it("preserves TKeyed args as-is", () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        const keyed = resource.toKeyed(7);
        const bound = resource.bind(keyed);

        expect(bound.args).toBe(keyed);
    });

    it("descriptor can be replayed via resource.trigger", async () => {
        const queryFn = vi.fn(async (n: number) => `data-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const bound = resource.bind(99);
        bound.resource.trigger(bound.args);
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalledWith(99, expect.anything());
        const entry = resource.getEntry(99);
        expect(entry!.state$.peek().data).toBe("data-99");
    });
});

// ==================== getEntries ====================

describe("Resource.getEntries", () => {
    it("returns empty iterator when cache is empty", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const entries = [...resource.getEntries()];
        expect(entries).toEqual([]);
    });

    it("yields all active cache entries", async () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        resource.trigger(1);
        resource.trigger(2);
        resource.trigger(3);

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(3);
    });
});

// ==================== reset ====================

describe("Resource.reset", () => {
    it("clears all cache entries and sets status to idle", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        expect([...resource.getEntries()]).toHaveLength(2);

        resource.reset();
        expect([...resource.getEntries()]).toHaveLength(0);
    });

    it("after reset, getEntry returns null", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.reset();
        expect(resource.getEntry(1)).toBeNull();
    });

    it("after reset, new triggers create fresh entries", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `data-${callCount}`;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.reset();

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("data-2");
    });
});

// ==================== createClutch ====================

describe("Resource.createClutch", () => {
    it("returns a ResourceClutch instance", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const clutch = resource.createClutch();
        expect(clutch).toBeDefined();
        expect(typeof clutch.start).toBe("function");
        expect(typeof clutch.switch).toBe("function");
        expect(typeof clutch.retry).toBe("function");
        expect(typeof clutch.invalidate).toBe("function");
        expect(typeof clutch.state$).toBe("function");
    });
});

// ==================== SWR (Stale-While-Revalidate) ====================

describe("SWR scenarios", () => {
    it("trigger with doForce=true serves stale data during background re-fetch", async () => {
        let callCount = 0;
        let resolveQuery!: (val: string) => void;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "stale";
                return new Promise((r) => {
                    resolveQuery = r;
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().data).toBe("stale");

        // Force re-fetch
        resource.trigger(1, true);

        // Entry should be in invalidating state with stale data still accessible
        const entry = resource.getEntry(1)!;
        const mid = entry.state$.peek();
        expect(mid.status).toBe("invalidating");
        expect(mid.data).toBe("stale");

        // Resolve the invalidation
        resolveQuery("fresh");
        await flushMicrotasks();
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("fresh");
    });

    it("during an invalidation, getEntry still returns the entry with old data", async () => {
        let callCount = 0;
        let resolveQuery!: (val: string) => void;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "original";
                return new Promise((r) => {
                    resolveQuery = r;
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("invalidating");
        expect(entry!.state$.peek().data).toBe("original");

        resolveQuery("updated");
        await flushMicrotasks();
    });

    it("invalidate → success transition preserves entry identity", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entryBefore = resource.getEntry(1);
        resource.invalidate(1);
        await flushMicrotasks();
        const entryAfter = resource.getEntry(1);

        expect(entryBefore).toBe(entryAfter);
    });
});

// ==================== Entry State Interactions ====================

describe("entry state interactions", () => {
    it("new entry starts in pending state", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise(() => {}), // never resolves
        });

        resource.trigger(1);
        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("pending");
    });

    it("successful fetch → success state", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "ok",
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");
    });

    it("failed fetch → error state", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("fail");
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");
        expect(entry.state$.peek().error).toBeInstanceOf(Error);
    });

    it("invalidate() transitions through invalidating state", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidating");

        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
    });

    it("hydrated snapshot creates entry in success state", () => {
        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(1)]: {
                    status: "success",
                    args: 1,
                    data: "snapshot-data",
                    updatedAt: Date.now(),
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn: async () => "fresh",
            snapshot,
        });

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().status).toBe("success");
        expect(entry!.state$.peek().data).toBe("snapshot-data");
    });

    it("error → retry → success flow", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");

        entry.retry();
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
    });
});

// ==================== Lifecycle: onCacheEntryAdded ====================

describe("onCacheEntryAdded lifecycle", () => {
    it("fires after entry is registered", async () => {
        const addedArgs: number[] = [];

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: (args, ctx) => {
                addedArgs.push(args);
                expect(ctx.entry).not.toBeNull();
            },
        });

        resource.trigger(1);
        expect(addedArgs).toEqual([1]);
    });

    it("$cacheDataLoaded resolves on first success", async () => {
        let loadedData: string | undefined;

        const resource = createResource<number, string>({
            queryFn: async () => "loaded",
            onCacheEntryAdded: async (_args, ctx) => {
                loadedData = await ctx.$cacheDataLoaded;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(loadedData).toBe("loaded");
    });

    it("$cacheDataLoaded rejects with CacheEntryRemovedError if removed before success", async () => {
        let rejectedError: unknown;
        let resolveQuery!: (val: string) => void;

        const resource = createResource<number, string>({
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
            onCacheEntryAdded: async (_args, ctx) => {
                try {
                    await ctx.$cacheDataLoaded;
                } catch (err) {
                    rejectedError = err;
                }
            },
        });

        resource.trigger(1);
        const entry = resource.getEntry(1)!;

        // Complete the entry before queryFn resolves (simulating removal)
        entry.complete();
        await flushMicrotasks();

        expect(rejectedError).toBeInstanceOf(CacheEntryRemovedError);
    });

    it("$cacheEntryRemoved resolves when entry completes", async () => {
        let removed = false;

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: async (_args, ctx) => {
                ctx.$cacheEntryRemoved.then(() => {
                    removed = true;
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        entry.complete();
        await flushMicrotasks();

        expect(removed).toBe(true);
    });

    it("errors in onCacheEntryAdded callback are suppressed", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: () => {
                throw new Error("callback error");
            },
        });

        // Should not throw
        resource.trigger(1);
        await flushMicrotasks();

        // Entry should still be created
        expect(resource.getEntry(1)).not.toBeNull();
    });
});

// ==================== Lifecycle: onQueryStarted ====================

describe("onQueryStarted lifecycle", () => {
    it("fires on each query execution", async () => {
        const startedArgs: number[] = [];

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onQueryStarted: (args) => {
                startedArgs.push(args);
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(startedArgs).toEqual([1]);
    });

    it("fires again on an invalidation", async () => {
        const startedArgs: number[] = [];

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onQueryStarted: (args) => {
                startedArgs.push(args);
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();

        expect(startedArgs).toEqual([1, 1]);
    });

    it("$queryFulfilled resolves with { data }", async () => {
        let fulfilledData: { data: string } | undefined;

        const resource = createResource<number, string>({
            queryFn: async () => "result",
            onQueryStarted: async (_args, ctx) => {
                fulfilledData = await ctx.$queryFulfilled;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(fulfilledData).toEqual({ data: "result" });
    });

    it("errors in onQueryStarted callback are suppressed", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onQueryStarted: () => {
                throw new Error("callback error");
            },
        });

        // Should not throw
        resource.trigger(1);
        await flushMicrotasks();

        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });
});

// ==================== beforeQuery (Cross-Tab Sync) ====================

describe("beforeQuery (cross-tab sync)", () => {
    it("uses data returned by beforeQuery without calling queryFn", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => ({ data: "from-tab" as string }));

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(beforeQuery).toHaveBeenCalledWith("res", stableStringify(1));
        expect(queryFn).not.toHaveBeenCalled();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("from-tab");
    });

    it("falls back to queryFn when beforeQuery returns null", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => null);

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(beforeQuery).toHaveBeenCalled();
        expect(queryFn).toHaveBeenCalled();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("from-query");
    });

    it("falls back to queryFn when beforeQuery throws", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => {
            throw new Error("sync error");
        });

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
        });

        resource.trigger(1);
        // beforeQuery rejects → catch calls _execute → queryFn resolves
        await flushMicrotasks();
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalled();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("from-query");
    });

    it("is skipped when key is not set", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => ({ data: "from-tab" as string }));

        const resource = createResource<number, string>({
            queryFn,
            // no key
            beforeQuery,
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(beforeQuery).not.toHaveBeenCalled();
        expect(queryFn).toHaveBeenCalled();
    });

    it("is skipped for hydrated entries (snapshot)", async () => {
        const queryFn = vi.fn(async () => "from-query");
        const beforeQuery = vi.fn(async () => ({ data: "from-tab" as string }));

        const snapshot: TResourceSnapshot = {
            entries: {
                [stableStringify(1)]: {
                    status: "success",
                    args: 1,
                    data: "hydrated",
                    updatedAt: Date.now(),
                },
            },
        };

        const resource = createResource<number, string>({
            queryFn,
            key: "res",
            beforeQuery,
            snapshot,
        });

        expect(beforeQuery).not.toHaveBeenCalled();
        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().data).toBe("hydrated");
    });

    it("entry removed while beforeQuery is in flight — null result does not re-execute", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const queryFn = vi.fn(async () => "from-query");
            let resolveBeforeQuery!: (result: { data: string } | null) => void;
            const beforeQuery = vi.fn(
                () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        resolveBeforeQuery = resolve;
                    }),
            );

            const resource = createResource<number, string>({
                queryFn,
                key: "res",
                beforeQuery,
            });

            resource.trigger(1);
            resource.reset(); // completes the entry while beforeQuery is still pending

            resolveBeforeQuery(null);
            await flushUnhandledRejections();

            expect(queryFn).not.toHaveBeenCalled();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("entry removed while beforeQuery is in flight — late data is discarded", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const queryFn = vi.fn(async () => "from-query");
            let resolveBeforeQuery!: (result: { data: string } | null) => void;
            const beforeQuery = vi.fn(
                () =>
                    new Promise<{ data: string } | null>((resolve) => {
                        resolveBeforeQuery = resolve;
                    }),
            );

            const resource = createResource<number, string>({
                queryFn,
                key: "res",
                beforeQuery,
            });

            resource.trigger(1);
            resource.reset();

            resolveBeforeQuery({ data: "from-tab" });
            await flushUnhandledRejections();

            expect(resource.getEntry(1)).toBeNull();
            expect(queryFn).not.toHaveBeenCalled();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("entry removed while beforeQuery is in flight — rejection does not re-execute", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const queryFn = vi.fn(async () => "from-query");
            let rejectBeforeQuery!: (error: unknown) => void;
            const beforeQuery = vi.fn(
                () =>
                    new Promise<{ data: string } | null>((_resolve, reject) => {
                        rejectBeforeQuery = reject;
                    }),
            );

            const resource = createResource<number, string>({
                queryFn,
                key: "res",
                beforeQuery,
            });

            resource.trigger(1);
            resource.reset();

            rejectBeforeQuery(new Error("channel closed"));
            await flushUnhandledRejections();

            expect(queryFn).not.toHaveBeenCalled();
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });
});

// ==================== Concurrent triggers ====================

describe("Concurrent triggers", () => {
    it("concurrent triggers with same args return same entry", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise(() => {}), // never resolves
        });

        resource.trigger(1);
        resource.trigger(1);
        resource.trigger(1);

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(1);
    });

    it("concurrent triggers with different args create separate entries", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise(() => {}),
        });

        resource.trigger(1);
        resource.trigger(2);
        resource.trigger(3);

        const entries = [...resource.getEntries()];
        expect(entries).toHaveLength(3);
    });
});

// ==================== Cache entry completion / cleanup ====================

describe("Cache entry completion", () => {
    it("entry removed from cache after completion", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        entry.complete();
        await flushMicrotasks();

        expect(resource.getEntry(1)).toBeNull();
        expect([...resource.getEntries()]).toHaveLength(0);
    });

    it("completing all entries transitions status back to idle", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const entry1 = resource.getEntry(1)!;
        const entry2 = resource.getEntry(2)!;

        entry1.complete();
        await flushMicrotasks();

        // Still one entry left — getEntry$ with doInitiate=false should still work
        expect([...resource.getEntries()]).toHaveLength(1);

        entry2.complete();
        await flushMicrotasks();

        expect([...resource.getEntries()]).toHaveLength(0);
    });

    it("after entry completion, new trigger for same args creates fresh entry", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry1 = resource.getEntry(1)!;
        expect(entry1.state$.peek().data).toBe("v1");

        entry1.complete();
        await flushMicrotasks();

        resource.trigger(1);
        await flushMicrotasks();

        const entry2 = resource.getEntry(1)!;
        expect(entry2).not.toBe(entry1);
        expect(entry2.state$.peek().data).toBe("v2");
    });
});

// ==================== Error flows ====================

describe("Error flows", () => {
    it("queryFn rejection preserves the error object", async () => {
        const cause = new Error("network failure");
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw cause;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");
        expect(entry.state$.peek().error).toBe(cause);
    });

    it("queryFn rejection with non-Error value still transitions to error", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw "string-error";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");
        expect(entry.state$.peek().error).toBe("string-error");
    });

    it("a failed invalidation transitions to invalidate-error, preserving old data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "good-data";
                throw new Error("invalidation failed");
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");

        resource.invalidate(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");
        expect(entry.state$.peek().data).toBe("good-data");
        expect(entry.state$.peek().error).toBeInstanceOf(Error);
    });

    it("retry after invalidate-error triggers a new fetch via invalidate()", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                if (callCount === 2) throw new Error("invalidation failed");
                return "recovered";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");

        // invalidate-error allows invalidate() again
        entry.invalidate();
        expect(entry.state$.peek()).toMatchObject({ status: "invalidating", error: null });
        await flushMicrotasks();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
    });

    it("retry() after invalidate-error re-fetches as a retrying invalidation, keeping the data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                if (callCount === 2) throw new Error("invalidation failed");
                return "recovered";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");

        const failure = entry.state$.peek().error;
        entry.retry();
        // A retry in flight is the entry holding the failure it retries.
        expect(entry.state$.peek()).toMatchObject({
            status: "invalidating",
            data: "initial",
            error: failure,
        });
        // Matrix row 12 at the entry level.
        expect(resource.getState(1)).toMatchObject({
            status: "pending",
            dataSource: "current",
            data: "initial",
            isInvalidating: true,
            hasData: true,
            hasError: true,
            error: failure,
        });

        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
        expect(callCount).toBe(3);
    });

    it("multiple sequential errors still allow retry", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount <= 2) throw new Error(`fail-${callCount}`);
                return "finally";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");
        expect(resource.getEntry(1)!.state$.peek().data).toBe("finally");
    });
});

// ==================== Retention time / GC ====================

describe("Retention time / GC", () => {
    it("entry is auto-removed after retention time when all subscribers unsubscribe", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime: 5000,
            });

            resource.trigger(1);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            // Subscribe to the observable (simulates a component subscribing)
            const sub = entry.obs.subscribe();
            expect(resource.getEntry(1)).not.toBeNull();

            // Unsubscribe — starts retention countdown
            sub.unsubscribe();

            // Before retention expires, entry still exists
            vi.advanceTimersByTime(4999);
            expect(resource.getEntry(1)).not.toBeNull();

            // After retention expires, entry should be cleaned up
            vi.advanceTimersByTime(2);
            await flushMicrotasks();

            expect(resource.getEntry(1)).toBeNull();
            expect([...resource.getEntries()]).toHaveLength(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it("re-subscribing before retention expires prevents GC", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime: 5000,
            });

            resource.trigger(1);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            const sub1 = entry.obs.subscribe();
            sub1.unsubscribe();

            // Advance partway through retention
            vi.advanceTimersByTime(3000);
            expect(resource.getEntry(1)).not.toBeNull();

            // Re-subscribe before expiry
            const sub2 = entry.obs.subscribe();
            vi.advanceTimersByTime(5000);
            await flushMicrotasks();

            // Entry should still exist because we re-subscribed
            expect(resource.getEntry(1)).not.toBeNull();

            sub2.unsubscribe();
        } finally {
            vi.useRealTimers();
        }
    });

    it("retentionTime: false prevents auto-removal", async () => {
        vi.useFakeTimers();
        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                retentionTime: false,
            });

            resource.trigger(1);
            await flushMicrotasks();

            const entry = resource.getEntry(1)!;
            const sub = entry.obs.subscribe();
            sub.unsubscribe();

            vi.advanceTimersByTime(60_000);
            await flushMicrotasks();

            // Entry should still exist — no retention GC
            expect(resource.getEntry(1)).not.toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

// ==================== Lifecycle hooks error paths ====================

describe("Lifecycle hooks error paths", () => {
    it("$queryFulfilled rejects when queryFn fails", async () => {
        let rejection: unknown;

        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
            onQueryStarted: async (_args: number, ctx) => {
                try {
                    await ctx.$queryFulfilled;
                } catch (err) {
                    rejection = err;
                }
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(rejection).toBeInstanceOf(Error);
        expect((rejection as Error).message).toBe("boom");
    });

    it("$cacheDataLoaded resolves even when first query fails then retry succeeds", async () => {
        let loadedData: string | undefined;
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("initial fail");
                return "recovered";
            },
            onCacheEntryAdded: async (_args, ctx) => {
                loadedData = await ctx.$cacheDataLoaded;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(loadedData).toBeUndefined();

        // Retry should resolve $cacheDataLoaded
        resource.getEntry(1)!.retry();
        await flushMicrotasks();

        expect(loadedData).toBe("recovered");
    });

    it("async onCacheEntryAdded rejection is an unhandled promise (sync catch only)", async () => {
        // _fireOnCacheEntryAdded uses try/catch which only catches sync throws.
        // An async callback that rejects produces an unhandled rejection.
        // This test documents that sync errors ARE suppressed:
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onCacheEntryAdded: () => {
                throw new Error("sync lifecycle error");
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.state$.peek().data).toBe("data");
    });

    it("async onCacheEntryAdded rejection is suppressed", async () => {
        const unhandled: unknown[] = [];
        const handler = (reason: unknown) => {
            unhandled.push(reason);
        };
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        const proc = (globalThis as Record<string, unknown>)["process"] as {
            on(event: string, listener: (...args: unknown[]) => void): void;
            off(event: string, listener: (...args: unknown[]) => void): void;
        };
        proc.on("unhandledRejection", handler);

        try {
            const resource = createResource<number, string>({
                queryFn: async () => "data",
                onCacheEntryAdded: async () => {
                    throw new Error("boom");
                },
            });

            resource.trigger(1);
            await flushMicrotasks();

            // Entry should still be created and queryFn should resolve normally
            const entry = resource.getEntry(1);
            expect(entry).not.toBeNull();
            expect(entry!.state$.peek().data).toBe("data");

            // No unhandled rejection should have been captured
            expect(unhandled).toEqual([]);
        } finally {
            proc.off("unhandledRejection", handler);
        }
    });

    it("failed query does not produce an unhandled rejection when onQueryStarted ignores $queryFulfilled", async () => {
        const tracker = await trackUnhandledRejections();

        try {
            const resource = createResource<number, string>({
                queryFn: async () => {
                    throw new Error("query failed");
                },
                onQueryStarted: () => {
                    /* does not consume ctx.$queryFulfilled */
                },
            });

            resource.trigger(1);
            await flushUnhandledRejections();

            expect(resource.getEntry(1)!.state$.peek().status).toBe("error");
            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("onQueryStarted receives updated context on an invalidation", async () => {
        const fulfillments: Array<{ data: string }> = [];
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
            onQueryStarted: async (_args: number, ctx) => {
                const result = await ctx.$queryFulfilled;
                fulfillments.push(result);
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();

        expect(fulfillments).toEqual([{ data: "v1" }, { data: "v2" }]);
    });
});

// ==================== Concurrent trigger abort/cancel ====================

describe("Concurrent trigger abort/cancel", () => {
    it("doForce on pending entry is a no-op (invalidate() is invalid from pending)", async () => {
        const queryFn = vi.fn(() => new Promise<string>(() => {})); // never resolves

        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        expect(queryFn).toHaveBeenCalledTimes(1);

        // doForce calls existing.invalidate(), but invalidate() is invalid from pending
        resource.trigger(1, true);
        // queryFn should NOT be called again — invalidate() was a no-op
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("each execution receives a distinct AbortSignal", async () => {
        const signals: AbortSignal[] = [];
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async (_args: number, signal: AbortSignal) => {
                signals.push(signal);
                return `v${++callCount}`;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();

        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
    });

    it("invalidate() from success aborts the previous controller and starts a new query", async () => {
        let callCount = 0;
        let resolvers: Array<(val: string) => void> = [];

        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                return new Promise<string>((r) => {
                    resolvers.push(r);
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("success");

        // Start the invalidation → entry goes to invalidating, _execute creates new AbortController
        resource.invalidate(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        // Resolve the invalidation
        resolvers[0]!("invalidated");
        await flushMicrotasks();
        await flushMicrotasks();

        expect(resource.getEntry(1)!.state$.peek().data).toBe("invalidated");
    });

    it("reset while query is in-flight clears cache; late resolve is ignored", async () => {
        let resolveQuery!: (val: string) => void;

        const resource = createResource<number, string>({
            queryFn: () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        });

        resource.trigger(1);
        // Query is in-flight
        expect(resource.getEntry(1)).not.toBeNull();

        resource.reset();
        expect(resource.getEntry(1)).toBeNull();

        // Late resolve should not crash or re-add entry
        resolveQuery("late-data");
        await flushMicrotasks();

        expect(resource.getEntry(1)).toBeNull();
    });

    it("reset while an invalidation is in flight clears cache", async () => {
        let callCount = 0;
        let resolveInvalidate!: (val: string) => void;

        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                return new Promise<string>((r) => {
                    resolveInvalidate = r;
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        resource.reset();
        expect(resource.getEntry(1)).toBeNull();

        // Late resolve of the invalidation should not crash or re-add entry
        resolveInvalidate("late-invalidate");
        await flushMicrotasks();

        expect(resource.getEntry(1)).toBeNull();
    });

    it("retry after error starts new query with fresh AbortSignal", async () => {
        const signals: AbortSignal[] = [];
        let callCount = 0;

        const resource = createResource<number, string>({
            queryFn: async (_args: number, signal: AbortSignal) => {
                signals.push(signal);
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();

        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("recovered");
    });
});

// ==================== createPatch edge cases ====================

describe("QueryCacheEntry.createPatch edge cases", () => {
    type Data = { name: string };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peek = (e: any) => e.state$.peek() as any;

    function createSuccessEntry() {
        const resource = createResource<number, Data>({
            queryFn: async () => ({ name: "Alice" }),
        });
        resource.trigger(1);
        return { resource, entry: () => resource.getEntry(1)! };
    }

    it("double-commit is a no-op", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const handle = e.createPatch((d: Data) => {
            d.name = "Bob";
        })!;
        expect(handle).not.toBeNull();

        handle.commit();
        const stateAfterFirstCommit = e.state$.peek();

        handle.commit();
        const stateAfterSecondCommit = e.state$.peek();

        expect(stateAfterSecondCommit).toBe(stateAfterFirstCommit);
    });

    it("abort after commit is a no-op", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const handle = e.createPatch((d: Data) => {
            d.name = "Bob";
        })!;

        handle.commit();
        const stateAfterCommit = e.state$.peek();

        handle.abort();
        const stateAfterAbort = e.state$.peek();

        expect(stateAfterAbort).toBe(stateAfterCommit);
    });

    it("commit after abort is a no-op", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const handle = e.createPatch((d: Data) => {
            d.name = "Bob";
        })!;

        handle.abort();
        const stateAfterAbort = e.state$.peek();

        handle.commit();
        const stateAfterCommit = e.state$.peek();

        expect(stateAfterCommit).toBe(stateAfterAbort);
    });

    it("returns null on pending entry", () => {
        const resource = createResource<number, Data>({
            queryFn: () => new Promise(() => {}), // never resolves — stays pending
        });
        resource.trigger(1);

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("pending");

        const handle = entry.createPatch((d: Data) => {
            d.name = "Bob";
        });
        expect(handle).toBeNull();
    });

    it("returns null on error entry", async () => {
        const resource = createResource<number, Data>({
            queryFn: async () => {
                throw new Error("fail");
            },
        });
        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");

        const handle = entry.createPatch((d: Data) => {
            d.name = "Bob";
        });
        expect(handle).toBeNull();
    });

    it("immediate abort after createPatch reverts data", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();
        const original = peek(e).data;
        expect(original).toEqual({ name: "Alice" });

        const handle = e.createPatch((d: Data) => {
            d.name = "Patched";
        })!;
        expect(peek(e).data).toEqual({ name: "Patched" });

        handle.abort();
        expect(peek(e).data).toEqual({ name: "Alice" });
    });

    it("two patches: abort second, then commit first", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "Patch1";
        })!;
        expect(peek(e).data).toEqual({ name: "Patch1" });

        const h2 = e.createPatch((d: Data) => {
            d.name = "Patch2";
        })!;
        expect(peek(e).data).toEqual({ name: "Patch2" });

        h2.abort();
        expect(peek(e).data).toEqual({ name: "Patch1" });

        h1.commit();
        expect(peek(e).data).toEqual({ name: "Patch1" });
        expect(peek(e).patchState).toBeNull();
    });

    it("two patches: commit first, then abort second", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "Patch1";
        })!;
        const h2 = e.createPatch((d: Data) => {
            d.name = "Patch2";
        })!;
        expect(peek(e).data).toEqual({ name: "Patch2" });

        h1.commit();
        // h1 committed but h2 still pending — data still shows both patches applied
        expect(peek(e).data).toEqual({ name: "Patch2" });

        h2.abort();
        // h2 aborted — data should show only h1's change
        expect(peek(e).data).toEqual({ name: "Patch1" });
        expect(peek(e).patchState).toBeNull();
    });

    it("two patches: abort both in reverse order", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "Patch1";
        })!;
        const h2 = e.createPatch((d: Data) => {
            d.name = "Patch2";
        })!;

        h2.abort();
        expect(peek(e).data).toEqual({ name: "Patch1" });

        h1.abort();
        expect(peek(e).data).toEqual({ name: "Alice" });
        expect(peek(e).patchState).toBeNull();
    });

    it("three patches: mixed commit/abort order", async () => {
        const { entry } = createSuccessEntry();
        await flushMicrotasks();

        const e = entry();

        const h1 = e.createPatch((d: Data) => {
            d.name = "A";
        })!;
        const h2 = e.createPatch((d: Data) => {
            d.name = "B";
        })!;
        const h3 = e.createPatch((d: Data) => {
            d.name = "C";
        })!;
        expect(peek(e).data).toEqual({ name: "C" });

        h2.abort();
        // pending#1, aborted#2, pending#3 → replay: #1 applies, #2 skipped, #3 applies
        expect(peek(e).data).toEqual({ name: "C" });

        h1.commit();
        // committed#1, aborted#2, pending#3 → #1 folded, #3 replayed
        expect(peek(e).data).toEqual({ name: "C" });

        h3.commit();
        // all settled → data finalized
        expect(peek(e).data).toEqual({ name: "C" });
        expect(peek(e).patchState).toBeNull();
    });

    it("consistency violation triggers an automatic invalidation", async () => {
        type Items = { items: { id: number; name: string }[] };
        let fetchCount = 0;
        const resource = createResource<void, Items>({
            queryFn: async () => {
                fetchCount++;
                return { items: [{ id: 1, name: `v${fetchCount}` }] };
            },
        });

        resource.trigger();
        await flushMicrotasks();
        expect(fetchCount).toBe(1);

        const entry = resource.getEntry()!;

        // Patch 1: add item at index 1
        const h1 = entry.createPatch((d: Items) => {
            d.items.push({ id: 2, name: "added" });
        })!;

        // Patch 2: modify item at index 1 (depends on patch 1 existing)
        const h2 = entry.createPatch((d: Items) => {
            d.items[1]!.name = "modified";
        })!;

        // Abort patch 1 → patch 2's forward patches reference items[1] which won't exist
        // This should trigger consistency violation + automatic invalidation
        h1.abort();

        // After consistency violation, the automatic invalidation kicks in
        // The entry should now be in invalidating state with fetchCount about to increment
        await flushMicrotasks();

        // The automatic invalidation should have re-fetched
        expect(fetchCount).toBe(2);

        // Commit patch 2 handle (already aborted via violation cleanup, should be no-op)
        h2.commit();
    });
});

// ==================== Edge Cases (MEDIUM priority) ====================

describe("Resource — retry() on non-error state is no-op", () => {
    it("retry() on success state does not re-query or change state", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");
        expect(queryFn).toHaveBeenCalledTimes(1);

        entry.retry();

        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });
});

describe("Resource — multi-key invalidation isolation", () => {
    it("invalidating key=1 does not affect key=2 success state", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async (n: number) => {
                callCount++;
                return `data-${n}-call${callCount}`;
            },
        });

        resource.trigger(1);
        resource.trigger(2);
        await flushMicrotasks();

        const entry1 = resource.getEntry(1)!;
        const entry2 = resource.getEntry(2)!;
        expect(entry1.state$.peek().status).toBe("success");
        expect(entry2.state$.peek().status).toBe("success");

        const entry2DataBefore = entry2.state$.peek().data;

        resource.invalidate(1);
        await flushMicrotasks();

        // key=2 remains unchanged
        expect(entry2.state$.peek().status).toBe("success");
        expect(entry2.state$.peek().data).toBe(entry2DataBefore);

        // key=1 was invalidated
        expect(entry1.state$.peek().status).toBe("success");
        expect(entry1.state$.peek().data).not.toBe("data-1-call1");
    });
});

describe("CacheEntry — set after complete() is ignored", () => {
    it("set() after complete() does not change state", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("success");

        // Capture the state value via peek() before complete
        const dataBefore = entry.state$.peek().data;

        entry.complete();

        // Attempt to set after complete — CacheEntry._isCompleted guards this
        entry.set(pendingEntryState<number>(1));

        // peek() on the underlying state should still return the last value
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toBe(dataBefore);
    });
});

// ==================== ensure ====================

describe("Resource.ensure", () => {
    it("creates a cold entry and resolves with its first loaded data", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const data = await resource.ensure(1);

        expect(data).toBe("data");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("returns cached data immediately without re-fetching on a cache hit", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        await flushMicrotasks();

        const data = await resource.ensure(1);
        expect(data).toBe("data");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("awaits an in-flight query rather than starting a new one", async () => {
        let resolveQuery!: (v: string) => void;
        const queryFn = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        );
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        const p = resource.ensure(1);
        expect(queryFn).toHaveBeenCalledTimes(1);

        resolveQuery("data");
        expect(await p).toBe("data");
    });

    it("resolves immediately with stale data while an invalidation is in flight", async () => {
        let resolveInvalidate!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "v1";
                return new Promise<string>((r) => {
                    resolveInvalidate = r;
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        // ensure hands back the stale value without waiting for the invalidation
        expect(await resource.ensure(1)).toBe("v1");

        resolveInvalidate("v2");
        await flushMicrotasks();
    });

    it("rejects when the cold query fails", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        await expect(resource.ensure(1)).rejects.toThrow("boom");
    });

    it("retries a previously failed entry and resolves on success", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        const data = await resource.ensure(1);
        expect(data).toBe("recovered");
        expect(callCount).toBe(2);
    });

    it("handles void args", async () => {
        const resource = createResource<void, string>({
            queryFn: async () => "void-data",
        });

        expect(await resource.ensure(undefined as void)).toBe("void-data");
    });

    it("rejects (does not synchronously throw) when serializeArgs throws", async () => {
        const error = new Error("serialize boom");
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            serializeArgs: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.ensure(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });
});

// ==================== fetch ====================

describe("Resource.fetch", () => {
    it("creates a cold entry and resolves with fresh data", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        expect(await resource.fetch(1)).toBe("data");
    });

    it("on a cached entry resolves with fresh data, not the stale cached value", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        expect(await resource.ensure(1)).toBe("v1");
        expect(await resource.fetch(1)).toBe("v2");
        expect(callCount).toBe(2);
    });

    it("dedups against an in-flight query instead of starting another", async () => {
        let resolveQuery!: (v: string) => void;
        const queryFn = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        );
        const resource = createResource<number, string>({ queryFn });

        const p1 = resource.fetch(1);
        const p2 = resource.fetch(1);
        expect(queryFn).toHaveBeenCalledTimes(1);

        resolveQuery("data");
        expect(await p1).toBe("data");
        expect(await p2).toBe("data");
    });

    it("rejects when an invalidation fails, leaving stale data in the cache", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "v1";
                throw new Error("invalidation failed");
            },
        });

        expect(await resource.ensure(1)).toBe("v1");
        await expect(resource.fetch(1)).rejects.toThrow("invalidation failed");

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("invalidate-error");
        expect(entry.state$.peek().data).toBe("v1");
    });

    it("retries a previously failed entry", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        expect(await resource.fetch(1)).toBe("recovered");
    });

    it("rejects when the cold query fails", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        await expect(resource.fetch(1)).rejects.toThrow("boom");
    });

    it("rejects (does not synchronously throw) when serializeArgs throws", async () => {
        const error = new Error("serialize boom");
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            serializeArgs: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.fetch(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });
});

// ==================== prefetch ====================

describe("Resource.prefetch", () => {
    it("warms the cache and resolves with void", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const result = await resource.prefetch(1);

        expect(result).toBeUndefined();
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });

    it("never rejects when the query fails", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });

        await expect(resource.prefetch(1)).resolves.toBeUndefined();
    });

    it("reuses cached data without re-fetching", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        await flushMicrotasks();

        await resource.prefetch(1);
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("creates the entry synchronously, before the promise settles", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });

        void resource.prefetch(1);

        expect(resource.getEntry(1)).not.toBeNull();
    });

    it("force: invalidates an existing entry with fresh data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        await resource.prefetch(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("v1");

        await resource.prefetch(1, { force: true });
        expect(callCount).toBe(2);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("v2");
    });

    it("force: creates and loads a cold entry", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        await resource.prefetch(1, { force: true });

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });

    it("force: retries a previously failed entry and still never rejects", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                throw new Error(`fail-${callCount}`);
            },
        });

        await resource.prefetch(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("error");

        await expect(resource.prefetch(1, { force: true })).resolves.toBeUndefined();
        expect(callCount).toBe(2);
    });

    it("force: awaits an in-flight query instead of starting another", async () => {
        let resolveQuery!: (v: string) => void;
        const queryFn = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolveQuery = r;
                }),
        );
        const resource = createResource<number, string>({ queryFn });

        void resource.prefetch(1);
        const p = resource.prefetch(1, { force: true });
        expect(queryFn).toHaveBeenCalledTimes(1);

        resolveQuery("data");
        await p;

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data");
    });

    it("force: invalidates an invalidate-error entry with fresh data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 2) throw new Error("invalidation failed");
                return `v${callCount}`;
            },
        });

        await resource.ensure(1); // v1
        await resource.fetch(1).catch(() => {}); // invalidate fails → invalidate-error
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidate-error");

        await resource.prefetch(1, { force: true });

        const state = resource.getEntry(1)!.state$.peek();
        expect(state.status).toBe("success");
        expect(state.data).toBe("v3");
    });

    it("never rejects (and does not synchronously throw) when serializeArgs throws", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
            serializeArgs: () => {
                throw new Error("serialize boom");
            },
        });

        let promise!: Promise<void>;
        expect(() => {
            promise = resource.prefetch(1);
        }).not.toThrow();

        await expect(promise).resolves.toBeUndefined();
    });
});

// ==================== Abort semantics ====================

describe("ensure/fetch abort semantics", () => {
    it("rejects immediately without starting a query when the signal is already aborted", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        const ac = new AbortController();
        ac.abort();

        await expect(resource.ensure(1, { signal: ac.signal })).rejects.toHaveProperty("name", "AbortError");
        expect(queryFn).not.toHaveBeenCalled();
        expect(resource.getEntry(1)).toBeNull();
    });

    it("rejects with the signal's reason when aborted mid-flight", async () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        const ac = new AbortController();
        const reason = new Error("navigation cancelled");
        const p = resource.ensure(1, { signal: ac.signal });
        p.catch(() => {});

        ac.abort(reason);
        await expect(p).rejects.toBe(reason);
    });

    it("aborting one caller does not cancel a query another consumer is awaiting", async () => {
        let resolveQuery!: (v: string) => void;
        let capturedSignal: AbortSignal | undefined;
        const resource = createResource<number, string>({
            queryFn: (_args, signal) => {
                capturedSignal = signal;
                return new Promise<string>((r) => {
                    resolveQuery = r;
                });
            },
            retentionTime: false,
        });

        const ac = new AbortController();
        const p1 = resource.ensure(1, { signal: ac.signal });
        const p2 = resource.ensure(1);
        p1.catch(() => {});

        ac.abort();
        await expect(p1).rejects.toHaveProperty("name", "AbortError");

        // The shared in-flight query is left running for the second consumer.
        expect(capturedSignal!.aborted).toBe(false);

        resolveQuery("data");
        expect(await p2).toBe("data");
    });

    it("tears down the lone query via retention GC once the aborted caller leaves", async () => {
        vi.useFakeTimers();
        try {
            let capturedSignal: AbortSignal | undefined;
            const resource = createResource<number, string>({
                queryFn: (_args, signal) => {
                    capturedSignal = signal;
                    return new Promise<string>(() => {});
                },
                retentionTime: 5000,
            });

            const ac = new AbortController();
            const p = resource.ensure(1, { signal: ac.signal });
            p.catch(() => {});

            expect(capturedSignal).toBeDefined();
            expect(capturedSignal!.aborted).toBe(false);

            ac.abort();
            await expect(p).rejects.toHaveProperty("name", "AbortError");

            // No other consumer remains → retention countdown begins.
            expect(resource.getEntry(1)).not.toBeNull();
            expect(capturedSignal!.aborted).toBe(false);

            vi.advanceTimersByTime(5001);
            await flushMicrotasks();

            // Entry GC'd and the underlying request torn down.
            expect(resource.getEntry(1)).toBeNull();
            expect(capturedSignal!.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ==================== whenLoaded / whenFetched (entry primitives) ====================

describe("QueryCacheEntry.whenLoaded / whenFetched", () => {
    it("whenLoaded resolves synchronously for an already-successful entry", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(await resource.getEntry(1)!.whenLoaded()).toBe("data");
    });

    it("whenLoaded rejects with CacheEntryRemovedError when the entry is removed before settling", async () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        resource.trigger(1);
        const entry = resource.getEntry(1)!;
        const p = entry.whenLoaded();
        p.catch(() => {});

        entry.complete();
        await expect(p).rejects.toBeInstanceOf(CacheEntryRemovedError);
    });

    it("whenFetched keeps awaiting through stale data until the invalidation settles", async () => {
        let resolveInvalidate!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "v1";
                return new Promise<string>((r) => {
                    resolveInvalidate = r;
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        entry.invalidate();
        expect(entry.state$.peek().status).toBe("invalidating");

        const p = entry.whenFetched();
        let settled = false;
        void p.then(() => {
            settled = true;
        });

        // Still invalidating with stale data — whenFetched must not have resolved yet.
        await flushMicrotasks();
        expect(settled).toBe(false);

        resolveInvalidate("v2");
        expect(await p).toBe("v2");
    });
});

// ==================== getState (entry-state matrix) ====================
//
// `resource.getState(args)` is the clutch state of a single cache entry: the
// same fields and flags, `dataSource` narrowed to `none | current` (one entry
// has neither previous nor placeholder data) and no methods. Its matrix rows
// are 1, 2, 5, 6, 7, 9, 10 and 12 — one test each, asserting the whole shape.

describe("Resource.getState — entry-state matrix", () => {
    it("row 1 — no entry: idle with nothing to show", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        expect(resource.getState(1)).toEqual({
            status: "idle",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: null,
            error: null,
            hasData: false,
            hasError: false,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
    });

    it("row 2 — initial load in flight: pending with nothing to show", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise<string>(() => {}),
        });

        resource.trigger(1);

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: null,
            hasData: false,
            hasError: false,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
    });

    it("row 5 — success: the entry's own data, no error", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "good-data",
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(resource.getState(1)).toEqual({
            status: "success",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: null,
            hasData: true,
            hasError: false,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
    });

    it("row 6 — invalidation in flight: pending behind the entry's own data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "good-data";
                return new Promise<string>(() => {});
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: null,
            hasData: true,
            hasError: false,
            isPending: true,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: true,
        });
    });

    it("row 7 — the initial load failed: error with nothing to show", async () => {
        const failure = new Error("boom");
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw failure;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "error",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: failure,
            hasData: false,
            hasError: true,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(state.error).toBe(failure);
    });

    it("row 9 — the invalidation failed: error behind the entry's own data", async () => {
        const failure = new Error("invalidation failed");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "good-data";
                throw failure;
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();

        // Guard: the entry is in invalidate-error, which the derived state
        // reports as `error` with the data kept.
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidate-error");

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "error",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: failure,
            hasData: true,
            hasError: true,
            isPending: false,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(state.error).toBe(failure);
    });

    it("row 10 — retry of row 7: pending with the failure still readable", async () => {
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", dataSource: "none" });

        resource.getEntry(1)!.retry();

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: failure,
            hasData: false,
            hasError: true,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(state.error).toBe(failure);
    });

    it("row 12 — retry of row 9: pending behind the data, failure still readable", async () => {
        const failure = new Error("invalidation failed");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.resolve("good-data");
                if (callCount === 2) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.invalidate(1);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", dataSource: "current" });

        resource.getEntry(1)!.retry();

        const state = resource.getState(1);

        expect(state).toEqual({
            status: "pending",
            dataSource: "current",
            data: "good-data",
            dataArgs: 1,
            args: 1,
            error: failure,
            hasData: true,
            hasError: true,
            isPending: true,
            isInitialLoading: false,
            isSwitching: false,
            isInvalidating: true,
        });
        expect(state.error).toBe(failure);
    });

    it("never reports a placeholder: the option belongs to the clutch, not to an entry", async () => {
        const placeholderData = vi.fn(() => ({ data: "placeholder" }));
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
            placeholderData,
        });

        resource.trigger(1);

        // Row 2, not row 3: the entry itself has nothing to show.
        expect(resource.getState(1)).toMatchObject({
            status: "pending",
            dataSource: "none",
            data: null,
            hasData: false,
        });

        await flushMicrotasks();

        // Row 7, not row 13.
        expect(resource.getState(1)).toMatchObject({
            status: "error",
            dataSource: "none",
            data: null,
            hasData: false,
        });

        resource.getEntry(1)!.retry();

        // Row 10, not row 14.
        expect(resource.getState(1)).toMatchObject({
            status: "pending",
            dataSource: "none",
            data: null,
            hasData: false,
            hasError: true,
        });

        expect(placeholderData).not.toHaveBeenCalled();
    });

    it("invalidate() on a failed entry re-runs it with the error cleared (row 7 → row 2)", async () => {
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", hasError: true });

        resource.invalidate(1);

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: null,
            hasData: false,
            hasError: false,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(callCount).toBe(2);
    });

    it("prefetch(force) on a failed entry retries it, keeping the failure visible (row 7 → row 10)", async () => {
        const failure = new Error("boom");
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                callCount++;
                if (callCount === 1) return Promise.reject(failure);
                return new Promise<string>(() => {});
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getState(1)).toMatchObject({ status: "error", hasError: true });

        void resource.prefetch(1, { force: true });

        expect(resource.getState(1)).toEqual({
            status: "pending",
            dataSource: "none",
            data: null,
            dataArgs: null,
            args: 1,
            error: failure,
            hasData: false,
            hasError: true,
            isPending: true,
            isInitialLoading: true,
            isSwitching: false,
            isInvalidating: false,
        });
        expect(callCount).toBe(2);
    });
});

// ==================== Synchronous throw from queryFn ====================
//
// A non-async queryFn can throw *synchronously*, before any promise exists.
// That throw used to escape the QueryCacheEntry constructor — so trigger() /
// ensure() / fetch() threw synchronously and no entry was created — and, on
// invalidate()/retry(), escaped _execute() after the entry had already moved to
// invalidating/pending, stranding it there forever. The throw must instead flow
// through the entry's state like any other query failure.
describe("Resource — synchronous throw from queryFn", () => {
    it("trigger() does not throw; the entry is created and settles in error state", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
        });

        expect(() => resource.trigger(1)).not.toThrow();
        await flushMicrotasks();

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        const state = entry!.state$.peek();
        expect(state.status).toBe("error");
        if (state.status !== "error") throw new Error("expected error state");
        expect(state.error).toBe(error);
    });

    it("ensure() rejects instead of throwing synchronously", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.ensure(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });

    it("fetch() rejects instead of throwing synchronously", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
        });

        let promise!: Promise<string>;
        expect(() => {
            promise = resource.fetch(1);
        }).not.toThrow();

        await expect(promise).rejects.toBe(error);
    });

    it("invalidate() lands in invalidate-error (entry not stranded in invalidating) and can recover", async () => {
        let attempt = 0;
        const resource = createResource<number, string>({
            queryFn: (n) => {
                attempt++;
                if (attempt === 2) throw new Error("sync boom");
                return Promise.resolve(`data-${n}-attempt-${attempt}`);
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        entry.invalidate();
        await flushMicrotasks();

        const state = entry.state$.peek();
        expect(state.status).toBe("invalidate-error");
        if (state.status !== "invalidate-error") throw new Error("expected invalidate-error state");
        // Stale data survives the failed invalidation.
        expect(state.data).toBe("data-1-attempt-1");

        // The entry is alive: a further invalidate() recovers.
        entry.invalidate();
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("data-1-attempt-3");
    });

    it("retry() returns to error (entry not stranded in pending) and can recover", async () => {
        let attempt = 0;
        const resource = createResource<number, string>({
            queryFn: () => {
                attempt++;
                if (attempt < 3) throw new Error(`sync boom ${attempt}`);
                return Promise.resolve("recovered");
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.state$.peek().status).toBe("error");

        // Retry hits another sync throw — must settle back in error, not hang in pending.
        entry.retry();
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("error");

        entry.retry();
        await flushMicrotasks();
        expect(entry.state$.peek().status).toBe("success");
        expect(entry.state$.peek().data).toBe("recovered");
    });

    it("beforeQuery fallback path settles the entry in error state", async () => {
        const error = new Error("sync boom");
        const resource = createResource<number, string>({
            key: "r",
            queryFn: () => {
                throw error;
            },
            beforeQuery: async () => null,
        });

        // ensure() awaits the full beforeQuery → fallback-execute chain.
        await expect(resource.ensure(1)).rejects.toBe(error);

        const state = resource.getEntry(1)!.state$.peek();
        expect(state.status).toBe("error");
        if (state.status !== "error") throw new Error("expected error state");
        expect(state.error).toBe(error);
    });

    it("does not produce an unhandled rejection", async () => {
        const tracker = await trackUnhandledRejections();
        try {
            const resource = createResource<number, string>({
                queryFn: () => {
                    throw new Error("sync boom");
                },
            });

            resource.trigger(1);
            await flushUnhandledRejections();

            expect(tracker.unhandled).toEqual([]);
        } finally {
            tracker.stop();
        }
    });

    it("fires onQueryStarted with a rejecting $queryFulfilled", async () => {
        const error = new Error("sync boom");
        const seen: unknown[] = [];
        const resource = createResource<number, string>({
            queryFn: () => {
                throw error;
            },
            onQueryStarted: async (_args, { $queryFulfilled }) => {
                try {
                    await $queryFulfilled;
                } catch (e) {
                    seen.push(e);
                }
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(seen).toEqual([error]);
    });
});

// ==================== Deprecated aliases ====================

describe("Resource — deprecated aliases", () => {
    it("refresh(args) forwards to invalidate(args)", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `data-${++callCount}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        const invalidate = vi.spyOn(resource, "invalidate");
        resource.refresh(1);

        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(invalidate).toHaveBeenCalledWith(1);
        expect(resource.getEntry(1)!.state$.peek().status).toBe("invalidating");

        await flushMicrotasks();
        expect(resource.getEntry(1)!.state$.peek().data).toBe("data-2");
    });

    it("createAgent() forwards to createClutch()", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });

        const createClutch = vi.spyOn(resource, "createClutch");
        const clutch = resource.createAgent();

        expect(createClutch).toHaveBeenCalledTimes(1);
        expect(clutch).toBeInstanceOf(ResourceClutch);
    });

    it("pack(args) forwards to bind(args)", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });

        const bind = vi.spyOn(resource, "bind");
        const descriptor = resource.pack(1);

        expect(bind).toHaveBeenCalledTimes(1);
        expect(bind).toHaveBeenCalledWith(1);
        expect(descriptor).toEqual({ kind: "resource", resource, args: 1 });
    });

    it("QueryCacheEntry.refresh() forwards to invalidate()", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `data-${++callCount}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        const invalidate = vi.spyOn(entry, "invalidate");
        entry.refresh();

        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(entry.state$.peek().status).toBe("invalidating");

        await flushMicrotasks();
        expect(entry.state$.peek().data).toBe("data-2");
    });
});
