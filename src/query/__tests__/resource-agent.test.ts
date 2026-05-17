import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { SKIP } from "@/query/constants";
import { Resource } from "@/query/core/resource/Resource";
import { stableStringify } from "@/query/lib/stableStringify";
import type { IResourceConfig, TResourceAgentState } from "@/query/types";
import { Signal } from "@/signals/signals/Signal";

// ==================== Helpers ====================

function createResource<TArgs = void, TData = string>(
    overrides: Partial<IResourceConfig<TArgs, TData>> & {
        queryFn: IResourceConfig<TArgs, TData>["queryFn"];
    },
) {
    return new Resource<TArgs, TData>({
        retentionTime: false,
        serializeArgs: stableStringify as (args: TArgs) => string,
        ...overrides,
    });
}

// Collect state via reactive effect — tracks cleanup automatically
const _effects: Array<{ unsubscribe: () => void }> = [];

function observe<TArgs, TData>(agent: { state$: () => TResourceAgentState<TArgs, TData> }) {
    let latest!: TResourceAgentState<TArgs, TData>;
    const eff = Signal.effect(() => {
        latest = agent.state$();
    });
    _effects.push(eff);
    return { get: () => latest };
}

afterEach(() => {
    // Always unsubscribe effects BEFORE any resource.reset() to avoid
    // infinite reactive loop in getEntry$(args, true) re-creation.
    while (_effects.length) _effects.pop()!.unsubscribe();
});

// ==================== 1. start(args) — state transitions ====================

describe("ResourceAgent.start(args)", () => {
    it("idle → pending → success", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const agent = resource.createAgent();
        const s = observe(agent);

        expect(s.get().status).toBe("idle");

        agent.set(1);
        agent.start();
        expect(s.get().status).toBe("pending");

        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("d-1");
        expect(s.get().args).toBe(1);
    });
});

// ==================== 2. set(args) — lazy, no fetch ====================

describe("ResourceAgent.set(args)", () => {
    it("does not start a fetch (lazy)", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });
        const agent = resource.createAgent();
        observe(agent);

        agent.set(1);
        await flushMicrotasks();
        expect(queryFn).not.toHaveBeenCalled();
    });

    it("reflects existing cache entry", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        resource.trigger(1);
        await flushMicrotasks();

        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("d-1");
    });
});

// ==================== 3. start(SKIP) — reset to idle ====================

describe("ResourceAgent.start(SKIP)", () => {
    it("resets to idle", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");

        agent.set(SKIP);
        expect(s.get().status).toBe("idle");
        expect(s.get().data).toBeNull();
        expect(s.get().args).toBeNull();
    });

    it("clears previous entry — no SWR after SKIP", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        agent.set(SKIP);

        // set(2) after SKIP should be "pending" (no stale A data)
        agent.set(2);
        expect(s.get().status).toBe("pending");
        expect(s.get().data).toBeNull();
    });
});

// ==================== 4. SWR on args change ====================

describe("ResourceAgent SWR", () => {
    it("stale data from A while B loads (refreshing status)", async () => {
        let resolveB!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;
                if (callCount === 1) return Promise.resolve("data-A");
                return new Promise((r) => {
                    resolveB = r;
                });
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("data-A");

        agent.set(2);
        expect(s.get().status).toBe("refreshing");
        expect(s.get().data).toBe("data-A");

        resolveB("data-B");
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-B");
    });

    it("keeps stale data across multiple arg changes before the middle request settles", async () => {
        let resolveB!: (v: string) => void;
        let resolveC!: (v: string) => void;
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;

                if (callCount === 1) return Promise.resolve("data-A");

                if (callCount === 2) {
                    return new Promise((resolve) => {
                        resolveB = resolve;
                    });
                }

                return new Promise((resolve) => {
                    resolveC = resolve;
                });
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-A");

        agent.set(2);
        expect(s.get().status).toBe("refreshing");
        expect(s.get().data).toBe("data-A");

        agent.set(3);
        expect(s.get().status).toBe("refreshing");
        expect(s.get().data).toBe("data-A");

        resolveC("data-C");
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-C");

        resolveB("data-B");
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("data-C");
    });
});

// ==================== 5. Error + previous data ====================

describe("ResourceAgent error + previous data", () => {
    it("on error, stale data from previous entry is preserved", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async (_n: number) => {
                callCount++;
                if (callCount === 1) return "data-A";
                throw new Error("fail");
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("data-A");

        agent.set(2);
        await flushMicrotasks();
        expect(s.get().status).toBe("error");
        expect(s.get().data).toBe("data-A");
        expect(s.get().error).toBeInstanceOf(Error);
    });

    it("error field tracks the most recent error", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("err-1");
                return "ok";
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().error).toBeInstanceOf(Error);
        expect((s.get().error as Error).message).toBe("err-1");
    });
});

// ==================== 6. retry() / refresh() delegation ====================

describe("ResourceAgent.retry() / .refresh()", () => {
    it("retry re-executes the failed query", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail");
                return "recovered";
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("error");

        agent.retry();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("recovered");
    });

    it("refresh triggers background refetch", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `d-${callCount}`;
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("d-1");

        agent.refresh();
        expect(s.get().status).toBe("refreshing");

        await flushMicrotasks();
        expect(s.get().data).toBe("d-2");
    });

    it("retry/refresh are no-ops on idle agent", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const agent = resource.createAgent();
        expect(() => agent.retry()).not.toThrow();
        expect(() => agent.refresh()).not.toThrow();
    });
});

// ==================== 7. dispose (effect cleanup) ====================

describe("ResourceAgent dispose", () => {
    it("stops tracking after effect is unsubscribed", async () => {
        const resource = createResource<number, string>({ queryFn: async (n: number) => `d-${n}` });
        const agent = resource.createAgent();
        const statuses: string[] = [];
        const eff = Signal.effect(() => {
            statuses.push(agent.state$().status);
        });
        _effects.push(eff); // still pushed for afterEach safety

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        const countBefore = statuses.length;

        eff.unsubscribe();

        agent.set(2);
        await flushMicrotasks();
        expect(statuses.length).toBe(countBefore);
    });
});

// ==================== 8. resetAll on active agent ====================

describe("ResourceAgent reset() on active agent (regression)", () => {
    it("resource.reset() while agent is subscribed does not cause infinite loop", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async (n: number) => {
                callCount++;
                return `d-${n}`;
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(callCount).toBe(1);

        // reset() used to trigger an infinite reactive loop where getEntry$
        // kept recreating entries after cache clear.
        resource.reset();
        await flushMicrotasks();

        // The agent should recover to idle or re-fetch — NOT spin forever.
        // A bounded call-count check acts as the loop detector.
        expect(callCount).toBeLessThanOrEqual(3);
        expect(["idle", "pending", "success"]).toContain(s.get().status);
    });
});

// ==================== 9. set() then start() ====================

describe("ResourceAgent set() then start()", () => {
    it("transitions from lazy to eager (triggers the fetch)", async () => {
        const queryFn = vi.fn(async (n: number) => `d-${n}`);
        const resource = createResource<number, string>({ queryFn });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        await flushMicrotasks();
        expect(queryFn).not.toHaveBeenCalled();

        agent.start();
        expect(queryFn).toHaveBeenCalledTimes(1);

        await flushMicrotasks();
        expect(s.get().status).toBe("success");
        expect(s.get().data).toBe("d-1");
    });
});

// ==================== 10. Early return ====================

describe("ResourceAgent early return", () => {
    it("set() with same args is a no-op (no new fetch)", async () => {
        const queryFn = vi.fn(async () => "data");
        const resource = createResource<number, string>({ queryFn });
        const agent = resource.createAgent();
        observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(1);

        agent.set(1);
        await flushMicrotasks();
        expect(queryFn).toHaveBeenCalledTimes(1);
    });

    it("set() with same args is a no-op", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        const st1 = s.get().status;
        agent.set(1);
        expect(s.get().status).toBe(st1);
    });
});

// ==================== 11. state$ property flags ====================

describe("ResourceAgent state$ flags", () => {
    it("idle: all flags false, data/error null", () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const agent = resource.createAgent();
        const s = observe(agent);

        const st = s.get();
        expect(st.status).toBe("idle");
        expect(st.isLoading).toBe(false);
        expect(st.isInitialLoading).toBe(false);
        expect(st.isRefreshing).toBe(false);
        expect(st.isRefreshError).toBe(false);
        expect(st.isSuccess).toBe(false);
        expect(st.isError).toBe(false);
        expect(st.data).toBeNull();
        expect(st.error).toBeNull();
    });

    it("pending: isLoading=true, isInitialLoading=true", async () => {
        let resolve!: (v: string) => void;
        const resource = createResource<number, string>({
            queryFn: () =>
                new Promise((r) => {
                    resolve = r;
                }),
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        const st = s.get();
        expect(st.status).toBe("pending");
        expect(st.isLoading).toBe(true);
        expect(st.isInitialLoading).toBe(true);
        expect(st.isRefreshing).toBe(false);
        expect(st.isSuccess).toBe(false);
        expect(st.isError).toBe(false);

        resolve("done");
        await flushMicrotasks();
    });

    it("success: isSuccess=true, has data", async () => {
        const resource = createResource<number, string>({ queryFn: async () => "data" });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();

        const st = s.get();
        expect(st.status).toBe("success");
        expect(st.isSuccess).toBe(true);
        expect(st.isLoading).toBe(false);
        expect(st.isRefreshing).toBe(false);
        expect(st.isError).toBe(false);
        expect(st.data).toBe("data");
    });

    it("error: isError=true", async () => {
        const resource = createResource<number, string>({
            queryFn: async () => {
                throw new Error("boom");
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();

        const st = s.get();
        expect(st.status).toBe("error");
        expect(st.isError).toBe(true);
        expect(st.isSuccess).toBe(false);
        expect(st.isLoading).toBe(false);
        expect(st.error).toBeInstanceOf(Error);
    });

    it("refreshing: isRefreshing=true, isLoading=true, isInitialLoading=false", async () => {
        let callCount = 0;
        let resolveRefresh!: (v: string) => void;
        const resource = createResource<number, string>({
            queryFn: (_n: number) => {
                callCount++;
                if (callCount === 1) return Promise.resolve("d-1");
                return new Promise((r) => {
                    resolveRefresh = r;
                });
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().status).toBe("success");

        // Trigger SWR via args switch
        agent.set(2);
        const st = s.get();
        expect(st.status).toBe("refreshing");
        expect(st.isRefreshing).toBe(true);
        expect(st.isLoading).toBe(true);
        expect(st.isInitialLoading).toBe(false);
        expect(st.data).toBe("d-1");

        resolveRefresh("d-2");
        await flushMicrotasks();
    });

    it("state$ delegates retry() and refresh()", async () => {
        let callCount = 0;
        const resource = createResource<number, string>({
            queryFn: async () => {
                callCount++;
                return `d-${callCount}`;
            },
        });
        const agent = resource.createAgent();
        const s = observe(agent);

        agent.set(1);
        agent.start();
        await flushMicrotasks();
        expect(s.get().data).toBe("d-1");

        // Use the state object's refresh delegate
        s.get().refresh();
        await flushMicrotasks();
        expect(s.get().data).toBe("d-2");
    });
});
