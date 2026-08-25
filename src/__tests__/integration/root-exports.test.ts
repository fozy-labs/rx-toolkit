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

        it("exports SourceSignal", async () => {
            const mod = await import("@/index");
            expect(mod.SourceSignal).toBeDefined();
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

        it("exports FromSignal", async () => {
            const mod = await import("@/index");
            expect(mod.FromSignal).toBeDefined();
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

    describe("statechart re-exports", () => {
        it("exports createMachine", async () => {
            const mod = await import("@/index");
            expect(mod.createMachine).toBeDefined();
        });

        it("exports MachineDefinition", async () => {
            const mod = await import("@/index");
            expect(mod.MachineDefinition).toBeDefined();
        });

        it("exports MachineSignal", async () => {
            const mod = await import("@/index");
            expect(mod.MachineSignal).toBeDefined();
            expect(typeof mod.MachineSignal.state).toBe("function");
        });

        it("exports Statechart", async () => {
            const mod = await import("@/index");
            expect(mod.Statechart).toBeDefined();
        });

        it("exports the builtin action creators", async () => {
            const mod = await import("@/index");
            expect(mod.assign).toBeDefined();
            expect(mod.raise).toBeDefined();
            expect(mod.cancel).toBeDefined();
            expect(mod.log).toBeDefined();
        });

        it("exports the builtin guard creators", async () => {
            const mod = await import("@/index");
            expect(mod.and).toBeDefined();
            expect(mod.or).toBeDefined();
            expect(mod.not).toBeDefined();
            expect(mod.stateIn).toBeDefined();
        });

        it("exports MachineConfigError", async () => {
            const mod = await import("@/index");
            expect(mod.MachineConfigError).toBeDefined();
        });

        it("exports statelyInspector (from common/devtools)", async () => {
            const mod = await import("@/index");
            expect(mod.statelyInspector).toBeDefined();
        });
    });
});
