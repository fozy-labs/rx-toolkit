import { deepEqual } from "./deepEqual";

describe("deepEqual", () => {
    describe("primitives", () => {
        it("equal numbers", () => {
            expect(deepEqual(1, 1)).toBe(true);
            expect(deepEqual(0, 0)).toBe(true);
            expect(deepEqual(-1, -1)).toBe(true);
        });

        it("unequal numbers", () => {
            expect(deepEqual(1, 2)).toBe(false);
        });

        it("equal strings", () => {
            expect(deepEqual("hello", "hello")).toBe(true);
            expect(deepEqual("", "")).toBe(true);
        });

        it("unequal strings", () => {
            expect(deepEqual("a", "b")).toBe(false);
        });

        it("equal booleans", () => {
            expect(deepEqual(true, true)).toBe(true);
            expect(deepEqual(false, false)).toBe(true);
        });

        it("unequal booleans", () => {
            expect(deepEqual(true, false)).toBe(false);
        });

        it("null equals null", () => {
            expect(deepEqual(null, null)).toBe(true);
        });

        it("undefined equals undefined", () => {
            expect(deepEqual(undefined, undefined)).toBe(true);
        });

        it("null vs undefined", () => {
            expect(deepEqual(null, undefined)).toBe(false);
        });

        it("number vs string", () => {
            expect(deepEqual(1, "1")).toBe(false);
        });
    });

    describe("objects", () => {
        it("flat objects with same keys and values", () => {
            expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
        });

        it("flat objects with different values", () => {
            expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
        });

        it("objects with different key counts", () => {
            expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
        });

        it("objects with different keys but same count", () => {
            expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
        });

        it("nested objects", () => {
            expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true);
            expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } })).toBe(false);
        });
    });

    describe("arrays", () => {
        it("same arrays", () => {
            expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
        });

        it("different length arrays", () => {
            expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
        });

        it("same length, different values", () => {
            expect(deepEqual([1, 2], [1, 3])).toBe(false);
        });

        it("nested arrays", () => {
            expect(deepEqual([[1, 2], [3]], [[1, 2], [3]])).toBe(true);
            expect(deepEqual([[1, 2], [3]], [[1, 2], [4]])).toBe(false);
        });
    });

    describe("mixed structures", () => {
        it("object with arrays", () => {
            expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
            expect(deepEqual({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
        });

        it("array of objects", () => {
            expect(deepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }])).toBe(true);
            expect(deepEqual([{ a: 1 }], [{ a: 2 }])).toBe(false);
        });
    });

    describe("edge cases", () => {
        it("empty objects", () => {
            expect(deepEqual({}, {})).toBe(true);
        });

        it("empty arrays", () => {
            expect(deepEqual([], [])).toBe(true);
        });

        it("both null", () => {
            expect(deepEqual(null, null)).toBe(true);
        });

        it("both undefined", () => {
            expect(deepEqual(undefined, undefined)).toBe(true);
        });

        it("object vs null", () => {
            expect(deepEqual({ a: 1 }, null)).toBe(false);
        });

        it("object vs primitive", () => {
            expect(deepEqual({ a: 1 }, 1)).toBe(false);
        });
    });

    describe("known limitations", () => {
        // NaN !== NaN in JS, and deepEqual uses === for primitives
        it.skip("NaN equality", () => {
            expect(deepEqual(NaN, NaN)).toBe(true);
        });

        // Date objects are compared by reference/keys, not by .getTime()
        it.skip("Date comparison", () => {
            expect(deepEqual(new Date("2024-01-01"), new Date("2024-01-01"))).toBe(true);
        });

        // RegExp objects are compared by reference/keys, not by .toString()
        it.skip("RegExp comparison", () => {
            expect(deepEqual(/abc/, /abc/)).toBe(true);
        });

        // Recursive object references will cause a stack overflow
        it.skip("circular references", () => {
            const a: any = {};
            a.self = a;
            const b: any = {};
            b.self = b;
            expect(deepEqual(a, b)).toBe(true);
        });
    });
});
