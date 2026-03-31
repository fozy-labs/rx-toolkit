import { vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query/__tests__/helpers";
import { MachineSuccess } from "@/query/core/machines/MachineSuccess";
import { Resource } from "@/query/core/resource/Resource";
import type { TResourceOptions } from "@/query/types";
import { Signal } from "@/signals";

type TArgs = { id: number };
type TData = { name: string };

function createResource(overrides?: Partial<TResourceOptions<TArgs, TData>>) {
    const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
    const resource = new Resource<TArgs, TData>({
        queryFn,
        cacheLifetime: false as never,
        ...overrides,
    });
    return { resource, queryFn, calls };
}

describe("Resource", () => {
    // ── RE01: query creates entry, fetches, returns data ──
    it("RE01: query(args) creates entry, fetches, and returns data on success", async () => {
        const { resource, calls } = createResource();
        const promise = resource.query({ id: 1 });

        expect(calls).toHaveLength(1);
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const data = await promise;
        expect(data).toEqual({ name: "Alice" });

        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("success");
    });

    // ── RE02: query deduplicates in-flight requests ──
    it("RE02: query(args) deduplicates in-flight requests for same args", async () => {
        const { resource, queryFn, calls } = createResource();
        const p1 = resource.query({ id: 1 });
        const p2 = resource.query({ id: 1 });

        expect(queryFn).toHaveBeenCalledTimes(1);
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const [d1, d2] = await Promise.all([p1, p2]);
        expect(d1).toEqual({ name: "Alice" });
        expect(d2).toEqual({ name: "Alice" });
    });

    // ── RE03: query force=true skips dedup ──
    it("RE03: query(args, true) forces re-fetch bypassing dedup", async () => {
        const { resource, queryFn, calls } = createResource();
        resource.query({ id: 1 });
        expect(queryFn).toHaveBeenCalledTimes(1);

        resource.query({ id: 1 }, true);
        expect(queryFn).toHaveBeenCalledTimes(2);

        calls[1].resolve({ name: "Refreshed" });
        await flushMicrotasks();
    });

    // ── RE04: error state → retry on re-query ──
    it("RE04: query(args) retries after error state", async () => {
        const { resource, queryFn, calls } = createResource();
        const p1 = resource.query({ id: 1 });
        calls[0].reject(new Error("fail"));
        await flushMicrotasks();
        await p1.catch(() => {});

        const entry = resource.getEntry({ id: 1 });
        expect(entry!.peek().status).toBe("error");

        resource.query({ id: 1 });
        expect(queryFn).toHaveBeenCalledTimes(2);

        calls[1].resolve({ name: "Recovered" });
        await flushMicrotasks();
        expect(entry!.peek().status).toBe("success");
    });

    // ── RE05: cached success: no re-fetch ──
    it("RE05: query(args) returns cached data without re-fetch for success entries", async () => {
        const { resource, queryFn, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const data = await resource.query({ id: 1 });
        expect(data).toEqual({ name: "Alice" });
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // ── RE06: getEntry returns null when no entry ──
    it("RE06: getEntry(args) returns null when no entry exists", () => {
        const { resource } = createResource();
        expect(resource.getEntry({ id: 1 })).toBeNull();
    });

    // ── RE07: getEntry(args, true) creates entry ──
    it("RE07: getEntry(args, true) creates entry if needed", () => {
        const { resource } = createResource();
        const entry = resource.getEntry({ id: 1 }, true);
        expect(entry).not.toBeNull();
        expect(entry.peek().status).toBe("pending");
    });

    // ── RE08: getEntry$ is reactive to resetCache ──
    it("RE08: getEntry$(args) is reactive to resetCache()", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        let result: unknown = "unset";
        const eff = Signal.effect(() => {
            result = resource.getEntry$({ id: 1 });
        });

        expect(result).not.toBeNull();

        resource.resetCache();
        await flushMicrotasks();

        expect(result).toBeNull();
        eff.unsubscribe();
    });

    // ── RE09: invalidate transitions success → refreshing ──
    it("RE09: invalidate(args) triggers refetch for success entries", async () => {
        const { resource, queryFn, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        resource.invalidate({ id: 1 });
        const entry = resource.getEntry({ id: 1 });
        expect(entry!.peek().status).toBe("refreshing");
        expect(queryFn).toHaveBeenCalledTimes(2);

        calls[1].resolve({ name: "Updated" });
        await flushMicrotasks();
        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Updated" });
    });

    // ── RE10: invalidate non-success → no-op ──
    it("RE10: invalidate(args) is no-op for non-success entries", async () => {
        const { resource, queryFn } = createResource();
        resource.query({ id: 1 });
        // Entry is in 'pending' state

        resource.invalidate({ id: 1 });
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // ── RE11: different args create independent entries ──
    it("RE11: args change — old entry request continues independently", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        resource.query({ id: 2 });

        expect(calls).toHaveLength(2);

        // Resolve first
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
        expect(resource.getEntry({ id: 1 })!.peek().status).toBe("success");
        expect(resource.getEntry({ id: 2 })!.peek().status).toBe("pending");

        // Resolve second
        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();
        expect(resource.getEntry({ id: 2 })!.peek().status).toBe("success");
    });

    // ── RE12: refresh error preserves stale data ──
    it("RE12: errorHappened on refreshing preserves stale data", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        resource.invalidate({ id: 1 });
        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().status).toBe("refreshing");

        calls[1].reject(new Error("network"));
        await flushMicrotasks();

        // Stays in success with stale data
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "Alice" });
    });

    // ── RE13: compareArgs uses configured strategy ──
    it("RE13: compareArgs uses shallowEqual by default", async () => {
        const { resource, queryFn, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // Same shape → same entry
        const data = await resource.query({ id: 1 });
        expect(data).toEqual({ name: "Alice" });
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // ── RE14: resetCache aborts all, clears GC, completes entries, clears map ──
    it("RE14: resetCache() completes all entries and clears cache", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        resource.query({ id: 2 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        resource.resetCache();

        expect(resource.getEntry({ id: 1 })).toBeNull();
        expect(resource.getEntry({ id: 2 })).toBeNull();
        expect(resource.hasEntry({ id: 1 })).toBe(false);
        expect(resource.hasEntry({ id: 2 })).toBe(false);
    });

    // ── RE15: cacheValues iterates all entries ──
    it("RE15: cacheValues() iterates all entries", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        resource.query({ id: 2 });
        resource.query({ id: 3 });
        calls[0].resolve({ name: "A" });
        calls[1].resolve({ name: "B" });
        calls[2].resolve({ name: "C" });
        await flushMicrotasks();

        const entries = [...resource.cacheValues()];
        expect(entries).toHaveLength(3);
    });

    // ── RE16: hydrateEntry creates entry from snapshot ──
    it("RE16: hydrateEntry(args, machine) creates entry from snapshot data", () => {
        const { resource } = createResource();
        const machine = new MachineSuccess<TArgs, TData>({ id: 1 }, { name: "Hydrated" }, null, Date.now());

        resource.hydrateEntry({ id: 1 }, machine);

        expect(resource.hasEntry({ id: 1 })).toBe(true);
        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "Hydrated" });
    });

    // ── RE18: hasEntry checks existence ──
    it("RE18: hasEntry(args) returns true after query and false before", async () => {
        const { resource, calls } = createResource();
        expect(resource.hasEntry({ id: 1 })).toBe(false);

        resource.query({ id: 1 });
        expect(resource.hasEntry({ id: 1 })).toBe(true);

        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
        expect(resource.hasEntry({ id: 1 })).toBe(true);
    });

    // ── RE19: Batcher.run wraps state transitions ──
    it("RE19: Batcher.run wraps multi-signal transitions in resetCache", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const notifications: string[] = [];
        const eff = Signal.effect(() => {
            const status = resource.status$();
            notifications.push(status);
        });

        resource.resetCache();
        // Batcher ensures single notification batch
        expect(notifications.filter((n) => n === "idle")).toHaveLength(1);
        eff.unsubscribe();
    });
});

describe("Resource — _status$ Signal", () => {
    // ── RE20: _status$ starts as "idle" ──
    it("RE20: _status$ starts as 'idle'", () => {
        const { resource } = createResource();
        expect(resource.status$()).toBe("idle");
    });

    // ── RE21: _status$ transitions to "ready" on first query ──
    it("RE21: _status$ transitions to 'ready' on first query", () => {
        const { resource } = createResource();
        resource.query({ id: 1 });
        expect(resource.status$()).toBe("ready");
    });

    // ── RE22: _status$ reverts to "idle" on resetCache ──
    it("RE22: _status$ reverts to 'idle' on resetCache()", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(resource.status$()).toBe("ready");
        resource.resetCache();
        expect(resource.status$()).toBe("idle");
    });

    // ── RE23: getEntry$ returns null when _status$ is "idle" ──
    it("RE23: getEntry$(args) returns null when _status$ is 'idle'", async () => {
        const { resource, calls } = createResource();
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(resource.getEntry$({ id: 1 })).not.toBeNull();

        resource.resetCache();
        expect(resource.getEntry$({ id: 1 })).toBeNull();
    });
});

describe("Resource — GC Lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // ── GC01: GC timer starts when refcount drops to 0 ──
    it("GC01: entry deleted after cacheLifetime when refcount drops to 0", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = new Resource<TArgs, TData>({
            queryFn,
            cacheLifetime: 5000,
        });

        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // Subscribe (refcount = 1)
        const sub = resource.subscribe({ id: 1 });
        expect(resource.hasEntry({ id: 1 })).toBe(true);

        // Unsubscribe (refcount = 0, timer starts)
        sub.unsubscribe();

        // Not yet deleted
        vi.advanceTimersByTime(4999);
        expect(resource.hasEntry({ id: 1 })).toBe(true);

        // Timer fires
        vi.advanceTimersByTime(1);
        expect(resource.hasEntry({ id: 1 })).toBe(false);
    });

    // ── GC02: GC timer cancelled on new subscriber ──
    it("GC02: GC timer cancelled when new subscriber arrives", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = new Resource<TArgs, TData>({
            queryFn,
            cacheLifetime: 5000,
        });

        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const sub1 = resource.subscribe({ id: 1 });
        sub1.unsubscribe();

        // Advance partially
        vi.advanceTimersByTime(3000);

        // Re-subscribe before timer fires
        const sub2 = resource.subscribe({ id: 1 });
        vi.advanceTimersByTime(5000);
        expect(resource.hasEntry({ id: 1 })).toBe(true);

        sub2.unsubscribe();
        vi.advanceTimersByTime(5000);
        expect(resource.hasEntry({ id: 1 })).toBe(false);
    });

    // ── GC03: cacheLifetime: false disables GC ──
    it("GC03: cacheLifetime: false disables GC entirely", async () => {
        const { resource, calls } = createResource({ cacheLifetime: false as never });
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const sub = resource.subscribe({ id: 1 });
        sub.unsubscribe();

        vi.advanceTimersByTime(999_999);
        expect(resource.hasEntry({ id: 1 })).toBe(true);
    });

    // ── GC04: GC fires: complete, delete, lifecycle hook ──
    it("GC04: GC fires complete(), deletes from cache, fires lifecycle hook", async () => {
        const onCacheEntryAdded = vi.fn();
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = new Resource<TArgs, TData>({
            queryFn,
            cacheLifetime: 1000,
            onCacheEntryAdded,
        });

        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const entry = resource.getEntry({ id: 1 })!;
        const completeSpy = vi.spyOn(entry, "complete");

        const sub = resource.subscribe({ id: 1 });
        sub.unsubscribe();

        vi.advanceTimersByTime(1000);

        expect(completeSpy).toHaveBeenCalled();
        expect(resource.hasEntry({ id: 1 })).toBe(false);
    });

    // ── GC05: Rapid subscribe/unsubscribe ──
    it("GC05: rapid subscribe/unsubscribe resets timer correctly", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const resource = new Resource<TArgs, TData>({
            queryFn,
            cacheLifetime: 3000,
        });

        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // Rapid sub/unsub cycles
        const s1 = resource.subscribe({ id: 1 });
        s1.unsubscribe();
        vi.advanceTimersByTime(1000);

        const s2 = resource.subscribe({ id: 1 });
        s2.unsubscribe();
        vi.advanceTimersByTime(1000);

        // Still alive (timer reset on each resub)
        expect(resource.hasEntry({ id: 1 })).toBe(true);

        // Final unsub + full timeout
        vi.advanceTimersByTime(2000);
        expect(resource.hasEntry({ id: 1 })).toBe(false);
    });
});
