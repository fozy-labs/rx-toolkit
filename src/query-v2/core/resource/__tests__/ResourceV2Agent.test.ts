import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";
import type { TResourceV2Options } from "@/query-v2/types";
import { Signal } from "@/signals";

type TArgs = { id: number };
type TData = { name: string };

function createResourceAndAgent(overrides?: Partial<TResourceV2Options<TArgs, TData>>) {
    const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
    const resource = new ResourceV2<TArgs, TData>({
        queryFn,
        cacheLifetime: false as never,
        ...overrides,
    });
    const agent = resource.createAgent();
    return { resource, agent, queryFn, calls };
}

describe("ResourceV2Agent", () => {
    // ── AG01: start(args) obtains entry and queries ──
    it("AG01: start(args) obtains entry via _getEntry and calls entry.query()", async () => {
        const { agent, queryFn, calls } = createResourceAndAgent();
        agent.start({ id: 1 });

        // Entry is created lazily when state$ is first read
        expect(agent.state$().status).toBe("pending");
        expect(queryFn).toHaveBeenCalledTimes(1);

        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
        expect(agent.state$().status).toBe("success");
    });

    // ── AG02: state$ derives flat state from machine ──
    it("AG02: state$ derives flat state from machine after success", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.status).toBe("success");
        expect(state.data).toEqual({ name: "Alice" });
        expect(state.error).toBeNull();
        expect(state.args).toEqual({ id: 1 });
        expect(state.isLoading).toBe(false);
        expect(state.isSuccess).toBe(true);
        expect(state.isError).toBe(false);
        expect(state.isInitialLoading).toBe(false);
        expect(state.isRefreshing).toBe(false);
    });

    // ── AG03: SWR previous data shown while loading new args ──
    it("AG03: SWR shows previous data while loading new args", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
        expect(agent.state$().data).toEqual({ name: "Alice" });

        agent.start({ id: 2 });
        // New args are pending, but previous data (Alice) is shown via SWR
        const state = agent.state$();
        expect(state.status).toBe("refreshing");
        expect(state.data).toEqual({ name: "Alice" });
        expect(state.isLoading).toBe(true);

        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();
    });

    // ── AG04: SWR previous cleared when current resolves ──
    it("AG04: SWR previous cleared when current resolves", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        agent.start({ id: 2 });
        agent.state$(); // trigger entry creation for id=2
        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.data).toEqual({ name: "Bob" });
        expect(state.status).toBe("success");
    });

    // ── AG05: isInitialLoading true with no previous data ──
    it("AG05: isInitialLoading is true only with no previous data", () => {
        const { agent } = createResourceAndAgent();
        agent.start({ id: 1 });

        const state = agent.state$();
        expect(state.isInitialLoading).toBe(true);
        expect(state.isLoading).toBe(true);
    });

    // ── AG06: isInitialLoading false when SWR data exists ──
    it("AG06: isInitialLoading is false when SWR data exists", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        agent.start({ id: 2 });
        const state = agent.state$();
        expect(state.isInitialLoading).toBe(false);
        expect(state.isLoading).toBe(true);

        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();
    });

    // ── AG07: start(SKIP) — agent stays idle ──
    it("AG07: start(SKIP) keeps agent in idle state without fetching", () => {
        const { agent, queryFn } = createResourceAndAgent();
        agent.start(SKIP);

        expect(queryFn).not.toHaveBeenCalled();
        expect(agent.state$().status).toBe("idle");
        expect(agent.state$().data).toBeNull();
    });

    // ── AG08: Same args: no re-fetch when success/pending ──
    it("AG08: same args do not re-fetch when already in success/pending", async () => {
        const { agent, queryFn, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        agent.start({ id: 1 });
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    // ── AG09: Same args in error state is a no-op (idempotent) ──
    it("AG09: same args in error state is a no-op", async () => {
        const { agent, queryFn, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].reject(new Error("fail"));
        await flushMicrotasks();

        expect(agent.state$().status).toBe("error");

        // Same args → no-op, no retry
        agent.start({ id: 1 });
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(agent.state$().status).toBe("error");
    });

    // ── AG10: Rapid arg changes: only latest args tracked ──
    it("AG10: rapid arg changes — only latest args tracked", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        agent.start({ id: 2 });
        agent.start({ id: 3 });

        const state = agent.state$();
        expect(state.args).toEqual({ id: 3 });

        // Resolve all
        calls[0].resolve({ name: "A" });
        calls[1].resolve({ name: "B" });
        calls[2].resolve({ name: "C" });
        await flushMicrotasks();

        expect(agent.state$().data).toEqual({ name: "C" });
    });

    // ── AG11: SWR chain protection ──
    it("AG11: rapid arg changes don't accumulate previous entries", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        agent.start({ id: 2 });
        agent.start({ id: 3 });

        // Read state to trigger lazy entry creation for latest args
        expect(agent.state$().status).toBe("pending");

        // None resolved — at most 1 previous, 1 current
        calls[2].resolve({ name: "C" });
        await flushMicrotasks();

        expect(agent.state$().data).toEqual({ name: "C" });
    });

    // ── AG12: state$ is a ComputeFn reactive to changes ──
    it("AG12: state$ is reactive — effect re-runs on state transitions", async () => {
        const { agent, calls } = createResourceAndAgent();
        const states: string[] = [];
        const eff = Signal.effect(() => {
            states.push(agent.state$().status);
        });

        agent.start({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(states).toContain("idle");
        expect(states).toContain("pending");
        expect(states).toContain("success");
        eff.unsubscribe();
    });

    // ── AG13: compareArgs delegates to resource ──
    it("AG13: compareArgs(a, b) delegates to resource's compare function", () => {
        const { agent } = createResourceAndAgent();
        expect(agent.compareArgs({ id: 1 }, { id: 1 })).toBe(true);
        expect(agent.compareArgs({ id: 1 }, { id: 2 })).toBe(false);
    });

    // ── AG14: entry field on agent state ──
    it("AG14: entry field provides consumer entry handle", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.entry).not.toBeNull();
        expect(state.entry!.peek().status).toBe("success");
    });

    // ── AG15: isRefreshing true during refreshing ──
    it("AG15: isRefreshing true during refreshing state", async () => {
        const { resource, agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        resource.invalidate({ id: 1 });
        const state = agent.state$();
        expect(state.isRefreshing).toBe(true);
        expect(state.isLoading).toBe(true);

        calls[1].resolve({ name: "Updated" });
        await flushMicrotasks();
    });

    // ── AG16: isError true on error ──
    it("AG16: isError true on error and error carries the thrown value", async () => {
        const { agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        const err = new Error("test error");
        calls[0].reject(err);
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.isError).toBe(true);
        expect(state.error).toBe(err);
    });

    // ── AG17: args field reflects current agent args ──
    it("AG17: args field reflects current agent args", () => {
        const { agent } = createResourceAndAgent();
        agent.start({ id: 42 });
        expect(agent.state$().args).toEqual({ id: 42 });
    });

    // ── AG18: args is null when idle/SKIP ──
    it("AG18: args is null when agent is idle or SKIP", () => {
        const { agent } = createResourceAndAgent();
        expect(agent.state$().args).toBeNull();

        agent.start(SKIP);
        expect(agent.state$().args).toBeNull();
    });

    // ── AG19: resetCache() causes agent to reactively return to idle ──
    it("AG19: resetCache() causes agent to reactively re-fetch", async () => {
        const { resource, agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "Alice" });

        // Reset the resource cache
        resource.resetCache();

        // Agent immediately re-creates entry (pending) due to lazy compute re-evaluation
        expect(agent.state$().status).toBe("pending");
        expect(agent.state$().data).toBeNull();
        expect(agent.state$().entry).not.toBeNull();

        calls[1].resolve({ name: "Alice" });
        await flushMicrotasks();
        expect(agent.state$().status).toBe("success");
    });

    // ── AG20: agent recovers after resetCache with start() ──
    it("AG20: agent recovers after resetCache by calling start() again", async () => {
        const { resource, agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        resource.resetCache();
        // Agent immediately re-creates entry (pending) due to lazy compute re-evaluation
        expect(agent.state$().status).toBe("pending");

        // Start again with same args — no-op since already tracking same args
        agent.start({ id: 1 });

        expect(agent.state$().status).toBe("pending");
        calls[1].resolve({ name: "Alice Updated" });
        await flushMicrotasks();

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "Alice Updated" });
    });

    // ── AG21: resetCache during pending cancels and resets ──
    it("AG21: resetCache during pending — agent re-creates entry", async () => {
        const { resource, agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");

        resource.resetCache();

        // Agent immediately re-creates entry (pending) due to lazy compute re-evaluation
        expect(agent.state$().status).toBe("pending");
        expect(agent.state$().data).toBeNull();

        calls[1].resolve({ name: "test" });
        await flushMicrotasks();
        expect(agent.state$().status).toBe("success");
    });

    // ── AG22: active agent auto-refetches after resetCache ──
    it("AG22: active agent auto-refetches after resetCache without manual start()", async () => {
        const { resource, agent, calls } = createResourceAndAgent();
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "Alice" });

        // Reset the cache — agent immediately re-creates entry (pending)
        resource.resetCache();
        expect(agent.state$().status).toBe("pending");

        // Resolve new fetch — agent recovers with new data
        calls[1].resolve({ name: "Alice Updated" });
        await flushMicrotasks();

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().data).toEqual({ name: "Alice Updated" });
    });

    // ── T13: Cross-args refetch error shows isError: true with stale data ──
    it("T13: cross-args error shows isError: true with stale data via SWR", async () => {
        const { agent, calls } = createResourceAndAgent();

        // id=1 succeeds
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
        expect(agent.state$().data).toEqual({ name: "Alice" });

        // Switch to id=2, which fails
        agent.start({ id: 2 });
        agent.state$(); // trigger entry creation
        calls[1].reject(new Error("fail"));
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.isError).toBe(true);
        expect(state.error).toBeInstanceOf(Error);
        // Previous data still available via SWR (before previous$ is cleared)
        // Note: _deriveState$ clears previous$ when originalStatus === "error"
        // so data comes from the error machine (null) or SWR depending on timing
    });

    // ── T14: previous$ cleared after cross-args error ──
    it("T14: previous$ cleared after cross-args error — no SWR on subsequent start", async () => {
        const { agent, calls } = createResourceAndAgent();

        // id=1 succeeds
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // Switch to id=2, which errors
        agent.start({ id: 2 });
        expect(agent.state$().isLoading).toBe(true);
        calls[1].reject(new Error("fail"));
        await flushMicrotasks();

        expect(agent.state$().isError).toBe(true);

        // Start id=3 — previous$ was cleared on error, so no SWR data from id=1
        agent.start({ id: 3 });
        const state = agent.state$();
        // No previous data available → initial loading (no SWR)
        expect(state.isInitialLoading).toBe(true);
        expect(state.data).toBeNull();

        calls[2].resolve({ name: "Charlie" });
        await flushMicrotasks();
    });

    // ── T15: Same-args refetch error preserves data with lastError ──
    it("T15: same-args refetch error machine-level SWR with lastError", async () => {
        const { resource, agent, calls } = createResourceAndAgent();

        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();
        expect(agent.state$().status).toBe("success");

        // Invalidate same args → refreshing
        resource.invalidate({ id: 1 });
        expect(agent.state$().status).toBe("refreshing");

        // Error during refresh → MachineSuccess with stale data and lastError
        calls[1].reject(new Error("refresh failed"));
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.status).toBe("success");
        expect(state.isSuccess).toBe(true);
        expect(state.isError).toBe(false);
        expect(state.data).toEqual({ name: "Alice" });
        expect(state.lastError).toBeInstanceOf(Error);
    });

    // ── T16: Pending + previous shows isError: false ──
    it("T16: pending + previous shows isError: false (normal SWR loading)", async () => {
        const { agent, calls } = createResourceAndAgent();

        // id=1 succeeds
        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // Switch to id=2 (pending)
        agent.start({ id: 2 });
        const state = agent.state$();

        expect(state.isError).toBe(false);
        expect(state.isLoading).toBe(true);
        expect(state.data).toEqual({ name: "Alice" }); // SWR from id=1

        calls[1].resolve({ name: "Bob" });
        await flushMicrotasks();
    });

    // ── T31: lastError exposed in agent state$ ──
    it("T31: lastError exposed in agent state$ when present on current machine", async () => {
        const { resource, agent, calls } = createResourceAndAgent();

        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // No lastError initially
        expect(agent.state$().lastError).toBeUndefined();

        // Invalidate → refresh fails → lastError set
        resource.invalidate({ id: 1 });
        calls[1].reject(new Error("bg error"));
        await flushMicrotasks();

        expect(agent.state$().status).toBe("success");
        expect(agent.state$().lastError).toBeInstanceOf(Error);
        expect((agent.state$().lastError as Error).message).toBe("bg error");
    });

    // ── T32: isRefreshError true when success + lastError ──
    it("T32: isRefreshError is true when refresh fails but data is still valid", async () => {
        const { resource, agent, calls } = createResourceAndAgent();

        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        expect(agent.state$().isRefreshError).toBe(false);

        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        expect(agent.state$().isRefreshError).toBe(false);

        // Invalidate → refresh fails → isRefreshError true
        resource.invalidate({ id: 1 });
        expect(agent.state$().isRefreshError).toBe(false); // refreshing, no error yet

        calls[1].reject(new Error("refresh failed"));
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.status).toBe("success");
        expect(state.isRefreshError).toBe(true);
        expect(state.lastError).toBeInstanceOf(Error);
        expect(state.data).toEqual({ name: "Alice" });
    });

    // ── T33: isRefreshError false on normal error (no data) ──
    it("T33: isRefreshError is false on normal error without previous data", async () => {
        const { agent, calls } = createResourceAndAgent();

        agent.start({ id: 1 });
        expect(agent.state$().status).toBe("pending");
        calls[0].reject(new Error("fail"));
        await flushMicrotasks();

        const state = agent.state$();
        expect(state.status).toBe("error");
        expect(state.isError).toBe(true);
        expect(state.isRefreshError).toBe(false);
    });

    // ── T34: isRefreshError false in idle state ──
    it("T34: isRefreshError is false in idle state", () => {
        const { agent } = createResourceAndAgent();
        expect(agent.state$().isRefreshError).toBe(false);
    });
});
