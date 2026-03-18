describe("Root module exports (@/index)", () => {
    describe("common/devtools re-exports", () => {
        it("exports reduxDevtools", async () => {
            const mod = await import("@/index");
            expect(mod.reduxDevtools).toBeDefined();
        });

        it("exports combineDevtools", async () => {
            const mod = await import("@/index");
            expect(mod.combineDevtools).toBeDefined();
        });
    });

    describe("common/options re-exports", () => {
        it("exports DefaultOptions", async () => {
            const mod = await import("@/index");
            expect(mod.DefaultOptions).toBeDefined();
        });
    });

    describe("common/react re-exports", () => {
        it("exports useConstant", async () => {
            const mod = await import("@/index");
            expect(mod.useConstant).toBeDefined();
        });

        it("exports useEventHandler", async () => {
            const mod = await import("@/index");
            expect(mod.useEventHandler).toBeDefined();
        });
    });

    describe("common/utils re-exports", () => {
        it("exports deepEqual", async () => {
            const mod = await import("@/index");
            expect(mod.deepEqual).toBeDefined();
        });

        it("exports shallowEqual", async () => {
            const mod = await import("@/index");
            expect(mod.shallowEqual).toBeDefined();
        });

        it("does NOT export PromiseResolver from root", async () => {
            const mod = await import("@/index");
            expect((mod as any).PromiseResolver).toBeUndefined();
        });
    });

    describe("signals re-exports", () => {
        it("exports Batcher", async () => {
            const mod = await import("@/index");
            expect(mod.Batcher).toBeDefined();
        });

        it("exports ComputeCache", async () => {
            const mod = await import("@/index");
            expect(mod.ComputeCache).toBeDefined();
        });

        it("exports DependencyTracker", async () => {
            const mod = await import("@/index");
            expect(mod.DependencyTracker).toBeDefined();
        });

        it("exports Devtools", async () => {
            const mod = await import("@/index");
            expect(mod.Devtools).toBeDefined();
        });

        it("exports ReadonlySignal", async () => {
            const mod = await import("@/index");
            expect(mod.ReadonlySignal).toBeDefined();
        });

        it("exports SyncObservable", async () => {
            const mod = await import("@/index");
            expect(mod.SyncObservable).toBeDefined();
        });

        it("exports signalize", async () => {
            const mod = await import("@/index");
            expect(mod.signalize).toBeDefined();
        });

        it("exports useSignal", async () => {
            const mod = await import("@/index");
            expect(mod.useSignal).toBeDefined();
        });

        it("exports State", async () => {
            const mod = await import("@/index");
            expect(mod.State).toBeDefined();
        });

        it("exports Computed", async () => {
            const mod = await import("@/index");
            expect(mod.Computed).toBeDefined();
        });

        it("exports Effect", async () => {
            const mod = await import("@/index");
            expect(mod.Effect).toBeDefined();
        });

        it("exports Signal", async () => {
            const mod = await import("@/index");
            expect(mod.Signal).toBeDefined();
        });

        it("exports LocalState", async () => {
            const mod = await import("@/index");
            expect(mod.LocalState).toBeDefined();
        });

        it("exports LocalSignal", async () => {
            const mod = await import("@/index");
            expect(mod.LocalSignal).toBeDefined();
        });
    });

    describe("query re-exports", () => {
        it("exports createResource", async () => {
            const mod = await import("@/index");
            expect(mod.createResource).toBeDefined();
        });

        it("exports createCommand", async () => {
            const mod = await import("@/index");
            expect(mod.createCommand).toBeDefined();
        });

        it("exports useResourceAgent", async () => {
            const mod = await import("@/index");
            expect(mod.useResourceAgent).toBeDefined();
        });

        it("exports useCommandAgent", async () => {
            const mod = await import("@/index");
            expect(mod.useCommandAgent).toBeDefined();
        });

        it("exports useResourceRef", async () => {
            const mod = await import("@/index");
            expect(mod.useResourceRef).toBeDefined();
        });

        it("exports SKIP", async () => {
            const mod = await import("@/index");
            expect(mod.SKIP).toBeDefined();
        });

        it("exports createResourceDuplicator", async () => {
            const mod = await import("@/index");
            expect(mod.createResourceDuplicator).toBeDefined();
        });

        it("exports resetAllQueriesCache", async () => {
            const mod = await import("@/index");
            expect(mod.resetAllQueriesCache).toBeDefined();
        });
    });

    describe("query deprecated re-exports", () => {
        it("exports createOperation (deprecated)", async () => {
            const mod = await import("@/index");
            expect(mod.createOperation).toBeDefined();
        });

        it("exports useOperationAgent (deprecated)", async () => {
            const mod = await import("@/index");
            expect(mod.useOperationAgent).toBeDefined();
        });
    });

    describe("query type exports (compile-time check)", () => {
        it("exports query types", () => {
            const _typeCheck = () => {
                type _RD = import("@/index").ResourceDefinition;
                type _CD = import("@/index").CommandDefinition;
            };
            expect(true).toBe(true);
        });
    });
});
