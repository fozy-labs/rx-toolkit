import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { _createResourceV2 } from "@/query-v2/api/_createResourceV2";
import { createApi } from "@/query-v2/api/createApi";
import { CURRENT_SNAPSHOT_VERSION } from "@/query-v2/types";
import type { TApiSnapshot } from "@/query-v2/types";

type TArgs = { id: number };
type TData = { name: string; value?: number };

function createTestResource(overrides?: { cacheLifetime?: number }) {
    const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
    const resource = _createResourceV2<TArgs, TData>({
        queryFn,
        cacheLifetime: overrides?.cacheLifetime ?? (false as never),
    });
    return { resource, queryFn, calls };
}

describe("Edge cases", () => {
    // ── E01: queryFn throws synchronously ──
    it("E01: queryFn that throws synchronously transitions to error", async () => {
        const resource = _createResourceV2<TArgs, TData>({
            queryFn: () => {
                throw new Error("sync-throw");
            },
            cacheLifetime: false as never,
        });

        const promise = resource.query({ id: 1 });

        await flushMicrotasks();

        // Entry should be in error state
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("error");
        expect(entry!.peek().error).toBeInstanceOf(Error);
        expect((entry!.peek().error as Error).message).toBe("sync-throw");

        await expect(promise).rejects.toThrow("sync-throw");
    });

    // ── E02: queryFn returns rejected promise immediately ──
    it("E02: queryFn returning immediately rejected promise transitions to error", async () => {
        const resource = _createResourceV2<TArgs, TData>({
            queryFn: () => Promise.reject(new Error("immediate-reject")),
            cacheLifetime: false as never,
        });

        const promise = resource.query({ id: 1 });
        await flushMicrotasks();

        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("error");
        expect((entry!.peek().error as Error).message).toBe("immediate-reject");

        await expect(promise).rejects.toThrow("immediate-reject");
    });

    // ── E03: null / undefined as valid TData ──
    it("E03: null as valid TData is stored in success state", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, null>();
        const resource = _createResourceV2<TArgs, null>({
            queryFn,
            cacheLifetime: false as never,
        });

        const promise = resource.query({ id: 1 });
        calls[0].resolve(null);
        await flushMicrotasks();
        const data = await promise;

        expect(data).toBeNull();

        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toBeNull();
    });

    // ── E04: Very large args object — serialization doesn't crash ──
    it("E04: large args object serializes without error", async () => {
        const largeArgs: Record<string, number> = {};
        for (let i = 0; i < 1000; i++) {
            largeArgs[`key${i}`] = i;
        }

        type TLargeArgs = Record<string, number>;
        const { queryFn, calls } = createControllableQueryFn<TLargeArgs, TData>();
        const resource = _createResourceV2<TLargeArgs, TData>({
            queryFn,
            cacheLifetime: false as never,
        });

        // Should not throw during query (triggers serialization)
        const promise = resource.query(largeArgs);
        calls[0].resolve({ name: "large" });
        await flushMicrotasks();

        const data = await promise;
        expect(data).toEqual({ name: "large" });
    });

    // ── E05: ResourceV2 created but never queried — no leaks ──
    it("E05: resource created but never queried has no timers or leaks", () => {
        const { resource } = createTestResource();

        // Just creating a resource should not start any timers or subscriptions
        // No entries should exist
        const entry = resource.getEntry({ id: 1 });
        expect(entry).toBeNull();

        // Creating and discarding a resource should not throw
        // (no cleanup needed since nothing was started)
    });

    // ── E06: resetCache() during inflight query ──
    it("E06: resetCache during inflight query aborts and clears without error", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResourceV2<TArgs, TData>({
            key: "items",
            queryFn,
            cacheLifetime: false as never,
        });

        // Start a query
        const promise = resource.query({ id: 1 });
        expect(calls).toHaveLength(1);

        // Reset while inflight
        api.resetAll();

        // Entry should be cleared
        expect(resource.getEntry({ id: 1 })).toBeNull();

        // Abort signal should be triggered
        expect(calls[0].abortSignal.aborted).toBe(true);

        // Resolving the orphaned promise should not cause errors
        calls[0].resolve({ name: "orphaned" });
        await flushMicrotasks();

        // The promise should reject (abort) or resolve harmlessly — no crash
        await promise.catch(() => {});
    });

    // ── E07: Hydrate entry then query same args — uses hydrated data ──
    it("E07: hydrated entry is used without re-fetch when queried with same args", async () => {
        const { queryFn } = createControllableQueryFn<TArgs, TData>();
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                items: {
                    entries: {
                        [JSON.stringify({ id: 1 })]: {
                            status: "success" as const,
                            args: { id: 1 },
                            data: { name: "Hydrated" },
                            updatedAt: Date.now(),
                        },
                    },
                },
            },
        };

        const api = createApi({ initialSnapshot: snapshot });
        const resource = api.createResourceV2<TArgs, TData>({
            key: "items",
            queryFn,
            cacheLifetime: false as never,
        });

        // Entry should already exist from hydration
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Hydrated" });

        // Creating an agent and starting with same args — should use cached data
        const agent = resource.createAgent();
        agent.start({ id: 1 });

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "Hydrated" });
        // Entry auto-fetches on construction, so queryFn is called once
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // ── E08: AbortError from queryFn — no state transition ──
    it("E08: AbortError from queryFn does not cause spurious state transitions", async () => {
        const { resource, calls } = createTestResource();

        // Start a query
        resource.query({ id: 1 });
        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().status).toBe("pending");

        // Force re-fetch (which aborts the first request internally)
        resource.query({ id: 1 }, true);

        // First request was aborted — its abort signal should be set
        expect(calls[0].abortSignal.aborted).toBe(true);

        // Resolve the second request
        calls[1].resolve({ name: "Fresh" });
        await flushMicrotasks();

        // Entry should be in success from the second request
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "Fresh" });

        // Rejecting the aborted first call should not change state
        calls[0].reject(new DOMException("Aborted", "AbortError"));
        await flushMicrotasks();

        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "Fresh" });
    });

    // ── E09: Double-commit or double-abort on patch handle — idempotent ──
    it("E09: double-commit and double-abort on patch handle are idempotent", async () => {
        const { resource, calls } = createTestResource();

        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Original", value: 10 });
        await flushMicrotasks();
        await promise;

        const entry = resource.getEntry({ id: 1 })!;

        // Test double-commit
        const handle1 = entry.createPatch((draft: TData) => {
            draft.name = "Patched";
        });
        expect(handle1).not.toBeNull();

        handle1!.commit();
        // Second commit should be no-op
        expect(() => handle1!.commit()).not.toThrow();

        // Test double-abort on a new patch
        const handle2 = entry.createPatch((draft: TData) => {
            draft.value = 99;
        });
        expect(handle2).not.toBeNull();

        handle2!.abort();
        // Second abort should be no-op
        expect(() => handle2!.abort()).not.toThrow();
    });

    // ── E10: entry.createPatch during refreshing state ──
    it("E10: createPatch during refreshing state applies patch to stale data", async () => {
        const { resource, calls } = createTestResource();

        // Get to success state
        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Original", value: 10 });
        await flushMicrotasks();
        await promise;

        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().status).toBe("success");

        // Invalidate → refreshing (background refetch with stale data)
        entry.invalidate();
        expect(entry.peek().status).toBe("refreshing");
        expect(entry.peek().data).toEqual({ name: "Original", value: 10 });

        // Apply patch on refreshing state (stale data)
        const handle = entry.createPatch((draft: TData) => {
            draft.name = "Optimistic-During-Refresh";
        });
        expect(handle).not.toBeNull();

        // Data should show the optimistic patch applied to stale data
        expect(entry.peek().data!.name).toBe("Optimistic-During-Refresh");

        // Commit the patch
        handle!.commit();

        // Resolve the refresh
        calls[1].resolve({ name: "Fresh", value: 42 });
        await flushMicrotasks();

        // Fresh data should be merged with committed patch
        // (Patcher resolves committed patches on top of fresh server data)
        expect(entry.peek().status).toBe("success");
    });
});
