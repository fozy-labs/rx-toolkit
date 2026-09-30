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

    it("gives a JSON value exactly its JSON text, keys sorted", () => {
        const value = { s: 'q"\u2028', n: [0, -0, 1.5, 1e21, -3], b: [true, false], z: null, d: new Date(0), o: {} };
        const sorted = { b: value.b, d: value.d, n: value.n, o: value.o, s: value.s, z: value.z };
        expect(stableStringify(value)).toBe(JSON.stringify(sorted));
    });

    it("keeps NaN, Infinity and -Infinity apart from null and from each other", () => {
        const keys = [null, NaN, Infinity, -Infinity].map((page) => stableStringify({ page }));
        expect(new Set(keys).size).toBe(4);
        expect(stableStringify(NaN)).not.toBe(stableStringify("NaN"));
    });

    it("keeps undefined inside an array apart from null", () => {
        expect(stableStringify([undefined])).not.toBe(stableStringify([null]));
        expect(stableStringify([1, , 2])).toBe(stableStringify([1, undefined, 2]));
    });

    it("serializes a bigint to a key of its own", () => {
        expect(stableStringify({ id: 1n })).not.toBe(stableStringify({ id: 1 }));
        expect(stableStringify(1n)).not.toBe(stableStringify("1n"));
    });

    it("serializes boxed primitives as their primitive (JSON.stringify behavior)", () => {
        expect(stableStringify({ n: Object(1), s: Object("a"), b: Object(true) })).toBe(
            stableStringify({ n: 1, s: "a", b: true }),
        );
    });

    it("always returns a string: a function or symbol counts as undefined", () => {
        expect(stableStringify(() => 1)).toBe(stableStringify(undefined));
        expect(stableStringify(Symbol("x"))).toBe(stableStringify(undefined));
        expect(stableStringify([() => 1])).toBe(stableStringify([undefined]));
        expect(stableStringify({ a: 1, f: () => 1 })).toBe('{"a":1}');
    });

    it("keeps an own __proto__ key", () => {
        const withProto = JSON.parse('{"__proto__":{"a":1},"b":2}') as unknown;
        expect(stableStringify(withProto)).toBe('{"__proto__":{"a":1},"b":2}');
        expect(stableStringify(withProto)).not.toBe(stableStringify({ b: 2 }));
    });

    it("throws a TypeError on a circular structure", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => stableStringify(cyclic)).toThrow(TypeError);
        const shared = { a: 1 };
        expect(stableStringify([shared, shared])).toBe('[{"a":1},{"a":1}]');
    });
});
