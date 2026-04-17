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
    });
});
