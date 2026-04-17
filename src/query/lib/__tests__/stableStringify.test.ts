import { describe, expect, it } from "vitest";

import { stableStringify } from "../stableStringify";

describe("stableStringify", () => {
    it("produces the same string for objects with different key order", () => {
        const a = stableStringify({ b: 2, a: 1 });
        const b = stableStringify({ a: 1, b: 2 });
        expect(a).toBe(b);
        expect(a).toBe('{"a":1,"b":2}');
    });

    it("handles nested objects with different key order", () => {
        const a = stableStringify({ z: { b: 2, a: 1 }, y: 3 });
        const b = stableStringify({ y: 3, z: { a: 1, b: 2 } });
        expect(a).toBe(b);
        expect(a).toBe('{"y":3,"z":{"a":1,"b":2}}');
    });

    it("handles primitives", () => {
        expect(stableStringify(42)).toBe("42");
        expect(stableStringify("hello")).toBe('"hello"');
        expect(stableStringify(true)).toBe("true");
        expect(stableStringify(false)).toBe("false");
    });

    it("handles null", () => {
        expect(stableStringify(null)).toBe("null");
    });

    it("handles undefined (returns string for cache key safety)", () => {
        expect(stableStringify(undefined)).toBe("undefined");
    });

    it("handles arrays (preserves order)", () => {
        expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    });

    it("handles arrays containing objects with different key order", () => {
        const a = stableStringify([{ b: 2, a: 1 }]);
        const b = stableStringify([{ a: 1, b: 2 }]);
        expect(a).toBe(b);
        expect(a).toBe('[{"a":1,"b":2}]');
    });

    it("handles empty object and empty array", () => {
        expect(stableStringify({})).toBe("{}");
        expect(stableStringify([])).toBe("[]");
    });

    it("strips undefined values inside objects (JSON.stringify behavior)", () => {
        expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    });
});
