import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { createApi } from "@/query-v2/api/createApi";

type TArgs = { id: number };
type TData = { name: string; value?: number };

function createTestApi() {
    const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
    const api = createApi();
    const resource = api.createResourceV2<TArgs, TData>({
        key: "items",
        queryFn,
        cacheLifetime: false as never,
    });
    return { api, resource, queryFn, calls };
}

describe("Integration: optimistic-updates", () => {
    // ── INT07: Optimistic update + rollback via entry.createPatch ──
    it("INT07: createPatch applies optimistic update, abort rolls back to original", async () => {
        const { resource, calls } = createTestApi();

        // Fetch data first
        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Original", value: 10 });
        await flushMicrotasks();
        await promise;

        // Get entry and apply optimistic patch
        const entry = resource.getEntry({ id: 1 })!;
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "Original", value: 10 });

        const handle = entry.createPatch((draft) => {
            draft.name = "Optimistic";
            draft.value = 99;
        });
        expect(handle).not.toBeNull();

        // Data should show optimistic value
        expect(entry.peek().data).toEqual({ name: "Optimistic", value: 99 });

        // Abort → data should roll back to original
        handle!.abort();

        expect(entry.peek().data).toEqual({ name: "Original", value: 10 });
        expect(entry.peek().status).toBe("success");
    });

    // ── INT08: Optimistic update + commit ──
    it("INT08: createPatch applies optimistic update, commit makes it permanent", async () => {
        const { resource, calls } = createTestApi();

        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Original", value: 10 });
        await flushMicrotasks();
        await promise;

        const entry = resource.getEntry({ id: 1 })!;

        const handle = entry.createPatch((draft) => {
            draft.name = "Committed";
        });
        expect(handle).not.toBeNull();

        // Data shows optimistic value
        expect(entry.peek().data!.name).toBe("Committed");

        // Commit the patch
        handle!.commit();

        // Data should still show committed value
        expect(entry.peek().data!.name).toBe("Committed");
        expect(entry.peek().status).toBe("success");
    });

    // ── INT09: Consistency violation → auto-invalidation → fresh data ──
    it("INT09: out-of-order abort triggers consistency violation and auto-invalidation", async () => {
        const { resource, queryFn, calls } = createTestApi();

        const promise = resource.query({ id: 1 });
        calls[0].resolve({ name: "Original", value: 10 });
        await flushMicrotasks();
        await promise;

        const entry = resource.getEntry({ id: 1 })!;

        // Apply two patches
        const handle1 = entry.createPatch((draft) => {
            draft.name = "Patch1";
        });
        const handle2 = entry.createPatch((draft) => {
            draft.value = 99;
        });

        expect(handle1).not.toBeNull();
        expect(handle2).not.toBeNull();

        // Commit patch2 first (out-of-order relative to patch1)
        handle2!.commit();

        // Now abort patch1 — this is out-of-order which causes consistency violation
        handle1!.abort();

        // Auto-invalidation should have triggered a refetch
        // (entry transitions to refreshing → new queryFn call)
        const callCount = (queryFn as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
        expect(callCount).toBeGreaterThan(1);

        // Resolve the refetch
        calls[calls.length - 1].resolve({ name: "Fresh", value: 42 });
        await flushMicrotasks();

        // Entry should have fresh data
        expect(entry.peek().status).toBe("success");
        expect(entry.peek().data).toEqual({ name: "Fresh", value: 42 });
    });
});
