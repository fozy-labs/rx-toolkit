/**
 * The package's two entry points: `@/index` (published as the package root) must resolve and
 * load without `react` — every React API moved to the `./react` subpath (`@/react`). `react` and
 * `react-dom` are mocked to throw on import, so any runtime `import "react"` reachable from the
 * root graph fails the test; `import type` stays allowed.
 */
import { describe, expect, it, vi } from "vitest";

vi.doMock("react", () => {
    throw new Error("react imported");
});
vi.doMock("react-dom", () => {
    throw new Error("react imported");
});
vi.doMock("react-dom/client", () => {
    throw new Error("react imported");
});
vi.doMock("react-dom/server", () => {
    throw new Error("react imported");
});

describe("entry points", () => {
    it("@/index loads without react and exposes the framework-agnostic API", async () => {
        const mod = await import("@/index");
        expect(mod.Signal).toBeDefined();
        expect(mod.createApi).toBeDefined();
    });

    it("@/index does not expose the React API", async () => {
        const mod = await import("@/index");
        expect((mod as Record<string, unknown>).useSignal).toBeUndefined();
        expect((mod as Record<string, unknown>).useResource).toBeUndefined();
        expect((mod as Record<string, unknown>).unstable_formsReactPlugin).toBeUndefined();
    });

    describe("@/react", () => {
        it("exposes the React API", async () => {
            // The react entry is allowed to need react: restore the real module first.
            vi.doUnmock("react");
            vi.doUnmock("react-dom");
            vi.doUnmock("react-dom/client");
            vi.doUnmock("react-dom/server");

            const mod = await import("@/react");
            expect(mod.useSignal).toBeDefined();
            expect(mod.ReactHooksPlugin).toBeDefined();
            expect(mod.useResource).toBeDefined();
            expect(mod.unstable_formsReactPlugin).toBeDefined();
            expect(mod.useConstant).toBeDefined();
            expect(mod.useDebouncedValue).toBeDefined();
            expect(mod.useDelayedValue).toBeDefined();
        });
    });
});
