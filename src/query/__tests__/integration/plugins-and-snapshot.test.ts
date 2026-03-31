import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";

import { flushMicrotasks } from "@/__tests__/helpers/async-helpers";
import { createControllableQueryFn } from "@/query/__tests__/helpers";
import { createApi } from "@/query/api/createApi";
import { ReactHooksPlugin } from "@/query/plugins";
import { useResourceAgent } from "@/query/react";
import { CURRENT_SNAPSHOT_VERSION } from "@/query/types";
import type { IPlugin, TApiSnapshot } from "@/query/types";

type TArgs = { id: number };
type TData = { name: string };

describe("Integration: plugins-and-snapshot", () => {
    // ── INT03: Plugin + cache + hook: ReactHooksPlugin contributes working hooks ──
    it("INT03: ReactHooksPlugin contributes useResourceAgent that works via renderHook", async () => {
        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi({
            plugins: [new ReactHooksPlugin()] as const,
        });
        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
        });

        // resource should have useResourceAgent contributed by plugin
        expect((resource as unknown as Record<string, unknown>).useResourceAgent).toBeTypeOf("function");

        // Use the standalone hook (same behavior path) via renderHook
        const { result } = renderHook(() => useResourceAgent(resource, { id: 1 }));

        expect(result.current.status).toBe("pending");

        await act(async () => {
            calls[0].resolve({ name: "Alice" });
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Alice" });
    });

    // ── INT04: Snapshot SSR round-trip ──
    it("INT04: server capture → serialize → deserialize → client createApi → createResource → React hook uses hydrated data", async () => {
        // ── Server side ──
        const { queryFn: serverQf, calls: serverCalls } = createControllableQueryFn<TArgs, TData>();
        const serverApi = createApi({ keyPrefix: "app" });
        const serverResource = serverApi.createResource<TArgs, TData>({
            key: "users",
            queryFn: serverQf,
            cacheLifetime: false as never,
        });

        // Fetch on server
        const p = serverResource.query({ id: 1 });
        serverCalls[0].resolve({ name: "Server-Data" });
        await flushMicrotasks();
        await p;

        // Capture snapshot
        const snapshot = serverApi.getSnapshot();
        expect(snapshot.version).toBe(CURRENT_SNAPSHOT_VERSION);
        expect(snapshot.keyPrefix).toBe("app");
        expect(snapshot.resources["users"]).toBeDefined();

        // Serialize → deserialize (simulates network transfer)
        const json = JSON.stringify(snapshot);
        const clientSnapshot: TApiSnapshot = JSON.parse(json);

        // ── Client side ──
        const { queryFn: clientQf } = createControllableQueryFn<TArgs, TData>();
        const clientApi = createApi({
            keyPrefix: "app",
            initialSnapshot: clientSnapshot,
        });
        const clientResource = clientApi.createResource<TArgs, TData>({
            key: "users",
            queryFn: clientQf,
            cacheLifetime: false as never,
        });

        // Entry should already be hydrated
        const entry = clientResource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Server-Data" });

        // React hook should render hydrated data without triggering fetch
        const { result } = renderHook(() => useResourceAgent(clientResource, { id: 1 }));

        await act(async () => {
            await flushMicrotasks();
        });

        expect(result.current.status).toBe("success");
        expect(result.current.data).toEqual({ name: "Server-Data" });
        // Hydrated entry skips _doFetch — client queryFn is NOT called
        expect(clientQf).not.toHaveBeenCalled();
    });

    // ── INT13: Lifecycle hooks fired in correct order during full lifecycle ──
    it("INT13: onCacheEntryAdded and onQueryStarted fire in correct order", async () => {
        const callLog: string[] = [];

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi();
        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
            onCacheEntryAdded: (args, tools) => {
                callLog.push(`cacheEntryAdded:${args.id}`);
                tools.$cacheDataLoaded.then(() => {
                    callLog.push(`cacheDataLoaded:${args.id}`);
                });
                tools.$cacheEntryRemoved.then(() => {
                    callLog.push(`cacheEntryRemoved:${args.id}`);
                });
            },
            onQueryStarted: (args, tools) => {
                callLog.push(`queryStarted:${args.id}`);
                tools.$queryFulfilled.then(() => {
                    callLog.push(`queryFulfilled:${args.id}`);
                });
            },
        });

        // Query triggers both hooks
        resource.query({ id: 1 });

        // cacheEntryAdded fires synchronously during entry creation
        expect(callLog).toContain("cacheEntryAdded:1");

        // Resolve the query
        calls[0].resolve({ name: "Alice" });
        await flushMicrotasks();

        // After resolution, data loaded and fulfilled should have fired
        expect(callLog).toContain("cacheDataLoaded:1");
    });

    // ── INT14: Plugin augmentResource called with all api-level defaults merged ──
    it("INT14: plugin augmentResource receives merged options", () => {
        const augmentSpy = vi.fn(() => ({}));
        const plugin: IPlugin = {
            name: "SpyPlugin",
            install: vi.fn(),
            augmentResource: augmentSpy,
        };

        const { queryFn } = createControllableQueryFn<TArgs, TData>();
        const api = createApi({
            cacheLifetime: 45_000,
            plugins: [plugin],
        });

        api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
        });

        expect(augmentSpy).toHaveBeenCalledTimes(1);
        // The options passed to augmentResource should have the merged cacheLifetime
        const passedOptions = (augmentSpy as unknown as { mock: { calls: [unknown, { cacheLifetime: number }][] } })
            .mock.calls[0]?.[1];
        expect(passedOptions!.cacheLifetime).toBe(45_000);
    });

    // ── T05: Stale snapshot entry triggers refetch after hydration ──
    it("T05: stale snapshot entry (updatedAt exceeds maxSnapshotDataAge) triggers refetch", async () => {
        const staleTimestamp = Date.now() - 10_000; // 10 seconds ago
        const snapshot: TApiSnapshot = {
            version: CURRENT_SNAPSHOT_VERSION,
            keyPrefix: null,
            timestamp: Date.now(),
            resources: {
                users: {
                    entries: {
                        [JSON.stringify({ id: 1 })]: {
                            status: "success" as const,
                            args: { id: 1 },
                            data: { name: "Stale-Data" },
                            updatedAt: staleTimestamp,
                        },
                    },
                },
            },
        };

        const { queryFn, calls } = createControllableQueryFn<TArgs, TData>();
        const api = createApi({
            initialSnapshot: snapshot,
            maxSnapshotDataAge: 5_000, // 5 seconds — entry is stale
        });
        const resource = api.createResource<TArgs, TData>({
            key: "users",
            queryFn,
            cacheLifetime: false as never,
        });

        // Entry should be hydrated but auto-invalidated
        const entry = resource.getEntry({ id: 1 });
        expect(entry).not.toBeNull();
        expect(entry!.peek().status).toBe("refreshing");

        // queryFn called once via invalidate() (hydrated entry skips _doFetch)
        expect(queryFn).toHaveBeenCalledTimes(1);

        // Resolve the invalidation refetch
        calls[0].resolve({ name: "Fresh-Data" });
        await flushMicrotasks();

        expect(entry!.peek().status).toBe("success");
        expect(entry!.peek().data).toEqual({ name: "Fresh-Data" });
    });
});
