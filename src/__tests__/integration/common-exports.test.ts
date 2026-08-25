describe("Common module exports", () => {
    describe("@/common/devtools", () => {
        it("exports reduxDevtools", async () => {
            const mod = await import("@/common/devtools");
            expect(mod.reduxDevtools).toBeDefined();
            expect(typeof mod.reduxDevtools).toBe("function");
        });

        it("exports combineDevtools", async () => {
            const mod = await import("@/common/devtools");
            expect(mod.combineDevtools).toBeDefined();
            expect(typeof mod.combineDevtools).toBe("function");
        });

        it("exports statelyInspector", async () => {
            const mod = await import("@/common/devtools");
            expect(mod.statelyInspector).toBeDefined();
            expect(typeof mod.statelyInspector).toBe("function");
            expect(mod.STATELY_INSPECT_PROTOCOL_VERSION).toBe("0.7.2");
        });
    });

    describe("@/common/options", () => {
        it("exports DefaultOptions", async () => {
            const mod = await import("@/common/options");
            expect(mod.DefaultOptions).toBeDefined();
            expect(typeof mod.DefaultOptions.update).toBe("function");
        });
    });

    describe("@/common/react", () => {
        it("exports useConstant", async () => {
            const mod = await import("@/common/react");
            expect(mod.useConstant).toBeDefined();
            expect(typeof mod.useConstant).toBe("function");
        });

        it("exports useEventHandler", async () => {
            const mod = await import("@/common/react");
            expect(mod.useEventHandler).toBeDefined();
            expect(typeof mod.useEventHandler).toBe("function");
        });
    });

    describe("@/common/utils", () => {
        it("exports PromiseResolver", async () => {
            const mod = await import("@/common/utils");
            expect(mod.PromiseResolver).toBeDefined();
            expect(typeof mod.PromiseResolver).toBe("function");
        });

        it("exports deepEqual", async () => {
            const mod = await import("@/common/utils");
            expect(mod.deepEqual).toBeDefined();
            expect(typeof mod.deepEqual).toBe("function");
        });

        it("exports shallowEqual", async () => {
            const mod = await import("@/common/utils");
            expect(mod.shallowEqual).toBeDefined();
            expect(typeof mod.shallowEqual).toBe("function");
        });
    });
});
