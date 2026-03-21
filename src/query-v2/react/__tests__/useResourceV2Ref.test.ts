import { act, renderHook } from "@testing-library/react";

import { SKIP } from "@/query-v2/lib/SKIP_TOKEN";
import { useResourceV2Ref } from "@/query-v2/react/useResourceV2Ref";

import { controllableQueryFn, createTestResource } from "./helpers";

describe("useResourceV2Ref (standalone)", () => {
    // T6: Returns IResourceV2Ref with correct shape
    it("T6: returns ref with correct shape", async () => {
        const { fn, calls } = controllableQueryFn<number, string>();
        const resource = createTestResource({ queryFn: fn });

        const { result } = renderHook(() => useResourceV2Ref(resource, 1));

        // Ref shape should be complete even before data loads
        const ref = result.current;
        expect(typeof ref.has).toBe("boolean");
        expect(typeof ref.lock).toBe("function");
        expect(typeof ref.invalidate).toBe("function");
        expect(typeof ref.createPatch).toBe("function");
        expect(typeof ref.create).toBe("function");
    });

    // T7: With SKIP — returns skipped ref (has === false, createPatch returns null)
    it("T7: with SKIP — returns skipped ref", () => {
        const { fn } = controllableQueryFn<number, string>();
        const resource = createTestResource({ queryFn: fn });

        const { result } = renderHook(() => useResourceV2Ref(resource, SKIP));

        const ref = result.current;
        expect(ref.has).toBe(false);
        expect(ref.createPatch(() => "patched" as any)).toBeNull();

        // lock returns object with unlock
        const lockHandle = ref.lock();
        expect(typeof lockHandle.unlock).toBe("function");

        // invalidate and create are no-ops (should not throw)
        expect(() => ref.invalidate()).not.toThrow();
        expect(() => ref.create("test" as any)).not.toThrow();
    });
});
