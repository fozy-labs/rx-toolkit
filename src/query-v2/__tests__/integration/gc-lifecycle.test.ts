import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { createApi } from "@/query-v2/api/createApi";
import { useResourceV2Agent } from "@/query-v2/react";

type TArgs = { id: number };
type TData = { name: string };

describe("Integration: gc-lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function createGcTestApi(cacheLifetime: number) {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime,
        });
        return { api, resource, queryFn, calls };
    }

    // ── INT05: GC under component lifecycle: mount→data→unmount→timer→remount (data still cached) ──
    it("INT05: data remains cached when remounted before GC timer expires", async () => {
        const lifetime = 5000;
        const { resource, queryFn, calls } = createGcTestApi(lifetime);

        // Mount: fetch data
        let args: TArgs = { id: 1 };
        const { result, unmount } = renderHook(() => useResourceV2Agent(resource, args));

        expect(queryFn).toHaveBeenCalledTimes(1);

        // Resolve
        await act(async () => {
            calls[0].resolve({ name: "Alice" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Alice" });

        // Unmount — GC timer starts
        unmount();

        // Advance less than cacheLifetime
        await act(async () => {
            vi.advanceTimersByTime(lifetime / 2);
        });

        // Remount — data should still be cached, no re-fetch
        const { result: result2 } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        // Entry still exists with cached data — no new fetch needed
        // The hook should show success with cached data (queryFn not called again)
        await act(async () => {
            await flushMicrotasks();
        });

        expect(result2.current.status).toBe("success");
        expect(result2.current.data).toEqual({ name: "Alice" });
        // queryFn should only have been called once (the original fetch)
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // ── INT06: GC under component lifecycle: mount→data→unmount→timer expires (entry GC'd) ──
    it("INT06: entry is GC'd when timer expires after unmount; remount triggers new fetch", async () => {
        const lifetime = 5000;
        const { resource, queryFn, calls } = createGcTestApi(lifetime);

        // Mount: fetch data
        const { result, unmount } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        expect(queryFn).toHaveBeenCalledTimes(1);

        // Resolve
        await act(async () => {
            calls[0].resolve({ name: "Alice" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");

        // Unmount — GC timer starts
        unmount();

        // Advance past cacheLifetime — entry should be GC'd
        await act(async () => {
            vi.advanceTimersByTime(lifetime + 100);
        });

        // Entry should have been removed
        const entry = resource.getEntry({ id: 1 });
        expect(entry).toBeNull();

        // Remount — should trigger a new fetch
        const { result: result2 } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        expect(queryFn).toHaveBeenCalledTimes(2);
        expect(result2.current.status).toBe("pending");

        // Resolve the new fetch
        await act(async () => {
            calls[1].resolve({ name: "Alice-fresh" });
            await flushMicrotasks();
        });

        expect(result2.current.status).toBe("success");
        expect(result2.current.data).toEqual({ name: "Alice-fresh" });
    });

    // ── T25: GC-triggered entry removal → $cacheDataLoaded rejects ──
    it("T25: GC-triggered entry removal causes $cacheDataLoaded to reject", async () => {
        const lifetime = 2000;
        let cacheDataLoadedRejected = false;
        let rejectionError: Error | null = null;

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResourceV2<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: lifetime,
            onCacheEntryAdded: (_args, tools) => {
                tools.$cacheDataLoaded.catch((err: Error) => {
                    cacheDataLoadedRejected = true;
                    rejectionError = err;
                });
            },
        });

        // Mount hook to create entry + subscriber
        const { unmount } = renderHook(() => useResourceV2Agent(resource, { id: 1 }));

        // Entry is pending — don't resolve (so $cacheDataLoaded stays pending)
        expect(queryFn).toHaveBeenCalledTimes(1);

        // Unmount — GC timer starts
        unmount();

        // Advance past GC lifetime — entry is removed
        await act(async () => {
            vi.advanceTimersByTime(lifetime + 100);
        });

        // Entry should have been GC'd
        expect(resource.getEntry({ id: 1 })).toBeNull();

        // $cacheDataLoaded should have rejected
        expect(cacheDataLoadedRejected).toBe(true);
        expect(rejectionError).not.toBeNull();

        // Clean up
        calls[0].resolve({ name: "orphaned" });
        await flushMicrotasks();
    });
});
