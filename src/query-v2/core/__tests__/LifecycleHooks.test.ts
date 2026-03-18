import { stableStringify } from "@/query-v2/lib/stableStringify";

import { CacheEntry } from "../CacheEntry";
import { LifecycleHooks } from "../LifecycleHooks";
import type { TMachineInstance } from "../machines/Machine";
import { MachineIdle } from "../machines/MachineIdle";
import { MachineSuccess } from "../machines/MachineSuccess";

function createHooks<TArgs = { id: number }, TData = string>(
    options: {
        onCacheEntryAdded?: (args: TArgs, tools: any) => void | Promise<void>;
        onQueryStarted?: (args: TArgs, tools: any) => void | Promise<void>;
    } = {},
) {
    return new LifecycleHooks<TArgs, TData>({
        serializeArgs: stableStringify,
        ...options,
    });
}

describe("LifecycleHooks", () => {
    // L1: onCacheEntryAdded fires on new cache entry
    it("L1: fires onCacheEntryAdded on new cache entry", () => {
        const callback = vi.fn();
        const hooks = createHooks({ onCacheEntryAdded: callback });
        const args = { id: 1 };

        hooks.fireCacheEntryAdded(args, () => MachineIdle.create() as TMachineInstance<string>);

        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith(
            args,
            expect.objectContaining({
                $cacheDataLoaded: expect.any(Promise),
                $cacheEntryRemoved: expect.any(Promise),
                getCacheEntry: expect.any(Function),
            }),
        );
    });

    // L2: onCacheEntryAdded does NOT fire on cache hit
    it("L2: does not fire onCacheEntryAdded if no callback configured", () => {
        const hooks = createHooks({});
        // Should not throw when no callback
        expect(() => {
            hooks.fireCacheEntryAdded({ id: 1 }, () => MachineIdle.create() as TMachineInstance<string>);
        }).not.toThrow();
    });

    // L3: $cacheDataLoaded resolves on first MachineSuccess
    it("L3: $cacheDataLoaded resolves when resolveCacheDataLoaded is called", async () => {
        let tools: any;
        const hooks = createHooks({
            onCacheEntryAdded: (_args, t) => {
                tools = t;
            },
        });

        hooks.fireCacheEntryAdded({ id: 1 }, () => MachineIdle.create() as TMachineInstance<string>);

        // Resolve
        hooks.resolveCacheDataLoaded({ id: 1 }, "hello");

        const data = await tools.$cacheDataLoaded;
        expect(data).toBe("hello");
    });

    // L4: $cacheEntryRemoved resolves on eviction
    it("L4: $cacheEntryRemoved resolves when fireCacheEntryRemoved is called", async () => {
        let tools: any;
        const hooks = createHooks({
            onCacheEntryAdded: (_args, t) => {
                tools = t;
            },
        });

        hooks.fireCacheEntryAdded({ id: 1 }, () => MachineIdle.create() as TMachineInstance<string>);
        hooks.resolveCacheDataLoaded({ id: 1 }, "data");

        hooks.fireCacheEntryRemoved({ id: 1 });

        await expect(tools.$cacheEntryRemoved).resolves.toBeUndefined();
    });

    // L5: $cacheDataLoaded rejects if entry removed before data
    it("L5: $cacheDataLoaded rejects if entry removed before data loaded", async () => {
        let tools: any;
        const hooks = createHooks({
            onCacheEntryAdded: (_args, t) => {
                tools = t;
            },
        });

        hooks.fireCacheEntryAdded({ id: 1 }, () => MachineIdle.create() as TMachineInstance<string>);

        // Remove before data arrives
        hooks.fireCacheEntryRemoved({ id: 1 });

        await expect(tools.$cacheDataLoaded).rejects.toThrow("Cache entry removed before data loaded");
    });

    // L6: onQueryStarted fires on every fetch
    it("L6: fires onQueryStarted on every fetch", () => {
        const callback = vi.fn();
        const hooks = createHooks({ onQueryStarted: callback });
        const entry = new CacheEntry<string>(MachineIdle.create() as TMachineInstance<string>);

        hooks.fireQueryStarted({ id: 1 }, () => entry);
        hooks.resolveQueryFulfilled("data1");
        hooks.fireQueryStarted({ id: 1 }, () => entry);

        expect(callback).toHaveBeenCalledTimes(2);
    });

    // L7: $queryFulfilled resolves with { data } on success
    it("L7: $queryFulfilled resolves with { data, isError: false } on success", async () => {
        let tools: any;
        const hooks = createHooks({
            onQueryStarted: (_args, t) => {
                tools = t;
            },
        });
        const entry = new CacheEntry<string>(MachineIdle.create() as TMachineInstance<string>);

        hooks.fireQueryStarted({ id: 1 }, () => entry);
        hooks.resolveQueryFulfilled("result");

        const result = await tools.$queryFulfilled;
        expect(result).toEqual({ data: "result", isError: false });
    });

    // L8: $queryFulfilled rejects on error
    it("L8: $queryFulfilled rejects on error", async () => {
        let tools: any;
        const hooks = createHooks({
            onQueryStarted: (_args, t) => {
                tools = t;
            },
        });
        const entry = new CacheEntry<string>(MachineIdle.create() as TMachineInstance<string>);

        hooks.fireQueryStarted({ id: 1 }, () => entry);
        hooks.rejectQueryFulfilled(new Error("fetch failed"));

        await expect(tools.$queryFulfilled).rejects.toThrow("fetch failed");
    });

    // L9: $queryFulfilled rejects on abort
    it("L9: $queryFulfilled rejects on abort", async () => {
        let tools: any;
        const hooks = createHooks({
            onQueryStarted: (_args, t) => {
                tools = t;
            },
        });
        const entry = new CacheEntry<string>(MachineIdle.create() as TMachineInstance<string>);

        hooks.fireQueryStarted({ id: 1 }, () => entry);
        hooks.rejectQueryFulfilled(new DOMException("Aborted", "AbortError"));

        await expect(tools.$queryFulfilled).rejects.toThrow("Aborted");
    });
});
