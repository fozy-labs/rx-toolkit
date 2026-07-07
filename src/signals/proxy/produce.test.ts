import { produce } from "./produce";

describe("produce", () => {
    describe("objects and arrays", () => {
        it("returns the base itself when the recipe changes nothing", () => {
            const base = { a: { b: 1 }, c: [1, 2, 3] };
            const next = produce(base, () => {
                // no changes
            });
            expect(next).toBe(base);
        });

        it("returns the base itself when a property is assigned its current value", () => {
            const base = { a: 1, nested: { b: 2 } };
            const next = produce(base, (draft) => {
                draft.a = 1;
                draft.nested.b = 2;
            });
            expect(next).toBe(base);
        });

        it("does not mutate the base", () => {
            const base = { a: { b: 1 }, c: [1, 2, 3] };
            produce(base, (draft) => {
                draft.a.b = 99;
                draft.c.push(4);
            });
            expect(base.a.b).toBe(1);
            expect(base.c).toEqual([1, 2, 3]);
        });

        it("preserves identity of untouched sibling subtrees", () => {
            const base = { a: { b: 1 }, sibling: { x: 10 } };
            const originalSibling = base.sibling;
            const next = produce(base, (draft) => {
                draft.a.b = 99;
            });
            expect(next.sibling).toBe(originalSibling);
        });

        it("changed subtree gets a new reference up to the root", () => {
            const base = { a: { b: { c: 1 } } };
            const originalA = base.a;
            const originalB = base.a.b;
            const next = produce(base, (draft) => {
                draft.a.b.c = 2;
            });
            expect(next).not.toBe(base);
            expect(next.a).not.toBe(originalA);
            expect(next.a.b).not.toBe(originalB);
            expect(next.a.b.c).toBe(2);
        });
    });

    describe("Map support", () => {
        it("map.set adds an entry copy-on-write (base map untouched)", () => {
            const base = { m: new Map<string, number>([["a", 1]]) };
            const next = produce(base, (draft) => {
                draft.m.set("b", 2);
            });
            expect(next.m).not.toBe(base.m);
            expect(next.m.get("b")).toBe(2);
            expect(base.m.has("b")).toBe(false);
        });

        it("map.delete removes an entry copy-on-write", () => {
            const base = {
                m: new Map<string, number>([
                    ["a", 1],
                    ["b", 2],
                ]),
            };
            const next = produce(base, (draft) => {
                draft.m.delete("a");
            });
            expect(next.m).not.toBe(base.m);
            expect(next.m.has("a")).toBe(false);
            expect(base.m.has("a")).toBe(true);
        });

        it("map.clear empties the map copy-on-write", () => {
            const base = {
                m: new Map<string, number>([
                    ["a", 1],
                    ["b", 2],
                ]),
            };
            const next = produce(base, (draft) => {
                draft.m.clear();
            });
            expect(next.m.size).toBe(0);
            expect(base.m.size).toBe(2);
        });

        it("map.get returns existing values", () => {
            const base = { m: new Map<string, number>([["a", 1]]) };
            let seen: number | undefined;
            produce(base, (draft) => {
                seen = draft.m.get("a");
            });
            expect(seen).toBe(1);
        });

        it("mutating a nested object obtained via map.get is copy-on-write and does not touch the base", () => {
            const base = { m: new Map<string, { v: number }>([["a", { v: 1 }]]) };
            const originalValue = base.m.get("a");
            const next = produce(base, (draft) => {
                const inner = draft.m.get("a")!;
                inner.v = 99;
            });
            expect(next.m).not.toBe(base.m);
            expect(next.m.get("a")!.v).toBe(99);
            expect(base.m.get("a")).toBe(originalValue);
            expect(originalValue!.v).toBe(1);
        });

        it("map.set with the same value for an existing key changes nothing (returns base)", () => {
            const base = { m: new Map<string, number>([["a", 1]]) };
            const next = produce(base, (draft) => {
                draft.m.set("a", 1);
            });
            expect(next).toBe(base);
        });

        it("size/has/iteration reflect draft mutations during the recipe", () => {
            const base = { m: new Map<string, number>([["a", 1]]) };
            let sizeSeen = 0;
            let hasSeen = false;
            const keysSeen: string[] = [];
            produce(base, (draft) => {
                draft.m.set("b", 2);
                sizeSeen = draft.m.size;
                hasSeen = draft.m.has("b");
                for (const [k] of draft.m) {
                    keysSeen.push(k);
                }
            });
            expect(sizeSeen).toBe(2);
            expect(hasSeen).toBe(true);
            expect(keysSeen).toEqual(["a", "b"]);
        });

        it("untouched sibling Map keeps reference identity", () => {
            const base = { m: new Map<string, number>([["a", 1]]), other: { x: 1 } };
            const originalMap = base.m;
            const next = produce(base, (draft) => {
                draft.other.x = 2;
            });
            expect(next.m).toBe(originalMap);
        });
    });

    describe("Set support", () => {
        it("set.add adds an element copy-on-write", () => {
            const base = { s: new Set<number>([1, 2]) };
            const next = produce(base, (draft) => {
                draft.s.add(3);
            });
            expect(next.s).not.toBe(base.s);
            expect(next.s.has(3)).toBe(true);
            expect(base.s.has(3)).toBe(false);
        });

        it("set.delete removes an element copy-on-write", () => {
            const base = { s: new Set<number>([1, 2]) };
            const next = produce(base, (draft) => {
                draft.s.delete(1);
            });
            expect(next.s).not.toBe(base.s);
            expect(next.s.has(1)).toBe(false);
            expect(base.s.has(1)).toBe(true);
        });

        it("set.clear empties the set copy-on-write", () => {
            const base = { s: new Set<number>([1, 2]) };
            const next = produce(base, (draft) => {
                draft.s.clear();
            });
            expect(next.s.size).toBe(0);
            expect(base.s.size).toBe(2);
        });

        it("add of an already-present element changes nothing (returns base)", () => {
            const base = { s: new Set<number>([1, 2]) };
            const next = produce(base, (draft) => {
                draft.s.add(1);
            });
            expect(next).toBe(base);
        });

        it("size/has/iteration reflect draft mutations during the recipe", () => {
            const base = { s: new Set<number>([1]) };
            let sizeSeen = 0;
            let hasSeen = false;
            const elemsSeen: number[] = [];
            produce(base, (draft) => {
                draft.s.add(2);
                sizeSeen = draft.s.size;
                hasSeen = draft.s.has(2);
                for (const v of draft.s) {
                    elemsSeen.push(v);
                }
            });
            expect(sizeSeen).toBe(2);
            expect(hasSeen).toBe(true);
            expect(elemsSeen).toEqual([1, 2]);
        });

        it("untouched sibling Set keeps reference identity", () => {
            const base = { s: new Set<number>([1]), other: { x: 1 } };
            const originalSet = base.s;
            const next = produce(base, (draft) => {
                draft.other.x = 2;
            });
            expect(next.s).toBe(originalSet);
        });
    });

    describe("class instances are atomic", () => {
        it("a class instance can be replaced by assignment", () => {
            class Point {
                constructor(
                    public x: number,
                    public y: number,
                ) {}
            }
            const base = { p: new Point(1, 2) };
            const replacement = new Point(3, 4);
            const next = produce(base, (draft) => {
                draft.p = replacement;
            });
            expect(next.p).toBe(replacement);
            expect(next.p).toBeInstanceOf(Point);
            expect(base.p.x).toBe(1);
        });

        it("an untouched class instance keeps reference identity", () => {
            class Point {
                constructor(
                    public x: number,
                    public y: number,
                ) {}
            }
            const base = { p: new Point(1, 2), other: { x: 1 } };
            const originalPoint = base.p;
            const next = produce(base, (draft) => {
                draft.other.x = 2;
            });
            expect(next.p).toBe(originalPoint);
        });
    });
});
