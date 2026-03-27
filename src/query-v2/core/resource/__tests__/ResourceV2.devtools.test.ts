import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import type { DevtoolsLike, DevtoolsStateLike } from "@/common/devtools";
import { createControllableQueryFn } from "@/query-v2/__tests__/helpers";
import { ResourceV2 } from "@/query-v2/core/resource/ResourceV2";
import type { IResourceV2Options } from "@/query-v2/types";

type TArgs = { id: number };
type TData = { name: string };

function createMockDevtools() {
    const entries: Record<string, { init: unknown; updates: unknown[] }> = {};
    const mockDevtools: DevtoolsLike = {
        state<T>(name: string, initState: T): DevtoolsStateLike<T> {
            entries[name] = { init: initState, updates: [] };
            return (newState: T) => {
                entries[name].updates.push(newState);
            };
        },
    };
    return { devtools: mockDevtools, entries };
}

function createResource(overrides?: Partial<IResourceV2Options<TArgs, TData>>) {
    const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
    const resource = new ResourceV2<TArgs, TData>({
        queryFn,
        cacheLifetime: false as never,
        ...overrides,
    });
    return { resource, queryFn, calls };
}

describe("ResourceV2 Devtools Integration", () => {
    // ── DT01: main state registered with resource key ──
    it("DT01: registers main devtools entry named by resource key", () => {
        const { devtools, entries } = createMockDevtools();
        createResource({ key: "users", devtools });

        expect(entries["query-v2:users"]).toBeDefined();
        expect(entries["query-v2:users"].init).toEqual({ status: "idle", data: null, error: null });
    });

    // ── DT02: main state updated on query success ──
    it("DT02: pushes main state update on query success", async () => {
        const { devtools, entries } = createMockDevtools();
        const { resource, calls } = createResource({ key: "users", devtools });

        resource.query({ id: 1 });
        await flushMicrotasks();

        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const updates = entries["query-v2:users"].updates;
        // Should have updates for pending and success states
        expect(updates.length).toBeGreaterThanOrEqual(1);
        const last = updates[updates.length - 1] as any;
        expect(last.status).toBe("success");
        expect(last.data).toEqual({ name: "Alice" });
        expect(last.error).toBeNull();
    });

    // ── DT03: main state updated on query error ──
    it("DT03: pushes main state update on query error", async () => {
        const { devtools, entries } = createMockDevtools();
        const { resource, calls } = createResource({ key: "users", devtools });

        const promise = resource.query({ id: 1 });
        await flushMicrotasks();

        calls[0].reject(new Error("fail"));
        await flushMicrotasks();
        await promise.catch(() => {});

        const updates = entries["query-v2:users"].updates;
        const last = updates[updates.length - 1] as any;
        expect(last.status).toBe("error");
        expect(last.error).toBeInstanceOf(Error);
    });

    // ── DT04: resetCache pushes idle state ──
    it("DT04: resetCache pushes idle state to devtools", async () => {
        const { devtools, entries } = createMockDevtools();
        const { resource, calls } = createResource({ key: "users", devtools });

        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        resource.resetCache();
        await flushMicrotasks();

        const updates = entries["query-v2:users"].updates;
        const last = updates[updates.length - 1] as any;
        expect(last.status).toBe("idle");
        expect(last.data).toBeNull();
    });

    // ── DT05: agent entry registered with "/agent" suffix ──
    it("DT05: createAgent registers devtools entry with /agent suffix", () => {
        const { devtools, entries } = createMockDevtools();
        const { resource } = createResource({ key: "users", devtools });

        resource.createAgent();

        expect(entries["query-v2:users/agent"]).toBeDefined();
        expect(entries["query-v2:users/agent"].init).toEqual({ status: "idle", data: null, error: null });
    });

    // ── DT06: no debug entries by default ──
    it("DT06: does not register debug entries when devtoolsDebug is false", () => {
        const { devtools, entries } = createMockDevtools();
        createResource({ key: "users", devtools });

        const debugKeys = Object.keys(entries).filter((k) => k.includes("/status$") || k.includes("/lastEntry$"));
        expect(debugKeys).toHaveLength(0);
    });

    // ── DT07: debug mode registers internal signals ──
    it("DT07: devtoolsDebug=true registers internal signal entries", async () => {
        const { devtools, entries } = createMockDevtools();
        const { resource, calls } = createResource({ key: "users", devtools, devtoolsDebug: true });

        // Internal signals should be registered
        expect(entries["query-v2:users/status$"]).toBeDefined();
        expect(entries["query-v2:users/status$"].init).toBe("idle");
        expect(entries["query-v2:users/lastEntry$"]).toBeDefined();
        expect(entries["query-v2:users/lastEntry$"].init).toBe("null");

        // Trigger a query to update internal signals
        resource.query({ id: 1 });
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        const statusUpdates = entries["query-v2:users/status$"].updates;
        expect(statusUpdates).toContain("ready");

        // Entry-level devtools entry should exist
        const entryKeys = Object.keys(entries).filter((k) => k.includes("/entry("));
        expect(entryKeys.length).toBeGreaterThanOrEqual(1);
    });
});
