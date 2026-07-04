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

    describe("NaN", () => {
        it("NaN equals NaN", () => {
            expect(deepEqual(NaN, NaN)).toBe(true);
        });

        it("NaN vs number", () => {
            expect(deepEqual(NaN, 1)).toBe(false);
        });

        it("NaN inside objects", () => {
            expect(deepEqual({ a: NaN }, { a: NaN })).toBe(true);
        });
    });

    describe("dates", () => {
        it("equal dates", () => {
            expect(deepEqual(new Date("2024-01-01"), new Date("2024-01-01"))).toBe(true);
        });

        it("unequal dates", () => {
            expect(deepEqual(new Date(0), new Date(999999))).toBe(false);
        });

        it("date vs plain object", () => {
            expect(deepEqual(new Date(0), {})).toBe(false);
            expect(deepEqual({}, new Date(0))).toBe(false);
        });

        it("dates nested in objects", () => {
            expect(deepEqual({ d: new Date(100) }, { d: new Date(100) })).toBe(true);
            expect(deepEqual({ d: new Date(100) }, { d: new Date(200) })).toBe(false);
        });
    });

    describe("regexps", () => {
        it("equal regexps", () => {
            expect(deepEqual(/abc/, /abc/)).toBe(true);
            expect(deepEqual(/abc/gi, /abc/gi)).toBe(true);
        });

        it("different source", () => {
            expect(deepEqual(/abc/, /abd/)).toBe(false);
        });

        it("different flags", () => {
            expect(deepEqual(/abc/g, /abc/i)).toBe(false);
        });

        it("regexp vs plain object", () => {
            expect(deepEqual(/abc/, {})).toBe(false);
            expect(deepEqual({}, /abc/)).toBe(false);
        });
    });

    describe("maps", () => {
        it("equal maps", () => {
            expect(deepEqual(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(true);
        });

        it("different values", () => {
            expect(deepEqual(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
        });

        it("different keys", () => {
            expect(deepEqual(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(false);
        });

        it("different sizes", () => {
            expect(
                deepEqual(
                    new Map([["a", 1]]),
                    new Map([
                        ["a", 1],
                        ["b", 2],
                    ]),
                ),
            ).toBe(false);
        });

        it("deep-equal object keys and values", () => {
            expect(deepEqual(new Map([[{ id: 1 }, { v: "a" }]]), new Map([[{ id: 1 }, { v: "a" }]]))).toBe(true);
            expect(deepEqual(new Map([[{ id: 1 }, { v: "a" }]]), new Map([[{ id: 1 }, { v: "b" }]]))).toBe(false);
        });

        it("map vs plain object", () => {
            expect(deepEqual(new Map(), {})).toBe(false);
            expect(deepEqual({}, new Map())).toBe(false);
        });
    });

    describe("sets", () => {
        it("equal sets", () => {
            expect(deepEqual(new Set([1, 2, 3]), new Set([1, 2, 3]))).toBe(true);
        });

        it("order does not matter", () => {
            expect(deepEqual(new Set([1, 2, 3]), new Set([3, 1, 2]))).toBe(true);
        });

        it("different values", () => {
            expect(deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false);
        });

        it("different sizes", () => {
            expect(deepEqual(new Set([1]), new Set([1, 2]))).toBe(false);
        });

        it("deep-equal object elements", () => {
            expect(deepEqual(new Set([{ x: 1 }]), new Set([{ x: 1 }]))).toBe(true);
            expect(deepEqual(new Set([{ x: 1 }]), new Set([{ x: 2 }]))).toBe(false);
        });

        it("deep-equal duplicates are not matched twice", () => {
            // two distinct objects with the same shape stay in a Set (dedup is by reference)
            expect(deepEqual(new Set([{ x: 1 }, { x: 1 }]), new Set([{ x: 1 }, { x: 2 }]))).toBe(false);
        });

        it("set vs plain object", () => {
            expect(deepEqual(new Set(), {})).toBe(false);
            expect(deepEqual({}, new Set())).toBe(false);
        });
    });

    describe("array vs object", () => {
        it("array is not equal to object with same indexed keys", () => {
            expect(deepEqual(["a"], { 0: "a" })).toBe(false);
            expect(deepEqual({ 0: "a" }, ["a"])).toBe(false);
        });

        it("empty array is not equal to empty object", () => {
            expect(deepEqual([], {})).toBe(false);
            expect(deepEqual({}, [])).toBe(false);
        });
    });

    describe("circular references", () => {
        it("self-referencing objects with the same shape", () => {
            const a: any = { x: 1 };
            a.self = a;
            const b: any = { x: 1 };
            b.self = b;
            expect(deepEqual(a, b)).toBe(true);
        });

        it("self-referencing objects with different data", () => {
            const a: any = { x: 1 };
            a.self = a;
            const b: any = { x: 2 };
            b.self = b;
            expect(deepEqual(a, b)).toBe(false);
        });

        it("circular arrays", () => {
            const a: any[] = [1];
            a.push(a);
            const b: any[] = [1];
            b.push(b);
            expect(deepEqual(a, b)).toBe(true);
        });

        it("mutual cycles", () => {
            const a1: any = {};
            const a2: any = { ref: a1 };
            a1.ref = a2;
            const b1: any = {};
            const b2: any = { ref: b1 };
            b1.ref = b2;
            expect(deepEqual(a1, b1)).toBe(true);
        });

        it("cyclic vs acyclic with different data", () => {
            const a: any = { x: 1 };
            a.self = a;
            const b: any = { x: 1, self: { x: 2, self: null } };
            expect(deepEqual(a, b)).toBe(false);
        });
    });
});
