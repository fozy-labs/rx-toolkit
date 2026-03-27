import { vi } from "vitest";

import { LifecycleHooks } from "@/query-v2/core/LifecycleHooks";
import type { IResourceV2CacheEntry } from "@/query-v2/types";

type TArgs = { id: number };
type TData = { name: string };

function createMockEntry(): IResourceV2CacheEntry<TArgs, TData> {
    return {
        machine$: vi.fn(),
        state$: vi.fn(),
        peek: vi.fn(),
        set: vi.fn(),
        complete: vi.fn(),
        onClean$: { subscribe: vi.fn(), next: vi.fn(), complete: vi.fn() },
        obs: {} as any,
        isMyArgs: vi.fn(),
        createPatch: vi.fn(),
        invalidate: vi.fn(),
        query: vi.fn(),
    } as unknown as IResourceV2CacheEntry<TArgs, TData>;
}

describe("LifecycleHooks", () => {
    // LH01: fireCacheEntryAdded invokes callback
    it("LH01: fireCacheEntryAdded invokes onCacheEntryAdded callback", () => {
        const onCacheEntryAdded = vi.fn();
        const hooks = new LifecycleHooks<TArgs, TData>(onCacheEntryAdded);
        const entry = createMockEntry();
        const args: TArgs = { id: 1 };

        hooks.fireCacheEntryAdded(args, entry);

        expect(onCacheEntryAdded).toHaveBeenCalledTimes(1);
        expect(onCacheEntryAdded).toHaveBeenCalledWith(
            args,
            expect.objectContaining({
                $cacheDataLoaded: expect.any(Promise),
                $cacheEntryRemoved: expect.any(Promise),
            }),
        );
    });

    // LH02: $cacheDataLoaded resolves on first success
    it("LH02: $cacheDataLoaded resolves when resolveDataLoaded is called", async () => {
        let capturedTools: any;
        const onCacheEntryAdded = vi.fn((_args, tools) => {
            capturedTools = tools;
        });
        const hooks = new LifecycleHooks<TArgs, TData>(onCacheEntryAdded);
        const args: TArgs = { id: 1 };

        hooks.fireCacheEntryAdded(args, createMockEntry());
        hooks.resolveDataLoaded(args, { name: "loaded" });

        const data = await capturedTools.$cacheDataLoaded;
        expect(data).toEqual({ name: "loaded" });
    });

    // LH03: $cacheEntryRemoved resolves on GC/complete
    it("LH03: $cacheEntryRemoved resolves when fireCacheEntryRemoved is called", async () => {
        let capturedTools: any;
        const onCacheEntryAdded = vi.fn((_args, tools) => {
            capturedTools = tools;
        });
        const hooks = new LifecycleHooks<TArgs, TData>(onCacheEntryAdded);
        const args: TArgs = { id: 1 };

        hooks.fireCacheEntryAdded(args, createMockEntry());
        hooks.fireCacheEntryRemoved(args);

        await expect(capturedTools.$cacheEntryRemoved).resolves.toBeUndefined();
    });

    // LH04: $cacheDataLoaded rejects if entry removed before any success
    it("LH04: $cacheDataLoaded rejects if entry removed before data loaded", async () => {
        let capturedTools: any;
        const onCacheEntryAdded = vi.fn((_args, tools) => {
            capturedTools = tools;
        });
        const hooks = new LifecycleHooks<TArgs, TData>(onCacheEntryAdded);
        const args: TArgs = { id: 1 };

        hooks.fireCacheEntryAdded(args, createMockEntry());

        // Clear all before data loads
        hooks.clearAll();

        await expect(capturedTools.$cacheDataLoaded).rejects.toThrow("Cache cleared");
    });

    // LH05: fireQueryStarted invokes callback
    it("LH05: fireQueryStarted invokes onQueryStarted callback", () => {
        const onQueryStarted = vi.fn();
        const hooks = new LifecycleHooks<TArgs, TData>(undefined, onQueryStarted);
        const entry = createMockEntry();
        const args: TArgs = { id: 1 };

        hooks.fireQueryStarted(args, entry);

        expect(onQueryStarted).toHaveBeenCalledTimes(1);
        expect(onQueryStarted).toHaveBeenCalledWith(
            args,
            expect.objectContaining({
                $queryFulfilled: expect.any(Promise),
                getCacheEntry: expect.any(Function),
            }),
        );
    });

    // LH06: $queryFulfilled resolves on query success
    it("LH06: $queryFulfilled resolves on query success", async () => {
        let capturedTools: any;
        const onQueryStarted = vi.fn((_args, tools) => {
            capturedTools = tools;
        });
        const hooks = new LifecycleHooks<TArgs, TData>(undefined, onQueryStarted);
        const args: TArgs = { id: 1 };

        hooks.fireQueryStarted(args, createMockEntry());
        hooks.resolveQueryFulfilled(args, { data: { name: "result" } });

        const result = await capturedTools.$queryFulfilled;
        expect(result).toEqual({ data: { name: "result" } });
    });

    // LH07: $queryFulfilled rejects on query error
    it("LH07: $queryFulfilled rejects on query error", async () => {
        let capturedTools: any;
        const onQueryStarted = vi.fn((_args, tools) => {
            capturedTools = tools;
        });
        const hooks = new LifecycleHooks<TArgs, TData>(undefined, onQueryStarted);
        const args: TArgs = { id: 1 };

        hooks.fireQueryStarted(args, createMockEntry());
        hooks.resolveQueryFulfilled(args, { error: new Error("query failed") });

        await expect(capturedTools.$queryFulfilled).rejects.toThrow("query failed");
    });

    // LH08: clearAll() cleans up all pending resolvers
    it("LH08: clearAll cleans up all pending resolvers", async () => {
        let entryTools: any;
        let queryTools: any;
        const onCacheEntryAdded = vi.fn((_args, tools) => {
            entryTools = tools;
        });
        const onQueryStarted = vi.fn((_args, tools) => {
            queryTools = tools;
        });
        const hooks = new LifecycleHooks<TArgs, TData>(onCacheEntryAdded, onQueryStarted);
        const args: TArgs = { id: 1 };

        hooks.fireCacheEntryAdded(args, createMockEntry());
        hooks.fireQueryStarted(args, createMockEntry());

        hooks.clearAll();

        // $cacheDataLoaded should reject
        await expect(entryTools.$cacheDataLoaded).rejects.toThrow("Cache cleared");
        // $cacheEntryRemoved should resolve (entry is being removed)
        await expect(entryTools.$cacheEntryRemoved).resolves.toBeUndefined();
        // $queryFulfilled should reject
        await expect(queryTools.$queryFulfilled).rejects.toThrow("Cache cleared");
    });

    // LH09: Multiple callbacks — all invoked in order
    it("LH09: no callback registered means fire methods are no-ops", () => {
        const hooks = new LifecycleHooks<TArgs, TData>();
        const entry = createMockEntry();
        const args: TArgs = { id: 1 };

        // Should not throw
        hooks.fireCacheEntryAdded(args, entry);
        hooks.fireQueryStarted(args, entry);
        hooks.resolveDataLoaded(args, { name: "data" });
        hooks.fireCacheEntryRemoved(args);
        hooks.resolveQueryFulfilled(args, { data: { name: "data" } });
        hooks.clearAll();
    });

    it("LH09b: getCacheEntry returns the entry passed to fireQueryStarted", () => {
        let capturedTools: any;
        const onQueryStarted = vi.fn((_args, tools) => {
            capturedTools = tools;
        });
        const hooks = new LifecycleHooks<TArgs, TData>(undefined, onQueryStarted);
        const entry = createMockEntry();

        hooks.fireQueryStarted({ id: 1 }, entry);

        expect(capturedTools.getCacheEntry()).toBe(entry);
    });

    it("callback errors are caught and do not propagate", () => {
        const onCacheEntryAdded = vi.fn(() => {
            throw new Error("callback error");
        });
        const hooks = new LifecycleHooks<TArgs, TData>(onCacheEntryAdded);

        // Should not throw
        expect(() => {
            hooks.fireCacheEntryAdded({ id: 1 }, createMockEntry());
        }).not.toThrow();
    });
});
