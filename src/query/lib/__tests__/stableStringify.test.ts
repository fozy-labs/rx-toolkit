import { stableStringify } from "@/query/lib/stableStringify";

describe("stableStringify", () => {
    it("L02: plain object with sorted keys", () => {
        expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    });

    it("L03: nested objects", () => {
        expect(stableStringify({ b: { d: 4, c: 3 }, a: 1 })).toBe('{"a":1,"b":{"c":3,"d":4}}');
    });

    it("L04: arrays preserved in order", () => {
        expect(stableStringify([3, 1, 2])).toBe("[3,1,2]");
    });

    it("L05: null and undefined handling", () => {
        expect(stableStringify({ a: null, b: undefined })).toBe('{"a":null}');
    });

    it("L06: primitives — number", () => {
        expect(stableStringify(42)).toBe("42");
    });

    it("L06: primitives — string", () => {
        expect(stableStringify("hello")).toBe('"hello"');
    });

    it("L06: primitives — boolean", () => {
        expect(stableStringify(true)).toBe("true");
    });

    it("L07: empty object and empty array", () => {
        expect(stableStringify({})).toBe("{}");
        expect(stableStringify([])).toBe("[]");
    });

    it("L08: determinism — same output for same input across calls", () => {
        const input = { b: 2, a: 1 };
        const result1 = stableStringify(input);
        const result2 = stableStringify(input);
        expect(result1).toBe(result2);
    });

    it("L09: Date/Map/Set fallback — does not crash", () => {
        expect(() => stableStringify(new Date())).not.toThrow();
        expect(() => stableStringify(new Map())).not.toThrow();
        expect(() => stableStringify(new Set())).not.toThrow();
    });
});