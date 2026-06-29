import { describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { CacheEntryRemovedError } from "@/query/core/errors";
import { Machine } from "@/query/core/machine/Machine";
import { Resource } from "@/query/core/resource/Resource";
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
        const machine = entry!.machine$.peek();
        expect(machine.state.status).toBe("success");
        expect(machine.state.data).toBe("cached");
    });

    it("hydration with isStale produces entry in refreshing state", () => {
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

        const entry = resource.getEntry(99);
        expect(entry).not.toBeNull();
        const machine = entry!.machine$.peek();
        expect(machine.state.status).toBe("refreshing");
        expect(machine.state.data).toBe("stale-data");
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
        expect(entry!.machine$.peek().state.status).toBe("success");
        expect(entry!.machine$.peek().state.data).toBe("data");
    });

    it("returns existing entry without re-fetching on cache hit (doForce=false)", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        await flushMicrotasks();

        resource.trigger(1); // second call, same args
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("forces refresh on existing entry when doForce=true", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        await flushMicrotasks();

        resource.trigger(1, true);
        // queryFn called twice: initial + forced refresh
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

// ==================== refresh ====================

describe("Resource.refresh", () => {
    it("triggers a background SWR refresh on existing entry", async () => {
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
        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("data-1");

        resource.refresh(1);

        // During refresh, entry transitions to refreshing state
        // but data is still accessible
        const midRefresh = entry.machine$.peek();
        expect(midRefresh.state.status).toBe("refreshing");
        expect(midRefresh.state.data).toBe("data-1");

        await flushMicrotasks();

        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("data-2");
    });

    it("is a no-op when no cache entry exists for given args", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        // Should not throw
        resource.refresh(999);

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
        expect(entry!.machine$.peek().state.data).toBe("data");
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
        expect(entry!.machine$.peek().state.data).toBe("initiated");
    });

    it("handles void args correctly", async () => {
        const resource = createResource<void, string>({
            queryFn: async () => "void-data",
        });

        resource.trigger(undefined as void);
        await flushMicrotasks();

        const entry = resource.getEntry(undefined as void);
        expect(entry).not.toBeNull();
        expect(entry!.machine$.peek().state.data).toBe("void-data");
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
        expect(entry1!.machine$.peek().state.data).toBe("data-1");
        expect(entry2!.machine$.peek().state.data).toBe("data-2");
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
        expect(entry$()!.machine$.peek().state.data).toBe("data");

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
        expect(entry$()!.machine$.peek().state.data).toBe("initiated");
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

// ==================== pack ====================

describe("Resource.pack", () => {
    it("returns an inert { kind, resource, args } descriptor", () => {
        const queryFn = vi.fn(async (n: number) => `data-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const packed = resource.pack(42);

        expect(packed).toEqual({ kind: "resource", resource, args: 42 });
        // pack must not execute the query
        expect(queryFn).not.toHaveBeenCalled();
        expect([...resource.getEntries()]).toEqual([]);
    });

    it("preserves Keyed args as-is", () => {
        const resource = createResource<number, string>({
            queryFn: async (n) => `data-${n}`,
        });

        const keyed = resource.toKeyed(7);
        const packed = resource.pack(keyed);

        expect(packed.args).toBe(keyed);
    });

    it("descriptor can be replayed via resource.trigger", async () => {
        const queryFn = vi.fn(async (n: number) => `data-${n}`);
        const resource = createResource<number, string>({ queryFn });

        const packed = resource.pack(99);
        packed.resource.trigger(packed.args);
        await flushMicrotasks();

        expect(queryFn).toHaveBeenCalledWith(99, expect.anything());
        const entry = resource.getEntry(99);
        expect(entry!.machine$.peek().state.data).toBe("data-99");
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
        expect(entry!.machine$.peek().state.data).toBe("data-2");
    });
});

// ==================== createAgent ====================

describe("Resource.createAgent", () => {
    it("returns a ResourceAgent instance", () => {
        const resource = createResource<number, string>({
            queryFn: async () => "data",
        });

        const agent = resource.createAgent();
        expect(agent).toBeDefined();
        expect(typeof agent.start).toBe("function");
        expect(typeof agent.set).toBe("function");
        expect(typeof agent.retry).toBe("function");
        expect(typeof agent.refresh).toBe("function");
        expect(typeof agent.state$).toBe("function");
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
        expect(resource.getEntry(1)!.machine$.peek().state.data).toBe("stale");

        // Force re-fetch
        resource.trigger(1, true);

        // Entry should be in refreshing state with stale data still accessible
        const entry = resource.getEntry(1)!;
        const mid = entry.machine$.peek();
        expect(mid.state.status).toBe("refreshing");
        expect(mid.state.data).toBe("stale");

        // Resolve the refresh
        resolveQuery("fresh");
        await flushMicrotasks();
        await flushMicrotasks();

        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("fresh");
    });

    it("during refresh, getEntry still returns the entry with old data", async () => {
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

        resource.refresh(1);

        const entry = resource.getEntry(1);
        expect(entry).not.toBeNull();
        expect(entry!.machine$.peek().state.status).toBe("refreshing");
        expect(entry!.machine$.peek().state.data).toBe("original");

        resolveQuery("updated");
        await flushMicrotasks();
    });

    it("refresh → success transition preserves entry identity", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        const entryBefore = resource.getEntry(1);
        resource.refresh(1);
        await flushMicrotasks();
        const entryAfter = resource.getEntry(1);

        expect(entryBefore).toBe(entryAfter);
    });
});

// ==================== Machine State Interactions ====================

describe("Machine state interactions", () => {
    it("new entry starts in pending state", () => {
        const resource = createResource<number, string>({
            queryFn: () => new Promise(() => {}), // never resolves
        });

        resource.trigger(1);
        const entry = resource.getEntry(1)!;
        expect(entry.machine$.peek().state.status).toBe("pending");
    });

    it("successful fetch → success state", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => "ok",
        });

        resource.trigger(1);
        await flushMicrotasks();

        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("success");
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
        expect(entry.machine$.peek().state.status).toBe("error");
        expect(entry.machine$.peek().state.error).toBeInstanceOf(Error);
    });

    it("refresh() transitions through refreshing state", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => `v${++callCount}`,
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.refresh(1);
        const entry = resource.getEntry(1)!;
        expect(entry.machine$.peek().state.status).toBe("refreshing");

        await flushMicrotasks();
        expect(entry.machine$.peek().state.status).toBe("success");
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
        expect(entry!.machine$.peek().state.status).toBe("success");
        expect(entry!.machine$.peek().state.data).toBe("snapshot-data");
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
        expect(entry.machine$.peek().state.status).toBe("error");

        entry.retry();
        await flushMicrotasks();

        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("recovered");
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

    it("fires again on refresh", async () => {
        const startedArgs: number[] = [];

        const resource = createResource<number, string>({
            queryFn: async () => "data",
            onQueryStarted: (args) => {
                startedArgs.push(args);
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.refresh(1);
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

        expect(resource.getEntry(1)!.machine$.peek().state.data).toBe("data");
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
        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("from-tab");
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
        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("from-query");
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
        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("from-query");
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
        expect(entry.machine$.peek().state.data).toBe("hydrated");
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
        expect(entry1.machine$.peek().state.data).toBe("v1");

        entry1.complete();
        await flushMicrotasks();

        resource.trigger(1);
        await flushMicrotasks();

        const entry2 = resource.getEntry(1)!;
        expect(entry2).not.toBe(entry1);
        expect(entry2.machine$.peek().state.data).toBe("v2");
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
        expect(entry.machine$.peek().state.status).toBe("error");
        expect(entry.machine$.peek().state.error).toBe(cause);
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
        expect(entry.machine$.peek().state.status).toBe("error");
        expect(entry.machine$.peek().state.error).toBe("string-error");
    });

    it("refresh failure transitions to refresh-error, preserving old data", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "good-data";
                throw new Error("refresh failed");
            },
        });

        resource.trigger(1);
        await flushMicrotasks();
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("success");

        resource.refresh(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.machine$.peek().state.status).toBe("refresh-error");
        expect(entry.machine$.peek().state.data).toBe("good-data");
        expect(entry.machine$.peek().state.error).toBeInstanceOf(Error);
    });

    it("retry after refresh-error triggers a new fetch via refresh()", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                if (callCount === 2) throw new Error("refresh failed");
                return "recovered";
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.refresh(1);
        await flushMicrotasks();

        const entry = resource.getEntry(1)!;
        expect(entry.machine$.peek().state.status).toBe("refresh-error");

        // refresh-error allows refresh() again
        entry.refresh();
        await flushMicrotasks();

        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("recovered");
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
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("success");
        expect(resource.getEntry(1)!.machine$.peek().state.data).toBe("finally");
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
        expect(entry!.machine$.peek().state.data).toBe("data");
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
            expect(entry!.machine$.peek().state.data).toBe("data");

            // No unhandled rejection should have been captured
            expect(unhandled).toEqual([]);
        } finally {
            proc.off("unhandledRejection", handler);
        }
    });

    it("onQueryStarted receives updated context on refresh", async () => {
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

        resource.refresh(1);
        await flushMicrotasks();

        expect(fulfillments).toEqual([{ data: "v1" }, { data: "v2" }]);
    });
});

// ==================== Concurrent trigger abort/cancel ====================

describe("Concurrent trigger abort/cancel", () => {
    it("doForce on pending entry is a no-op (refresh invalid from pending)", async () => {
        const queryFn = vi.fn(() => new Promise<string>(() => {})); // never resolves

        const resource = createResource<number, string>({ queryFn });

        resource.trigger(1);
        expect(queryFn).toHaveBeenCalledTimes(1);

        // doForce calls existing.refresh(), but refresh() is invalid from pending
        resource.trigger(1, true);
        // queryFn should NOT be called again — refresh was a no-op
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

        resource.refresh(1);
        await flushMicrotasks();

        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
    });

    it("refresh from success aborts the previous controller and starts new query", async () => {
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
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("success");

        // Start refresh → entry goes to refreshing, _execute creates new AbortController
        resource.refresh(1);
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("refreshing");

        // Resolve the refresh
        resolvers[0]!("refreshed");
        await flushMicrotasks();
        await flushMicrotasks();

        expect(resource.getEntry(1)!.machine$.peek().state.data).toBe("refreshed");
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

    it("reset while refresh is in-flight clears cache", async () => {
        let callCount = 0;
        let resolveRefresh!: (val: string) => void;

        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) return "initial";
                return new Promise<string>((r) => {
                    resolveRefresh = r;
                });
            },
        });

        resource.trigger(1);
        await flushMicrotasks();

        resource.refresh(1);
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("refreshing");

        resource.reset();
        expect(resource.getEntry(1)).toBeNull();

        // Late resolve of refresh should not crash or re-add entry
        resolveRefresh("late-refresh");
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
        expect(resource.getEntry(1)!.machine$.peek().state.status).toBe("error");

        resource.getEntry(1)!.retry();
        await flushMicrotasks();

        expect(signals).toHaveLength(2);
        expect(signals[0]).not.toBe(signals[1]);
        expect(resource.getEntry(1)!.machine$.peek().state.data).toBe("recovered");
    });
});

// ==================== createPatch edge cases ====================

describe("QueryCacheEntry.createPatch edge cases", () => {
    type Data = { name: string };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const peek = (e: any) => e.machine$.peek() as any;

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
        const stateAfterFirstCommit = e.machine$.peek();

        handle.commit();
        const stateAfterSecondCommit = e.machine$.peek();

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
        const stateAfterCommit = e.machine$.peek();

        handle.abort();
        const stateAfterAbort = e.machine$.peek();

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
        const stateAfterAbort = e.machine$.peek();

        handle.commit();
        const stateAfterCommit = e.machine$.peek();

        expect(stateAfterCommit).toBe(stateAfterAbort);
    });

    it("returns null on pending entry", () => {
        const resource = createResource<number, Data>({
            queryFn: () => new Promise(() => {}), // never resolves — stays pending
        });
        resource.trigger(1);

        const entry = resource.getEntry(1)!;
        expect(entry.machine$.peek().status).toBe("pending");

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
        expect(entry.machine$.peek().status).toBe("error");

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

    it("consistency violation triggers auto-refresh", async () => {
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
        // This should trigger consistency violation + auto-refresh
        h1.abort();

        // After consistency violation, auto-refresh kicks in
        // The entry should now be in refreshing state with fetchCount about to increment
        await flushMicrotasks();

        // Auto-refresh should have re-fetched
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
        expect(entry.machine$.peek().state.status).toBe("success");
        expect(queryFn).toHaveBeenCalledTimes(1);

        entry.retry();

        expect(entry.machine$.peek().state.status).toBe("success");
        expect(entry.machine$.peek().state.data).toBe("data");
        expect(queryFn).toHaveBeenCalledTimes(1);
    });
});

describe("Resource — multi-key refresh isolation", () => {
    it("refreshing key=1 does not affect key=2 success state", async () => {
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
        expect(entry1.machine$.peek().state.status).toBe("success");
        expect(entry2.machine$.peek().state.status).toBe("success");

        const entry2DataBefore = entry2.machine$.peek().state.data;

        resource.refresh(1);
        await flushMicrotasks();

        // key=2 remains unchanged
        expect(entry2.machine$.peek().state.status).toBe("success");
        expect(entry2.machine$.peek().state.data).toBe(entry2DataBefore);

        // key=1 was refreshed
        expect(entry1.machine$.peek().state.status).toBe("success");
        expect(entry1.machine$.peek().state.data).not.toBe("data-1-call1");
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
        expect(entry.machine$.peek().state.status).toBe("success");

        // Capture the state value via peek() before complete
        const dataBefore = entry.machine$.peek().state.data;

        entry.complete();

        // Attempt to set after complete — CacheEntry._isCompleted guards this
        entry.set(Machine.pending<number, string>(1));

        // peek() on the underlying state should still return the last value
        expect(entry.peek().state.status).toBe("success");
        expect(entry.peek().state.data).toBe(dataBefore);
    });
});
