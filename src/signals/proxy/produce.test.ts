import { types } from "node:util";

import { produce } from "./produce";

function containsProxy(value: unknown, seen = new Set<unknown>()): boolean {
    if (value === null || typeof value !== "object" || seen.has(value)) return false;
    if (types.isProxy(value)) return true;
    seen.add(value);
    const children =
        value instanceof Map
            ? [...value.keys(), ...value.values()]
            : value instanceof Set
              ? [...value]
              : Object.values(value);
    return children.some((child) => containsProxy(child, seen));
}

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

    describe("assigning the original value back", () => {
        it("drops the edits made through the child draft", () => {
            const base = { form: { name: "Ann" }, list: [{ n: 0 }] };
            const next = produce(base, (draft) => {
                draft.form.name = "typo";
                draft.form = base.form;
                draft.list[0].n = 1;
                draft.list[0] = base.list[0];
            });
            expect(next).toBe(base);
            expect(base).toEqual({ form: { name: "Ann" }, list: [{ n: 0 }] });
        });

        it("drops the edits made through a Map value draft", () => {
            const original = { n: 0 };
            const base = new Map([["k", original]]);
            const next = produce(base, (draft) => {
                draft.get("k")!.n = 1;
                draft.set("k", original);
            });
            expect(next).toBe(base);
            expect(original.n).toBe(0);
        });

        it("returns the base when an edit is reverted", () => {
            const base = { a: 1, m: new Map([["k", 1]]), s: new Set([1]) };
            const next = produce(base, (draft) => {
                draft.a = 2;
                draft.a = 1;
                draft.m.set("k", 2);
                draft.m.set("k", 1);
                draft.s.add(2);
                draft.s.delete(2);
            });
            expect(next).toBe(base);
        });

        it("keeps a changed key order", () => {
            const base = { a: 1, b: 2 };
            const next = produce(base, (draft) => {
                delete (draft as Partial<typeof base>).a;
                draft.a = 1;
            });
            expect(next).not.toBe(base);
            expect(Object.keys(next)).toEqual(["b", "a"]);
        });
    });

    describe("drafts placed into new containers", () => {
        it("a spread or filtered draft array holds the plain elements", () => {
            const base = {
                a: [{ id: 1 }, { id: 2 }],
                b: [
                    { id: 1, keep: true },
                    { id: 2, keep: false },
                ],
            };
            const next = produce(base, (draft) => {
                draft.a = [...draft.a, { id: 3 }];
                draft.b = draft.b.filter((item) => item.keep);
            });
            expect(containsProxy(next)).toBe(false);
            expect(next.a[0]).toBe(base.a[0]);
            expect(next.b).toEqual([base.b[0]]);
            expect(next.b[0]).toBe(base.b[0]);
        });

        it("an edited draft in a new object is finalized once and shared", () => {
            const base: { a: { x: number }; w?: { inner: { x: number } } } = { a: { x: 1 } };
            const next = produce(base, (draft) => {
                draft.a.x = 2;
                draft.w = { inner: draft.a };
            });
            expect(containsProxy(next)).toBe(false);
            expect(next.w!.inner).toBe(next.a);
            expect(next.a).toEqual({ x: 2 });
            expect(base.a).toEqual({ x: 1 });
        });

        it("a Map built from a draft Map holds the plain values", () => {
            const base = { m: new Map([["a", { x: 1 }]]), copy: new Map<string, { x: number }>() };
            const next = produce(base, (draft) => {
                draft.copy = new Map(draft.m);
            });
            expect(containsProxy(next)).toBe(false);
            expect(next.copy.get("a")).toBe(base.m.get("a"));
        });

        it("a draft added to a Set or used as a Map key is stored as the plain value", () => {
            const base = {
                items: [{ id: 1 }],
                picked: new Set<{ id: number }>(),
                byItem: new Map<{ id: number }, number>(),
            };
            const next = produce(base, (draft) => {
                draft.picked.add(draft.items[0]);
                draft.byItem.set(draft.items[0], 1);
            });
            expect(containsProxy(next)).toBe(false);
            expect(next.picked.has(base.items[0])).toBe(true);
            expect(next.byItem.get(base.items[0])).toBe(1);
        });

        it("leaves the assigned container itself untouched", () => {
            const base = { a: { x: 1 }, w: null as null | { inner: { x: number } } };
            let assigned: { inner: { x: number } } | null = null;
            const next = produce(base, (draft) => {
                draft.a.x = 2;
                assigned = { inner: draft.a };
                draft.w = assigned;
            });
            expect(next.w).not.toBe(assigned);
            expect(next.w!.inner).toBe(next.a);
        });
    });

    describe("large containers", () => {
        it("finalizing an edit reads only the changed entries of the base", () => {
            let reads = 0;
            let counting = false;
            const items = new Proxy(
                Array.from({ length: 1000 }, (_, id) => ({ id })),
                {
                    get(target, prop, receiver) {
                        if (counting) reads++;
                        return Reflect.get(target, prop, receiver);
                    },
                },
            );
            const next = produce({ items }, (draft) => {
                draft.items[5].id = -1;
                draft.items.push({ id: 1000 });
                counting = true;
            });
            expect(next.items[5]).toEqual({ id: -1 });
            expect(next.items).toHaveLength(1001);
            expect(reads).toBeLessThan(10);
        });
    });

    describe("fresh data assigned in the recipe", () => {
        type ListNode = { next: ListNode | { x: number } | null };

        function deepList(depth: number, tail: ListNode["next"] = null): ListNode {
            let head: ListNode = { next: tail };
            for (let i = 1; i < depth; i++) head = { next: head };
            return head;
        }

        function lastOf(list: ListNode): ListNode["next"] {
            let node: ListNode = list;
            while (node.next !== null && "next" in node.next) node = node.next;
            return node.next;
        }

        it("is not walked when the recipe handed out no child draft", () => {
            let walks = 0;
            const items = new Proxy([{ id: 1 }], {
                ownKeys(target) {
                    walks++;
                    return Reflect.ownKeys(target);
                },
            });
            const next = produce({ items: [] as { id: number }[] }, (draft) => {
                draft.items = items;
            });
            expect(next.items).toBe(items);
            expect(walks).toBe(0);
        });

        it("a deep list is kept as is", () => {
            const list = deepList(20000);
            const next = produce({ list: null as ListNode | null }, (draft) => {
                draft.list = list;
            });
            expect(next.list).toBe(list);
        });

        it("a deep list next to a child draft is finalized without overflowing the stack", () => {
            const list = deepList(20000);
            const next = produce({ meta: { n: 0 }, list: null as ListNode | null }, (draft) => {
                draft.meta.n = 1;
                draft.list = list;
            });
            expect(next.list).toBe(list);
            expect(next.meta).toEqual({ n: 1 });
        });

        it("a draft deep inside fresh data resolves to its result", () => {
            const base = { a: { x: 1 }, list: null as ListNode | null };
            const next = produce(base, (draft) => {
                draft.a.x = 2;
                draft.list = deepList(20000, draft.a);
            });
            expect(lastOf(next.list!)).toBe(next.a);
            expect(next.a).toEqual({ x: 2 });
            expect(types.isProxy(next.a)).toBe(false);
        });
    });

    describe("inherited members", () => {
        it("reading `__proto__` of an object draft returns the prototype, not a draft", () => {
            const base = { a: 1, o: { x: 1 } };
            const next = produce(base, (draft) => {
                expect(types.isProxy(Reflect.get(draft, "__proto__"))).toBe(false);
                void Reflect.get(draft.o, "__proto__");
                draft.a = 2;
                draft.o.x = 2;
            });
            expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
            expect(Object.getPrototypeOf(next.o)).toBe(Object.prototype);
            expect(next).toEqual({ a: 2, o: { x: 2 } });
        });

        it("reading `__proto__` of an array draft keeps the array prototype", () => {
            const base = { l: [1, 2] };
            const next = produce(base, (draft) => {
                void Reflect.get(draft.l, "__proto__");
                draft.l.push(3);
            });
            expect(Object.getPrototypeOf(next.l)).toBe(Array.prototype);
            expect(next.l).toEqual([1, 2, 3]);
        });
    });

    describe("writing undefined", () => {
        it("clears an existing key", () => {
            const base: { a?: number; o?: { x: number } } = { a: 1, o: { x: 1 } };
            const next = produce(base, (draft) => {
                draft.a = undefined;
                draft.o = undefined;
            });
            expect(next).toEqual({ a: undefined, o: undefined });
            expect(base).toEqual({ a: 1, o: { x: 1 } });
        });

        it("creates a missing key", () => {
            const base: { a?: number } = {};
            const next = produce(base, (draft) => {
                draft.a = undefined;
            });
            expect(next).not.toBe(base);
            expect("a" in next).toBe(true);
        });

        it("clears an array element", () => {
            const base: (number | undefined)[] = [1, 2, 3];
            const next = produce(base, (draft) => {
                draft[1] = undefined;
            });
            expect(next).toEqual([1, undefined, 3]);
        });

        it("Map.set(k, undefined) clears an existing key and creates a missing one", () => {
            const base = new Map<string, number | undefined>([["a", 1]]);
            const next = produce(base, (draft) => {
                draft.set("a", undefined);
                draft.set("b", undefined);
            });
            expect([...next]).toEqual([
                ["a", undefined],
                ["b", undefined],
            ]);
        });
    });

    describe("frozen base", () => {
        it("writes through a deep-frozen object", () => {
            const base = Object.freeze({ a: Object.freeze({ b: 1 }), c: 1 });
            const next = produce(base as { a: { b: number }; c: number }, (draft) => {
                draft.a.b = 2;
                draft.c = 2;
            });
            expect(next).toEqual({ a: { b: 2 }, c: 2 });
            expect(base).toEqual({ a: { b: 1 }, c: 1 });
        });

        it("pushes into a frozen array", () => {
            const base = Object.freeze([1, 2]);
            const next = produce(base as number[], (draft) => {
                draft.push(3);
            });
            expect(next).toEqual([1, 2, 3]);
            expect(Array.isArray(next)).toBe(true);
        });

        it("writes through a frozen Map value", () => {
            const base = { m: new Map([["a", Object.freeze({ x: 1 })]]) };
            const next = produce(base as { m: Map<string, { x: number }> }, (draft) => {
                draft.m.get("a")!.x = 2;
            });
            expect(next.m.get("a")).toEqual({ x: 2 });
        });

        it("reads a frozen base through the draft", () => {
            const base = Object.freeze({ a: Object.freeze({ b: 1 }), list: Object.freeze([1, 2]) });
            produce(base, (draft) => {
                expect(draft.a.b).toBe(1);
                expect(Object.keys(draft)).toEqual(["a", "list"]);
                expect({ ...draft.list }).toEqual({ 0: 1, 1: 2 });
                expect(Object.isFrozen(draft)).toBe(false);
            });
        });
    });

    describe("operations a draft does not support", () => {
        it.each([
            ["Object.defineProperty", (d: object) => Object.defineProperty(d, "x", { value: 1 })],
            ["Object.setPrototypeOf", (d: object) => Object.setPrototypeOf(d, null)],
            ["Object.preventExtensions", (d: object) => Object.preventExtensions(d)],
            ["Object.freeze", (d: object) => Object.freeze(d)],
        ])("%s throws and leaves the base as it was", (_, operation) => {
            const base = { a: { x: 1 }, m: new Map<string, number>(), s: new Set<number>() };
            produce(base, (draft) => {
                expect(() => operation(draft.a)).toThrow(TypeError);
                expect(() => operation(draft.m)).toThrow(TypeError);
                expect(() => operation(draft.s)).toThrow(TypeError);
            });
            expect(base).toEqual({ a: { x: 1 }, m: new Map(), s: new Set() });
            expect(Object.getPrototypeOf(base.a)).toBe(Object.prototype);
            expect(Object.isExtensible(base.a) && Object.isExtensible(base.m)).toBe(true);
        });

        it("assigning or deleting a property of a Map or Set draft throws and leaves the base as it was", () => {
            const base = { m: new Map<string, number>(), s: new Set<number>() };
            produce(base, (draft) => {
                expect(() => ((draft.m as unknown as Record<string, number>).x = 1)).toThrow(TypeError);
                expect(() => delete (draft.s as unknown as Record<string, number>).size).toThrow(TypeError);
            });
            expect(Object.keys(base.m)).toEqual([]);
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
