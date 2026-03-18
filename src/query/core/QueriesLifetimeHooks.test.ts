import { QueriesLifetimeHooks } from "@/query/core/QueriesLifetimeHooks";

describe("QueriesLifetimeHooks", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("onQueryStarted", () => {
        it("calls listener with args and tools", () => {
            const listener = vi.fn();
            const hooks = new QueriesLifetimeHooks<string, string>({
                onQueryStarted: listener,
                devtoolsName: false,
            });

            hooks.onQueryStarted("test-args");

            expect(listener).toHaveBeenCalledWith(
                "test-args",
                expect.objectContaining({
                    $queryFulfilled: expect.any(Promise),
                }),
            );
        });

        it("$queryFulfilled resolves with data on success", async () => {
            let capturedTools: { $queryFulfilled: Promise<any> } | undefined;
            const listener = vi.fn((_args: string, tools: { $queryFulfilled: Promise<any> }) => {
                capturedTools = tools;
            });
            const hooks = new QueriesLifetimeHooks<string, string>({
                onQueryStarted: listener,
                devtoolsName: false,
            });

            const resolvers = hooks.onQueryStarted("args");
            resolvers.fulfilledSuccess("result-data");

            const result = await capturedTools!.$queryFulfilled;
            expect(result).toEqual({ data: "result-data", error: undefined, isError: false });
        });

        it("$queryFulfilled resolves with error info on failure", async () => {
            let capturedTools: { $queryFulfilled: Promise<any> } | undefined;
            const listener = vi.fn((_args: string, tools: { $queryFulfilled: Promise<any> }) => {
                capturedTools = tools;
            });
            const hooks = new QueriesLifetimeHooks<string, string>({
                onQueryStarted: listener,
                devtoolsName: false,
            });

            const resolvers = hooks.onQueryStarted("args");
            const error = new Error("query failed");
            resolvers.fulfilledError(error);

            const result = await capturedTools!.$queryFulfilled;
            expect(result).toEqual({ data: undefined, error, isError: true });
        });

        it("returns resolvers object with fulfilledSuccess and fulfilledError", () => {
            const hooks = new QueriesLifetimeHooks<string, string>({
                devtoolsName: false,
            });

            const resolvers = hooks.onQueryStarted("args");
            expect(typeof resolvers.fulfilledSuccess).toBe("function");
            expect(typeof resolvers.fulfilledError).toBe("function");
        });
    });

    describe("onCacheEntryAdded", () => {
        it("calls listener with args and tools", () => {
            const listener = vi.fn();
            const hooks = new QueriesLifetimeHooks<string, string>({
                onCacheEntryAdded: listener,
                devtoolsName: false,
            });

            hooks.onCacheEntryAdded("cache-args");

            expect(listener).toHaveBeenCalledWith(
                "cache-args",
                expect.objectContaining({
                    $cacheDataLoaded: expect.any(Promise),
                    $cacheEntryRemoved: expect.any(Promise),
                    dataChanged$: expect.any(Object),
                }),
            );
        });

        it("$cacheDataLoaded resolves when cacheDataLoaded is called", async () => {
            let capturedTools: { $cacheDataLoaded: Promise<void> } | undefined;
            const listener = vi.fn((_args: string, tools: { $cacheDataLoaded: Promise<void> }) => {
                capturedTools = tools;
            });
            const hooks = new QueriesLifetimeHooks<string, string>({
                onCacheEntryAdded: listener,
                devtoolsName: false,
            });

            const resolvers = hooks.onCacheEntryAdded("args");
            resolvers.cacheDataLoaded();

            await expect(capturedTools!.$cacheDataLoaded).resolves.toBeUndefined();
        });

        it("$cacheEntryRemoved resolves when cacheEntryRemoved is called", async () => {
            let capturedTools: { $cacheEntryRemoved: Promise<void> } | undefined;
            const listener = vi.fn((_args: string, tools: { $cacheEntryRemoved: Promise<void> }) => {
                capturedTools = tools;
            });
            const hooks = new QueriesLifetimeHooks<string, string>({
                onCacheEntryAdded: listener,
                devtoolsName: false,
            });

            const resolvers = hooks.onCacheEntryAdded("args");
            resolvers.cacheEntryRemoved();

            await expect(capturedTools!.$cacheEntryRemoved).resolves.toBeUndefined();
        });

        it("dataChanged$ emits values", () => {
            const hooks = new QueriesLifetimeHooks<string, string>({
                devtoolsName: false,
            });

            const resolvers = hooks.onCacheEntryAdded("args");

            const values: string[] = [];
            resolvers.dataChanged$.subscribe((v) => values.push(v));

            resolvers.dataChanged$.next("first");
            resolvers.dataChanged$.next("second");

            expect(values).toEqual(["first", "second"]);
        });

        it("dataChanged$ completes when cacheEntryRemoved is resolved", async () => {
            const hooks = new QueriesLifetimeHooks<string, string>({
                devtoolsName: false,
            });

            const resolvers = hooks.onCacheEntryAdded("args");

            let completed = false;
            resolvers.dataChanged$.subscribe({
                complete: () => {
                    completed = true;
                },
            });

            resolvers.cacheEntryRemoved();

            // Wait for the finally handler on the promise to run
            await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
            await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

            expect(completed).toBe(true);
        });

        it("returns resolvers with cacheDataLoaded, cacheEntryRemoved, and dataChanged$", () => {
            const hooks = new QueriesLifetimeHooks<string, string>({
                devtoolsName: false,
            });

            const resolvers = hooks.onCacheEntryAdded("args");
            expect(typeof resolvers.cacheDataLoaded).toBe("function");
            expect(typeof resolvers.cacheEntryRemoved).toBe("function");
            expect(resolvers.dataChanged$).toBeDefined();
        });
    });

    describe("no listeners", () => {
        it("onQueryStarted works without listeners", () => {
            const hooks = new QueriesLifetimeHooks<string, string>({
                devtoolsName: false,
            });

            const resolvers = hooks.onQueryStarted("args");
            expect(() => resolvers.fulfilledSuccess("data")).not.toThrow();
        });

        it("onCacheEntryAdded works without listeners", () => {
            const hooks = new QueriesLifetimeHooks<string, string>({
                devtoolsName: false,
            });

            const resolvers = hooks.onCacheEntryAdded("args");
            expect(() => resolvers.cacheDataLoaded()).not.toThrow();
            expect(() => resolvers.cacheEntryRemoved()).not.toThrow();
        });
    });
});
