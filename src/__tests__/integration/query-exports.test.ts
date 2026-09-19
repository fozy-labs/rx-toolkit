describe("Query module exports (@/index)", () => {
    describe("api re-exports", () => {
        it("exports createApi", async () => {
            const mod = await import("@/index");
            expect(mod.createApi).toBeDefined();
            expect(typeof mod.createApi).toBe("function");
        });

        it("exports composeHooks", async () => {
            const mod = await import("@/index");
            expect(mod.composeHooks).toBeDefined();
            expect(typeof mod.composeHooks).toBe("function");
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

        it("exports useSuspenseResource", async () => {
            const mod = await import("@/index");
            expect(mod.useSuspenseResource).toBeDefined();
            expect(typeof mod.useSuspenseResource).toBe("function");
        });

        it("exports useCommand", async () => {
            const mod = await import("@/index");
            expect(mod.useCommand).toBeDefined();
            expect(typeof mod.useCommand).toBe("function");
        });
    });

    describe("core re-exports", () => {
        it("exports ProjectionItemMissingError", async () => {
            const mod = await import("@/index");
            expect(mod.ProjectionItemMissingError).toBeDefined();
            expect(typeof mod.ProjectionItemMissingError).toBe("function");
        });

        it.each([
            "Machine",
            "MachineBase",
            "MachineWithData",
            "MachinePending",
            "MachineSuccess",
            "MachineError",
            "MachineInvalidating",
            "MachineInvalidateError",
        ])("does not export %s — the query state machine left the public API in 0.13.0", async (name) => {
            const mod = (await import("@/index")) as Record<string, unknown>;
            expect(name in mod).toBe(false);
        });

        it.each(["MachineStateError", "MachineTransitionError", "QueryEntryStateError", "QueryEntryTransitionError"])(
            "does not export %s — entry transition errors stay internal",
            async (name) => {
                const mod = (await import("@/index")) as Record<string, unknown>;
                expect(name in mod).toBe(false);
            },
        );
    });
});
