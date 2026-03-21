import { createApi } from "@/query-v2/api/createApi";
import { MachineError } from "@/query-v2/core/machines/MachineError";
import { MachineIdle } from "@/query-v2/core/machines/MachineIdle";
import { MachinePending } from "@/query-v2/core/machines/MachinePending";
import { MachineRefreshing } from "@/query-v2/core/machines/MachineRefreshing";
import { MachineSuccess } from "@/query-v2/core/machines/MachineSuccess";
import { Batcher, Signal } from "@/signals";

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

describe("Integration: Full Query Lifecycle", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    // Correctness Verification #1: Full lifecycle
    // createApi → createResource → query → MachineSuccess → invalidate → MachineRefreshing → resolve → fresh MachineSuccess
    it("full lifecycle: cache miss → pending → success → invalidate → refreshing → fresh success", async () => {
        const { fn, calls } = controllableQueryFn<number, { name: string }>();
        const api = createApi();
        const resource = api.createResource({
            key: "users",
            queryFn: fn,
        });

        // 1. Query triggers cache miss → Pending
        const queryPromise = resource.query(1);
        const entry = resource.entry(1)!;
        expect(entry).not.toBeNull();
        expect(entry.peek()).toBeInstanceOf(MachinePending);
        expect(entry.peek().state.status).toBe("pending");
        expect(entry.peek().state.args).toBe(1);

        // 2. Resolve → MachineSuccess
        calls[0].resolve({ name: "Alice" });
        await queryPromise;

        expect(entry.peek()).toBeInstanceOf(MachineSuccess);
        expect(entry.peek().state.status).toBe("success");
        expect(entry.peek().state.data).toEqual({ name: "Alice" });
        expect(entry.peek().state.updatedAt).toBeTypeOf("number");

        // 3. Invalidate → MachineRefreshing (stale data preserved)
        resource.invalidate(1);

        expect(entry.peek()).toBeInstanceOf(MachineRefreshing);
        expect(entry.peek().state.status).toBe("refreshing");
        expect(entry.peek().state.data).toEqual({ name: "Alice" }); // stale data

        // 4. Resolve refresh → fresh MachineSuccess
        calls[1].resolve({ name: "Alice Updated" });
        await vi.advanceTimersByTimeAsync(0);

        expect(entry.peek()).toBeInstanceOf(MachineSuccess);
        expect(entry.peek().state.status).toBe("success");
        expect(entry.peek().state.data).toEqual({ name: "Alice Updated" });
    });

    // Correctness Verification #3: Optimistic update with commit
    it("optimistic update: createPatch → verify optimistic data → commit → verify committed", async () => {
        const { fn, calls } = controllableQueryFn<number, { name: string; count: number }>();
        const api = createApi();
        const resource = api.createResource({
            key: "items",
            queryFn: fn,
        });

        // Set up initial data
        const queryPromise = resource.query(1);
        calls[0].resolve({ name: "Item", count: 0 });
        await queryPromise;

        const entry = resource.entry(1)!;
        const originalMachine = entry.peek() as MachineSuccess<{ name: string; count: number }>;
        expect(originalMachine.state.data).toEqual({ name: "Item", count: 0 });

        // Create optimistic patch
        const { machine: patchedMachine, patch } = originalMachine.createPatch((draft) => {
            draft.count = 42;
        });

        // Apply patch to entry
        entry.set(patchedMachine as any);

        // Verify optimistic data is visible
        expect(entry.peek().state.data).toEqual({ name: "Item", count: 42 });
        expect(entry.peek().state.status).toBe("success");

        // Commit the patch
        const committed = (entry.peek() as MachineSuccess<{ name: string; count: number }>).finishPatch(
            "commit",
            patch,
        );
        entry.set(committed as any);

        // Verify data persists after commit
        expect(entry.peek().state.data).toEqual({ name: "Item", count: 42 });
    });

    // Correctness Verification #3: Optimistic update with abort
    it("optimistic update: createPatch → verify optimistic data → abort → verify reverted", async () => {
        const { fn, calls } = controllableQueryFn<number, { name: string; count: number }>();
        const api = createApi();
        const resource = api.createResource({
            key: "items",
            queryFn: fn,
        });

        // Set up initial data
        const queryPromise = resource.query(1);
        calls[0].resolve({ name: "Item", count: 0 });
        await queryPromise;

        const entry = resource.entry(1)!;
        const originalMachine = entry.peek() as MachineSuccess<{ name: string; count: number }>;

        // Create optimistic patch
        const { machine: patchedMachine, patch } = originalMachine.createPatch((draft) => {
            draft.count = 99;
        });
        entry.set(patchedMachine as any);

        // Verify optimistic data is visible
        expect(entry.peek().state.data).toEqual({ name: "Item", count: 99 });

        // Abort the patch → should revert to original
        const aborted = (entry.peek() as MachineSuccess<{ name: string; count: number }>).finishPatch("abort", patch);
        entry.set(aborted as any);

        // Verify data reverted
        expect(entry.peek().state.data).toEqual({ name: "Item", count: 0 });
    });

    // Correctness Verification #5: Machine transition completeness
    describe("machine transition completeness", () => {
        it("MachineIdle → MachinePending via start()", () => {
            const idle = MachineIdle.create();
            expect(idle.state.status).toBe("idle");

            const pending = idle.start({ id: 1 });
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.state.status).toBe("pending");
            expect(pending.state.args).toEqual({ id: 1 });
        });

        it("MachineIdle.reset() returns MachineIdle", () => {
            const idle = MachineIdle.create();
            const reset = idle.reset();
            expect(reset).toBeInstanceOf(MachineIdle);
            expect(reset.state.status).toBe("idle");
        });

        it("MachinePending → MachineSuccess via successHappened()", () => {
            const pending = MachinePending.create({ id: 1 });
            const success = pending.successHappened({ name: "Alice" });
            expect(success).toBeInstanceOf(MachineSuccess);
            expect(success.state.data).toEqual({ name: "Alice" });
        });

        it("MachinePending → MachineError via errorHappened()", () => {
            const pending = MachinePending.create({ id: 1 });
            const error = pending.errorHappened(new Error("404"));
            expect(error).toBeInstanceOf(MachineError);
            expect(error.state.error.message).toBe("404");
        });

        it("MachinePending → MachineIdle via reset()", () => {
            const pending = MachinePending.create({ id: 1 });
            const idle = pending.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });

        it("MachineSuccess → MachineRefreshing via invalidate()", () => {
            const success = MachineSuccess.create("data", 1);
            const refreshing = success.invalidate();
            expect(refreshing).toBeInstanceOf(MachineRefreshing);
            expect(refreshing.state.status).toBe("refreshing");
            expect(refreshing.state.data).toBe("data");
        });

        it("MachineSuccess → MachinePending via start(newArgs)", () => {
            const success = MachineSuccess.create("data", 1);
            const pending = success.start(2);
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.state.args).toBe(2);
        });

        it("MachineSuccess → MachineIdle via reset()", () => {
            const success = MachineSuccess.create("data", 1);
            const idle = success.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });

        it("MachineRefreshing → MachineSuccess on successHappened(freshData)", () => {
            const refreshing = MachineRefreshing.create("stale", 1, Date.now());
            const success = refreshing.successHappened("fresh");
            expect(success).toBeInstanceOf(MachineSuccess);
            expect(success.state.data).toBe("fresh");
        });

        it("MachineRefreshing → MachineSuccess on errorHappened() (stale data preserved)", () => {
            const refreshing = MachineRefreshing.create("stale", 1, 1000);
            const success = refreshing.errorHappened(new Error("500"));
            expect(success).toBeInstanceOf(MachineSuccess);
            expect(success.state.data).toBe("stale");
        });

        it("MachineRefreshing → MachineIdle via reset()", () => {
            const refreshing = MachineRefreshing.create("data", 1, Date.now());
            const idle = refreshing.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });

        it("MachineError → MachinePending via retry()", () => {
            const error = MachineError.create(new Error("fail"), { id: 1 });
            const pending = error.retry();
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.state.args).toEqual({ id: 1 });
        });

        it("MachineError → MachinePending via start(args)", () => {
            const error = MachineError.create(new Error("fail"), { id: 1 });
            const pending = error.start({ id: 3 });
            expect(pending).toBeInstanceOf(MachinePending);
            expect(pending.state.args).toEqual({ id: 3 });
        });

        it("MachineError → MachineIdle via reset()", () => {
            const error = MachineError.create(new Error("fail"), { id: 1 });
            const idle = error.reset();
            expect(idle).toBeInstanceOf(MachineIdle);
        });
    });

    // Agent integration: SWR + reactivity with real signals
    it("Agent SWR with real signals: start → stale data while loading → fresh data", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi();
        const resource = api.createResource({
            key: "swr-test",
            queryFn: fn,
        });

        const agent = resource.createAgent();

        // Initial state
        expect(agent.state$().status).toBe("idle");

        // Start first query
        const p1 = agent.start(1);
        expect(agent.state$().isLoading).toBe(true);
        expect(agent.state$().isInitialLoading).toBe(true);

        calls[0].resolve("data-1");
        await p1;
        expect(agent.state$().data).toBe("data-1");
        expect(agent.state$().isLoading).toBe(false);

        // Verify reactivity with Signal.compute
        const derived = Signal.compute(() => agent.state$().data);
        expect(derived()).toBe("data-1");

        // Start new args → SWR shows stale data
        const p2 = agent.start(2);
        expect(agent.state$().data).toBe("data-1"); // SWR stale data
        expect(agent.state$().isLoading).toBe(true);
        expect(agent.state$().isInitialLoading).toBe(false);

        calls[1].resolve("data-2");
        await p2;
        expect(agent.state$().data).toBe("data-2");
        expect(derived()).toBe("data-2"); // derived signal updated
    });

    // Invalidation + error preserves stale data (ADR-2)
    it("refresh error preserves stale data and exposes refreshError on agent", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi();
        const resource = api.createResource({
            key: "refresh-err",
            queryFn: fn,
        });

        const agent = resource.createAgent();

        // Load data
        const p1 = agent.start(1);
        calls[0].resolve("original-data");
        await p1;
        expect(agent.state$().data).toBe("original-data");

        // Invalidate + error
        resource.invalidate(1);
        expect(agent.state$().status).toBe("refreshing");

        calls[1].reject(new Error("Network timeout"));
        await vi.advanceTimersByTimeAsync(0);

        // ADR-2: stale data preserved, back to success
        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toBe("original-data");
        expect(agent.state$().refreshError).toBeInstanceOf(Error);
    });

    // Query deduplication
    it("concurrent queries for same args deduplicate queryFn calls", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const api = createApi();
        const resource = api.createResource({
            key: "dedup",
            queryFn: fn,
        });

        const p1 = resource.query(1);
        const p2 = resource.query(1);

        expect(fn).toHaveBeenCalledTimes(1);

        calls[0].resolve("shared");
        const [e1, e2] = await Promise.all([p1, p2]);

        expect(e1.peek().state.data).toBe("shared");
        expect(e2.peek().state.data).toBe("shared");
    });

    // resetAll clears all resources
    it("api.resetAll() clears all resources and caches", async () => {
        const { fn: fn1, calls: calls1 } = controllableQueryFn<number, string>();
        const { fn: fn2, calls: calls2 } = controllableQueryFn<number, string>();

        const api = createApi();
        const res1 = api.createResource({ key: "r1", queryFn: fn1 });
        const res2 = api.createResource({ key: "r2", queryFn: fn2 });

        const p1 = res1.query(1);
        const p2 = res2.query(2);
        calls1[0].resolve("d1");
        calls2[0].resolve("d2");
        await p1;
        await p2;

        expect(res1.entry(1)!.peek().state.status).toBe("success");
        expect(res2.entry(2)!.peek().state.status).toBe("success");

        api.resetAll();

        expect(res1.entry(1)).toBeNull();
        expect(res2.entry(2)).toBeNull();
    });
});
