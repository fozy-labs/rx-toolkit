import { renderHook } from "@testing-library/react";

import { createResource } from "@/query/api/createResource";
import { SKIP } from "@/query/SKIP_TOKEN";

import { useResourceRef } from "./useResourceRef";

function createTestResource() {
    const queryFn = vi.fn((_args: { id: number }, _tools?: any) => Promise.resolve({ name: "item" }));

    const resource = createResource<{ id: number }, { name: string }>({
        queryFn,
        cacheLifetime: false,
        devtoolsName: false,
    });

    return { resource, queryFn };
}

describe("useResourceRef", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("renders without throwing", () => {
        const { resource } = createTestResource();

        const { result } = renderHook(() => useResourceRef(resource, { id: 1 }));

        expect(result.current).toBeDefined();
    });

    it("returns a ref-like object", () => {
        const { resource } = createTestResource();

        const { result } = renderHook(() => useResourceRef(resource, { id: 1 }));

        // ResourceRefInstance should have has, lock, unlockOne, patch, invalidate, create
        expect(typeof result.current.lock).toBe("function");
        expect(typeof result.current.unlockOne).toBe("function");
        expect(typeof result.current.patch).toBe("function");
        expect(typeof result.current.invalidate).toBe("function");
        expect(typeof result.current.create).toBe("function");
        expect("has" in result.current).toBe(true);
    });

    it("object args do not cause recreation every render (Phase 2 bugfix)", () => {
        const { resource } = createTestResource();

        const { result, rerender } = renderHook(({ args }) => useResourceRef(resource, args), {
            initialProps: { args: { id: 1 } as { id: number } | typeof SKIP },
        });

        const firstRef = result.current;

        // Rerender with a new object that has the same values
        rerender({ args: { id: 1 } });

        const secondRef = result.current;

        // The ref should be the same instance because shallowEqual prevents recreation
        expect(secondRef).toBe(firstRef);
    });
});
