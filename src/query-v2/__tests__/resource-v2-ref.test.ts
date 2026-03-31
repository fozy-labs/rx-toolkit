import { describe, expect, it, vi } from "vitest";

import { ResourceV2Ref } from "@/query-v2/core/command/ResourceV2Ref";
import type { IPatchHandle, IResourceV2, IResourceV2CacheEntry } from "@/query-v2/types";

type RArgs = { userId: number };
type RData = { name: string; age: number };

function createMockResource(overrides?: Partial<IResourceV2<RArgs, RData>>): IResourceV2<RArgs, RData> {
    return {
        createAgent: vi.fn() as any,
        query: vi.fn() as any,
        getEntry: vi.fn().mockReturnValue(null) as any,
        getEntry$: vi.fn() as any,
        invalidate: vi.fn(),
        ...overrides,
    };
}

function createMockEntry(
    overrides?: Partial<IResourceV2CacheEntry<RArgs, RData>>,
): IResourceV2CacheEntry<RArgs, RData> {
    return {
        createPatch: vi.fn().mockReturnValue(null),
        invalidate: vi.fn(),
        ...overrides,
    } as unknown as IResourceV2CacheEntry<RArgs, RData>;
}

describe("ResourceV2Ref", () => {
    const args: RArgs = { userId: 42 };

    // ── T50: invalidate() delegates to resource.invalidate(forwardedArgs) ──
    it("T50: invalidate() delegates to resource.invalidate(forwardedArgs)", () => {
        const resource = createMockResource();
        const ref = new ResourceV2Ref(resource, args);

        ref.invalidate();

        expect(resource.invalidate).toHaveBeenCalledTimes(1);
        expect(resource.invalidate).toHaveBeenCalledWith(args);
    });

    // ── T51: patch(fn) gets entry, calls createPatch, returns IPatchHandle ──
    it("T51: patch(fn) delegates to entry.createPatch and returns IPatchHandle", () => {
        const patchHandle: IPatchHandle = {
            commit: vi.fn(),
            abort: vi.fn(),
        };
        const entry = createMockEntry({
            createPatch: vi.fn().mockReturnValue(patchHandle),
        });
        const resource = createMockResource({
            getEntry: vi.fn().mockReturnValue(entry) as any,
        });
        const ref = new ResourceV2Ref(resource, args);

        const patchFn = (draft: RData) => {
            draft.name = "updated";
        };
        const result = ref.patch(patchFn);

        expect(resource.getEntry).toHaveBeenCalledWith(args);
        expect(entry.createPatch).toHaveBeenCalledWith(patchFn);
        expect(result).toBe(patchHandle);
    });

    // ── T52: patch() returns null when resource.getEntry(args) returns null ──
    it("T52: patch() returns null when no cache entry exists", () => {
        const resource = createMockResource({
            getEntry: vi.fn().mockReturnValue(null) as any,
        });
        const ref = new ResourceV2Ref(resource, args);

        const result = ref.patch((draft) => {
            draft.name = "nope";
        });

        expect(resource.getEntry).toHaveBeenCalledWith(args);
        expect(result).toBeNull();
    });

    // ── T53: patch() returns null when entry.createPatch returns null ──
    it("T53: patch() returns null when entry exists but createPatch returns null", () => {
        const entry = createMockEntry({
            createPatch: vi.fn().mockReturnValue(null),
        });
        const resource = createMockResource({
            getEntry: vi.fn().mockReturnValue(entry) as any,
        });
        const ref = new ResourceV2Ref(resource, args);

        const result = ref.patch((draft) => {
            draft.age = 99;
        });

        expect(resource.getEntry).toHaveBeenCalledWith(args);
        expect(entry.createPatch).toHaveBeenCalledTimes(1);
        expect(result).toBeNull();
    });
});
