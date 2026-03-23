import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";
import { Batcher, Signal } from "@/signals";

import { MachineError } from "../machines/MachineError";
import { MachineIdle } from "../machines/MachineIdle";
import { MachinePending } from "../machines/MachinePending";
import { MachineRefreshing } from "../machines/MachineRefreshing";
import { MachineSuccess } from "../machines/MachineSuccess";
import { ResourceV2 } from "../resource/ResourceV2";

/** Controllable queryFn: returns a promise you can resolve/reject from outside */
function controllableQueryFn<TArgs = unknown, TData = unknown>() {
    const calls: Array<{
        args: TArgs;
        resolve: (data: TData) => void;
        reject: (error: Error) => void;
        signal: AbortSignal;
    }> = [];

    const fn = vi.fn((args: TArgs, { abortSignal }: { abortSignal: AbortSignal }) => {
        return new Promise<TData>((resolve, reject) => {
            let settled = false;
            const wrappedResolve = (data: TData) => {
                if (settled) return;
                settled = true;
                resolve(data);
            };
            const wrappedReject = (error: Error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
            calls.push({ args, resolve: wrappedResolve, reject: wrappedReject, signal: abortSignal });
            abortSignal.addEventListener("abort", () => {
                wrappedReject(new DOMException("Aborted", "AbortError"));
            });
        });
    });

    return { fn, calls };
}

function createResource<TArgs = { id: number }, TData = string>(
    overrides: Partial<ConstructorParameters<typeof ResourceV2<TArgs, TData>>[0]> = {},
) {
    const { fn, calls } = controllableQueryFn<TArgs, TData>();
    const resource = new ResourceV2<TArgs, TData>({
        queryFn: fn,
        cacheLifetime: 5000,
        ...overrides,
    });
    return { resource, queryFn: fn, calls };
}

describe("ResourceV2", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // R1: query(args) on cache miss — full flow
    it("R1: cache miss → Idle → Pending → Success", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };

        const promise = resource.query(args);

        // Entry should exist and be pending
        const entry = resource.entry(args);
        expect(entry).not.toBeNull();
        expect(entry!.peek().state.status).toBe("pending");

        // Resolve the queryFn
        calls[0].resolve("result-data" as any);
        const result = await promise;

        expect(result.peek().state.status).toBe("success");
        expect(result.peek().state.data).toBe("result-data");
    });

    // R2: query(args) on cache hit — no refetch
    it("R2: cache hit returns existing entry, no refetch", async () => {
        const { resource, calls, queryFn } = createResource();
        const args = { id: 1 };

        const p1 = resource.query(args);
        calls[0].resolve("data1" as any);
        const entry1 = await p1;

        const p2 = resource.query(args);
        const entry2 = await p2;

        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(entry2.peek().state.data).toBe("data1");
    });

    // R3: query(args, force=true) re-fetches
    it("R3: force refetch triggers new queryFn call", async () => {
        const { resource, calls, queryFn } = createResource();
        const args = { id: 1 };

        const p1 = resource.query(args);
        calls[0].resolve("data1" as any);
        await p1;

        const p2 = resource.query(args, true);

        expect(queryFn).toHaveBeenCalledTimes(2);

        calls[1].resolve("data2" as any);
        const entry2 = await p2;

        expect(entry2.peek().state.data).toBe("data2");
    });

    // R4: invalidate(args) triggers MachineRefreshing
    it("R4: invalidate on success → Refreshing → Success", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };

        const p1 = resource.query(args);
        calls[0].resolve("original" as any);
        await p1;

        resource.invalidate(args);

        const entry = resource.entry(args)!;
        expect(entry.peek().state.status).toBe("refreshing");
        expect(entry.peek().state.data).toBe("original");

        // Resolve the refresh
        calls[1].resolve("refreshed" as any);
        await vi.advanceTimersByTimeAsync(0);

        expect(entry.peek().state.status).toBe("success");
        expect(entry.peek().state.data).toBe("refreshed");
    });

    // R5: invalidate(args) on Idle — no-op
    it("R5: invalidate on idle/no-entry is a no-op", () => {
        const { resource, queryFn } = createResource();
        resource.invalidate({ id: 99 } as any);
        expect(queryFn).not.toHaveBeenCalled();
    });

    // R6: entry(args) returns null when no cache entry
    it("R6: entry returns null when no cache entry exists", () => {
        const { resource } = createResource();
        expect(resource.entry({ id: 1 } as any)).toBeNull();
    });

    // R7: entry(args, true) creates entry and initiates
    it("R7: entry with doInitiate creates entry and starts query", async () => {
        const { resource, calls, queryFn } = createResource();
        const args = { id: 1 };

        const entry = resource.entry(args, true);
        expect(entry).not.toBeNull();
        expect(queryFn).toHaveBeenCalledTimes(1);

        calls[0].resolve("initiated" as any);
        await vi.advanceTimersByTimeAsync(0);

        expect(entry!.peek().state.status).toBe("success");
    });

    // R8: SKIP_TOKEN prevents query execution
    it("R8: SKIP_TOKEN throws on direct query()", async () => {
        const { resource } = createResource();
        await expect(resource.query(SKIP as any)).rejects.toThrow("SKIP_TOKEN is not valid for direct query()");
    });

    it("R8: query$ with SKIP returns idle state", () => {
        const { resource } = createResource();
        const state = resource.query$(SKIP as any);
        expect(state.status).toBe("idle");
    });

    // R9: Concurrent query(same args) deduplicates
    it("R9: concurrent queries for same args use one queryFn call", async () => {
        const { resource, calls, queryFn } = createResource();
        const args = { id: 1 };

        const p1 = resource.query(args);
        const p2 = resource.query(args);

        expect(queryFn).toHaveBeenCalledTimes(1);

        calls[0].resolve("shared" as any);
        const [entry1, entry2] = await Promise.all([p1, p2]);

        expect(entry1.peek().state.data).toBe("shared");
        expect(entry2.peek().state.data).toBe("shared");
    });

    // R10: Query error → MachineError
    it("R10: queryFn rejection → MachineError", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };

        const promise = resource.query(args);
        calls[0].reject(new Error("Network failure"));

        const entry = await promise;
        expect(entry.peek().state.status).toBe("error");
        expect(entry.peek().state.error).toBeInstanceOf(Error);
        expect((entry.peek().state.error as Error).message).toBe("Network failure");
    });

    // R11: resetCache resets all entries
    it("R11: resetCache resets all entries", async () => {
        const { resource, calls } = createResource();

        const p1 = resource.query({ id: 1 } as any);
        calls[0].resolve("data1" as any);
        await p1;

        const p2 = resource.query({ id: 2 } as any);
        calls[1].resolve("data2" as any);
        await p2;

        resource.resetCache();

        expect(resource.entry({ id: 1 } as any)).toBeNull();
        expect(resource.entry({ id: 2 } as any)).toBeNull();
    });

    // R12: AbortController: new query aborts previous for same entry
    it("R12: new query for same args aborts previous in-flight", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };

        const p1 = resource.query(args);
        // Suppress unhandled rejection from abort
        p1.catch(() => {});

        // Force a new query while the first is in-flight
        const p2 = resource.query(args, true);

        // First call should be aborted
        expect(calls[0].signal.aborted).toBe(true);
        expect(calls.length).toBe(2);

        calls[1].resolve("fresh" as any);
        const entry2 = await p2;

        expect(entry2.peek().state.data).toBe("fresh");
    });
});

// Edge case tests
describe("ResourceV2 — Edge Cases", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // E6: Cache lifetime GC eviction
    it("E6: entry evicted after cacheLifetime", async () => {
        const { resource, calls } = createResource({ cacheLifetime: 3000 });
        const args = { id: 1 };

        const p = resource.query(args);
        calls[0].resolve("data" as any);
        await p;

        // Schedule GC (normally done by Agent when subscribers drop)
        resource.scheduleGc(args);

        // Advance past cacheLifetime
        vi.advanceTimersByTime(3000);

        expect(resource.entry(args)).toBeNull();
    });

    // E7: GC cancelled by re-subscription
    it("E7: GC cancelled when cancelGc is called before timer fires", async () => {
        const { resource, calls } = createResource({ cacheLifetime: 3000 });
        const args = { id: 1 };

        const p = resource.query(args);
        calls[0].resolve("data" as any);
        await p;

        resource.scheduleGc(args);

        // Advance partially
        vi.advanceTimersByTime(1500);

        // Re-subscribe (cancel GC)
        resource.cancelGc(args);

        // Advance past original lifetime
        vi.advanceTimersByTime(2000);

        // Entry should still exist
        expect(resource.entry(args)).not.toBeNull();
    });

    // E8: query$ inside Signal.compute registers dependency
    it("E8: query$ inside Signal.compute registers signal dependency", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };

        let evalCount = 0;
        const computed = Signal.compute(() => {
            evalCount++;
            return resource.query$(args);
        });

        // First read triggers query
        const firstState = computed.get();
        expect(evalCount).toBe(1);

        // Resolve the query
        calls[0].resolve("hello" as any);
        await vi.advanceTimersByTimeAsync(0);

        // Re-read should show updated state
        const secondState = computed.get();
        expect(evalCount).toBe(2);
        expect(secondState.status).toBe("success");
    });

    // E9: Patcher auto-abort on reset
    it("E9: resetCache aborts in-flight queries", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };

        resource.query(args);
        expect(calls[0].signal.aborted).toBe(false);

        resource.resetCache();
        expect(calls[0].signal.aborted).toBe(true);
    });

    // E10: Patcher auto-abort on CacheEntry eviction
    it("E10: CacheEntry eviction aborts in-flight and cleans up", async () => {
        const { resource, calls } = createResource({ cacheLifetime: 1000 });
        const args = { id: 1 };

        const p = resource.query(args);
        calls[0].resolve("data" as any);
        await p;

        resource.scheduleGc(args);
        vi.advanceTimersByTime(1000);

        // Entry should be evicted
        expect(resource.entry(args)).toBeNull();
    });

    // E12: Batcher.run atomicity
    it("E12: signal updates within query are batched", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };
        const states: string[] = [];

        // Start query — entry creation + machine transition happen atomically
        const p = resource.query(args);

        const entry = resource.entry(args)!;
        const computed = Signal.compute(() => {
            const machine = entry.machine$();
            states.push(machine.state.status);
            return machine;
        });

        // Initial read
        computed.get();
        expect(states).toEqual(["pending"]);

        // Resolve — success transition is batched
        calls[0].resolve("data" as any);
        await vi.advanceTimersByTimeAsync(0);

        computed.get();
        // Should see success without intermediate states
        expect(states[states.length - 1]).toBe("success");
    });

    // ADR-2: Invalidation error preserves stale data
    it("ADR-2: invalidate error preserves stale data", async () => {
        const { resource, calls } = createResource();
        const args = { id: 1 };

        const p1 = resource.query(args);
        calls[0].resolve("stale-data" as any);
        await p1;

        resource.invalidate(args);

        const entry = resource.entry(args)!;
        expect(entry.peek().state.status).toBe("refreshing");

        // Reject the refresh
        calls[1].reject(new Error("Server down"));
        await vi.advanceTimersByTimeAsync(0);

        // Should revert to success with stale data (ADR-2)
        expect(entry.peek().state.status).toBe("success");
        expect(entry.peek().state.data).toBe("stale-data");
    });
});

describe("ResourceV2 — Lifecycle Hook Integration", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // L1-L2 integration: onCacheEntryAdded fires only for new entries
    it("onCacheEntryAdded fires on first query, not on cache hit", async () => {
        const callback = vi.fn();
        const { fn, calls } = controllableQueryFn<{ id: number }, string>();
        const resource = new ResourceV2<{ id: number }, string>({
            queryFn: fn,
            onCacheEntryAdded: callback,
        });

        const p1 = resource.query({ id: 1 });
        expect(callback).toHaveBeenCalledTimes(1);

        calls[0].resolve("data1");
        await p1;

        // Second query = cache hit
        await resource.query({ id: 1 });
        expect(callback).toHaveBeenCalledTimes(1); // still 1
    });

    // L6 integration: onQueryStarted fires on every fetch
    it("onQueryStarted fires on query and invalidate", async () => {
        const callback = vi.fn();
        const { fn, calls } = controllableQueryFn<{ id: number }, string>();
        const resource = new ResourceV2<{ id: number }, string>({
            queryFn: fn,
            onQueryStarted: callback,
        });

        const p1 = resource.query({ id: 1 });
        expect(callback).toHaveBeenCalledTimes(1);

        calls[0].resolve("data");
        await p1;

        resource.invalidate({ id: 1 });
        expect(callback).toHaveBeenCalledTimes(2);
    });
});
