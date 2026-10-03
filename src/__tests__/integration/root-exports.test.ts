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
        it("does NOT export useConstant (moved to ./react)", async () => {
            const mod = await import("@/index");
            expect((mod as any).useConstant).toBeUndefined();
        });

        it("does NOT export useEventHandler (moved to ./react)", async () => {
            const mod = await import("@/index");
            expect((mod as any).useEventHandler).toBeUndefined();
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

        it("exports Devtools", async () => {
            const mod = await import("@/index");
            expect(mod.Devtools).toBeDefined();
        });

        it("exports SourceSignal", async () => {
            const mod = await import("@/index");
            expect(mod.SourceSignal).toBeDefined();
        });

        it("no longer exports the removed signalize", async () => {
            const mod = await import("@/index");
            expect("signalize" in mod).toBe(false);
        });

        it("does NOT export useSignal (moved to ./react)", async () => {
            const mod = await import("@/index");
            expect((mod as any).useSignal).toBeUndefined();
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
        it("exports unstable_createMachine", async () => {
            const mod = await import("@/index");
            expect(mod.unstable_createMachine).toBeDefined();
        });

        it("exports MachineDefinition", async () => {
            const mod = await import("@/index");
            expect(mod.MachineDefinition).toBeDefined();
        });

        it("exports unstable_MachineSignal", async () => {
            const mod = await import("@/index");
            expect(mod.unstable_MachineSignal).toBeDefined();
            expect(typeof mod.unstable_MachineSignal.state).toBe("function");
        });

        it("exports unstable_Statechart", async () => {
            const mod = await import("@/index");
            expect(mod.unstable_Statechart).toBeDefined();
        });

        it("exports the builtin action creators", async () => {
            const mod = await import("@/index");
            expect(mod.assign).toBeDefined();
            expect(mod.mutate).toBeDefined();
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

    describe("form re-exports", () => {
        it("exports unstable_FormSignal with its builders", async () => {
            const mod = await import("@/index");
            expect(mod.unstable_FormSignal).toBeDefined();
            expect(typeof mod.unstable_FormSignal.field).toBe("function");
            expect(typeof mod.unstable_FormSignal.group).toBe("function");
            expect(typeof mod.unstable_FormSignal.list).toBe("function");
            expect(typeof mod.unstable_FormSignal.context).toBe("function");
            expect(typeof mod.unstable_FormSignal.state).toBe("function");
        });

        it("exports unstable_formsPlugin and unstable_FormsPlugin", async () => {
            const mod = await import("@/index");
            expect(mod.unstable_formsPlugin().name).toBe("FormsPlugin");
            expect(mod.unstable_formsPlugin()).toBeInstanceOf(mod.unstable_FormsPlugin);
        });

        it("exports FormConfigError", async () => {
            const mod = await import("@/index");
            expect(mod.FormConfigError).toBeDefined();
        });
    });
});
