describe("Query module exports (@/index)", () => {
    describe("api re-exports", () => {
        it("exports createApi", async () => {
            const mod = await import("@/index");
            expect(mod.createApi).toBeDefined();
            expect(typeof mod.createApi).toBe("function");
        });
    });

    describe("constants re-exports", () => {
        it("exports SKIP", async () => {
            const mod = await import("@/index");
            expect(mod.SKIP).toBeDefined();
            expect(typeof mod.SKIP).toBe("symbol");
        });

        it("exports KEYED_BRAND", async () => {
            const mod = await import("@/index");
            expect(mod.KEYED_BRAND).toBeDefined();
            expect(typeof mod.KEYED_BRAND).toBe("symbol");
        });

        it("exports CURRENT_SNAPSHOT_VERSION", async () => {
            const mod = await import("@/index");
            expect(mod.CURRENT_SNAPSHOT_VERSION).toBeDefined();
            expect(typeof mod.CURRENT_SNAPSHOT_VERSION).toBe("number");
        });
    });

    describe("lib re-exports", () => {
        it("exports stableStringify", async () => {
            const mod = await import("@/index");
            expect(mod.stableStringify).toBeDefined();
            expect(typeof mod.stableStringify).toBe("function");
        });

        it("exports toKeyed", async () => {
            const mod = await import("@/index");
            expect(mod.toKeyed).toBeDefined();
            expect(typeof mod.toKeyed).toBe("function");
        });
    });

    describe("react re-exports", () => {
        it("exports ReactHooksPlugin", async () => {
            const mod = await import("@/index");
            expect(mod.ReactHooksPlugin).toBeDefined();
            expect(typeof mod.ReactHooksPlugin).toBe("function");
        });

        it("exports reactHooksPlugin factory", async () => {
            const mod = await import("@/index");
            expect(mod.reactHooksPlugin).toBeDefined();
            expect(typeof mod.reactHooksPlugin).toBe("function");
        });

        it("exports useResource", async () => {
            const mod = await import("@/index");
            expect(mod.useResource).toBeDefined();
            expect(typeof mod.useResource).toBe("function");
        });

        it("exports useCommand", async () => {
            const mod = await import("@/index");
            expect(mod.useCommand).toBeDefined();
            expect(typeof mod.useCommand).toBe("function");
        });
    });

    describe("core re-exports", () => {
        it("exports Machine", async () => {
            const mod = await import("@/index");
            expect(mod.Machine).toBeDefined();
            expect(typeof mod.Machine).toBe("object");
        });

        it("exports MachineBase", async () => {
            const mod = await import("@/index");
            expect(mod.MachineBase).toBeDefined();
            expect(typeof mod.MachineBase).toBe("function");
        });

        it("exports MachineWithData", async () => {
            const mod = await import("@/index");
            expect(mod.MachineWithData).toBeDefined();
            expect(typeof mod.MachineWithData).toBe("function");
        });

        it("exports MachinePending", async () => {
            const mod = await import("@/index");
            expect(mod.MachinePending).toBeDefined();
            expect(typeof mod.MachinePending).toBe("function");
        });

        it("exports MachineSuccess", async () => {
            const mod = await import("@/index");
            expect(mod.MachineSuccess).toBeDefined();
            expect(typeof mod.MachineSuccess).toBe("function");
        });

        it("exports MachineError", async () => {
            const mod = await import("@/index");
            expect(mod.MachineError).toBeDefined();
            expect(typeof mod.MachineError).toBe("function");
        });

        it("exports MachineRefreshing", async () => {
            const mod = await import("@/index");
            expect(mod.MachineRefreshing).toBeDefined();
            expect(typeof mod.MachineRefreshing).toBe("function");
        });

        it("exports MachineRefreshError", async () => {
            const mod = await import("@/index");
            expect(mod.MachineRefreshError).toBeDefined();
            expect(typeof mod.MachineRefreshError).toBe("function");
        });
    });
});
