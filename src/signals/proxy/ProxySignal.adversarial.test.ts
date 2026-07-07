import { Signal } from "../signals";

import { produce } from "./produce";
import { debugNodeCount, PROXY_RAW, unstable_ProxySignal } from "./ProxySignal";

/** Non-reactive raw read of a proxy node (never subscribes / materialises). */
const raw = (node: unknown): unknown => (node as Record<symbol, unknown>)[PROXY_RAW];

describe("unstable_ProxySignal (adversarial)", () => {
    // ============================================================
    describe("produce: structural sharing & identity", () => {
        it("every node on a mutated 3-level path gets a fresh reference, siblings keep identity", () => {
            const base = { a: { b: { c: 1 }, sib: { z: 0 } }, top: { k: 9 } };
            const next = produce(base, (d) => {
                d.a.b.c = 2;
            });

            expect(next).not.toBe(base);
            expect(next.a).not.toBe(base.a);
            expect(next.a.b).not.toBe(base.a.b);
            expect(next.a.sib).toBe(base.a.sib); // untouched sibling subtree shared
            expect(next.top).toBe(base.top); // untouched top-level sibling shared
            expect(next.a.b.c).toBe(2);
        });

        it("never mutates the original base (deep)", () => {
            const base = { a: { b: { c: 1 } } };
            const snapshot = JSON.stringify(base);
            produce(base, (d) => {
                d.a.b.c = 999;
            });
            expect(JSON.stringify(base)).toBe(snapshot);
            expect(base.a.b.c).toBe(1);
        });

        it("a deep no-op recipe returns the SAME base reference", () => {
            const base = { a: { b: 1 } };
            const next = produce(base, (d) => {
                d.a.b = 1; // identical value → no clone anywhere
            });
            expect(next).toBe(base);
            expect(next.a).toBe(base.a);
        });

        it("redundant deep write does not clone the touched node", () => {
            const base = { a: { b: 5 } };
            const next = produce(base, (d) => {
                d.a.b = 5;
            });
            expect(next.a).toBe(base.a);
        });

        it("deleting a non-existent key is a no-op returning base", () => {
            const base: Record<string, number> = { a: 1 };
            const next = produce(base, (d) => {
                delete d.nope;
            });
            expect(next).toBe(base);
        });

        it("Object.assign into a draft shares untouched siblings", () => {
            const base = { a: { x: 1 }, b: { y: 2 } };
            const next = produce(base, (d) => {
                Object.assign(d, { a: { x: 5 } });
            });
            expect(next.a).toEqual({ x: 5 });
            expect(next.a).not.toBe(base.a);
            expect(next.b).toBe(base.b);
        });

        it("setting a leaf to its own value (d.x = d.x) is a no-op, no clone", () => {
            const base = { x: 7, other: { k: 1 } };
            const next = produce(base, (d) => {
                d.x = d.x;
            });
            expect(next).toBe(base);
        });

        it("does not clone an opaque leaf (Date) when a sibling changes", () => {
            const when = new Date(0);
            const base: { when: Date; other: number } = { when, other: 1 };
            const next = produce(base, (d) => {
                d.other = 2;
            });
            expect(next).not.toBe(base);
            expect(next.when).toBe(when); // identity preserved, not cloned
        });

        it("does not clone a class instance leaf when a sibling changes", () => {
            class Box {
                value = 1;
            }
            const box = new Box();
            const base: { box: Box; other: number } = { box, other: 1 };
            const next = produce(base, (d) => {
                d.other = 2;
            });
            expect(next.box).toBe(box);
        });

        it("building a new array via a pure array method (primitives) yields a plain array", () => {
            const base = { list: [1, 2, 3, 4] };
            const next = produce(base, (d) => {
                d.list = d.list.filter((n) => n % 2 === 0);
            });
            expect(next.list).toEqual([2, 4]);
            expect(Array.isArray(next.list)).toBe(true);
            expect(next.list).not.toBe(base.list);
            expect(base.list).toEqual([1, 2, 3, 4]); // base untouched
        });

        it("ignores the recipe's return value (assignment-expression form)", () => {
            const base = { a: 1 };
            const next = produce(base, (d) => (d.a = 5));
            expect(next.a).toBe(5);
        });

        it("ignores a recipe that only returns a fresh object (no mutation → base)", () => {
            const base = { a: 1 };
            const next = produce(base, () => ({ a: 999 }) as unknown as void);
            expect(next).toBe(base);
        });
    });

    // ============================================================
    describe("Object.is edges", () => {
        it("NaN → NaN is a no-op (value signal does not fire)", () => {
            const ps = unstable_ProxySignal.state<{ a: number }>({ a: NaN });
            const runs = vi.fn(() => ps.root.a());
            const eff = Signal.effect(runs);
            ps.mutate((d) => {
                d.a = NaN;
            });
            expect(runs).toHaveBeenCalledTimes(1);
            eff.unsubscribe();
        });

        it("+0 → -0 DOES fire (Object.is distinguishes signed zero)", () => {
            const ps = unstable_ProxySignal.state<{ a: number }>({ a: 0 });
            const seen: number[] = [];
            const eff = Signal.effect(() => seen.push(ps.root.a()));
            ps.mutate((d) => {
                d.a = -0;
            });
            expect(seen).toHaveLength(2);
            expect(Object.is(seen[1], -0)).toBe(true);
            eff.unsubscribe();
        });

        it("adding a key with undefined value: keys fire, value node stays asleep", () => {
            const ps = unstable_ProxySignal.state<Record<string, number | undefined>>({ a: 1 });
            const valueRuns = vi.fn(() => ps.root.b());
            const keysRuns = vi.fn(() => Object.keys(ps.root).sort().join(","));
            const ev = Signal.effect(valueRuns);
            const ek = Signal.effect(keysRuns);

            ps.mutate((d) => {
                d.b = undefined;
            });

            expect(valueRuns).toHaveBeenCalledTimes(1); // undefined → undefined
            expect(keysRuns).toHaveBeenCalledTimes(2); // key set grew
            expect("b" in ps.root).toBe(true);

            ev.unsubscribe();
            ek.unsubscribe();
        });

        it("deleting a key: value node fires to undefined and structure fires", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({ a: 1, b: 2 });
            const aRuns = vi.fn(() => ps.root.a());
            const keysRuns = vi.fn(() => Object.keys(ps.root).length);
            const ea = Signal.effect(aRuns);
            const ek = Signal.effect(keysRuns);

            ps.mutate((d) => {
                delete d.a;
            });

            expect(aRuns).toHaveBeenCalledTimes(2);
            expect(ps.root.a()).toBeUndefined();
            expect(keysRuns).toHaveBeenCalledTimes(2);

            ea.unsubscribe();
            ek.unsubscribe();
        });

        it("produce: NaN self-write returns the same base", () => {
            const base = { a: NaN };
            expect(produce(base, (d) => (d.a = NaN))).toBe(base);
        });

        it("produce: +0 → -0 clones (values are not Object.is-equal)", () => {
            const base = { a: 0 };
            const next = produce(base, (d) => (d.a = -0));
            expect(next).not.toBe(base);
            expect(Object.is(next.a, -0)).toBe(true);
        });
    });

    // ============================================================
    describe("arrays: hard mutations", () => {
        it("push does not wake an unchanged index but wakes length + keys", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2] });
            const idx0 = vi.fn(() => ps.root.list[0]());
            const len = vi.fn(() => ps.root.list.length());
            const keys = vi.fn(() => Object.keys(ps.root.list).length);
            const e0 = Signal.effect(idx0);
            const el = Signal.effect(len);
            const ek = Signal.effect(keys);

            ps.mutate((d) => {
                d.list.push(3);
            });

            expect(idx0).toHaveBeenCalledTimes(1);
            expect(len).toHaveBeenCalledTimes(2);
            expect(keys).toHaveBeenCalledTimes(2);
            expect(ps.peek().list).toEqual([1, 2, 3]);

            e0.unsubscribe();
            el.unsubscribe();
            ek.unsubscribe();
        });

        it("reverse of an odd array leaves the pivot index asleep", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3] });
            const mid = vi.fn(() => ps.root.list[1]());
            const first = vi.fn(() => ps.root.list[0]());
            const em = Signal.effect(mid);
            const ef = Signal.effect(first);

            ps.mutate((d) => {
                d.list.reverse();
            });

            expect(ps.peek().list).toEqual([3, 2, 1]);
            expect(mid).toHaveBeenCalledTimes(1); // pivot value unchanged
            expect(first).toHaveBeenCalledTimes(2); // 1 → 3

            em.unsubscribe();
            ef.unsubscribe();
        });

        it("sort with comparator reorders and wakes only changed indices", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [3, 1, 2] });
            const i1 = vi.fn(() => ps.root.list[1]());
            const e1 = Signal.effect(i1);

            ps.mutate((d) => {
                d.list.sort((a, b) => a - b);
            });
            expect(ps.peek().list).toEqual([1, 2, 3]);
            expect(i1).toHaveBeenCalledTimes(2); // index 1: 1 → 2

            e1.unsubscribe();
        });

        it("unshift shifts every element (all indices wake)", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3] });
            const i0 = vi.fn(() => ps.root.list[0]());
            const i2 = vi.fn(() => ps.root.list[2]());
            const e0 = Signal.effect(i0);
            const e2 = Signal.effect(i2);

            ps.mutate((d) => {
                d.list.unshift(0);
            });
            expect(ps.peek().list).toEqual([0, 1, 2, 3]);
            expect(i0).toHaveBeenCalledTimes(2); // 1 → 0
            expect(i2).toHaveBeenCalledTimes(2); // 3 → 2

            e0.unsubscribe();
            e2.unsubscribe();
        });

        it("pop wakes the removed tail index and length", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3] });
            const tail = vi.fn(() => ps.root.list[2]());
            const len = vi.fn(() => ps.root.list.length());
            const et = Signal.effect(tail);
            const el = Signal.effect(len);

            ps.mutate((d) => {
                d.list.pop();
            });
            expect(ps.peek().list).toEqual([1, 2]);
            expect(tail).toHaveBeenCalledTimes(2); // 3 → undefined
            expect(ps.root.list[2]()).toBeUndefined();
            expect(len).toHaveBeenCalledTimes(2);

            et.unsubscribe();
            el.unsubscribe();
        });

        it("growing via arr[5]=x creates holes; keys skip holes; length grows", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2] });
            const len = vi.fn(() => ps.root.list.length());
            const keys = vi.fn(() => Object.keys(ps.root.list).join(","));
            const el = Signal.effect(len);
            const ek = Signal.effect(keys);

            ps.mutate((d) => {
                d.list[5] = 9;
            });

            expect(ps.peek().list.length).toBe(6);
            expect(ps.root.list[5]()).toBe(9);
            expect(len).toHaveBeenCalledTimes(2); // 2 → 6
            expect(keys).toHaveBeenCalledTimes(2);
            expect(Object.keys(ps.peek().list)).toEqual(["0", "1", "5"]); // holes skipped

            el.unsubscribe();
            ek.unsubscribe();
        });

        it("setting .length shorter truncates and wakes dropped indices but not length watchers of unchanged len", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3, 4] });
            const dropped = vi.fn(() => ps.root.list[3]());
            const len = vi.fn(() => ps.root.list.length());
            const ed = Signal.effect(dropped);
            const el = Signal.effect(len);

            ps.mutate((d) => {
                d.list.length = 2;
            });
            expect(ps.peek().list).toEqual([1, 2]);
            expect(dropped).toHaveBeenCalledTimes(2); // 4 → undefined
            expect(len).toHaveBeenCalledTimes(2); // 4 → 2

            ed.unsubscribe();
            el.unsubscribe();
        });

        it("direct index assignment does not wake the length watcher", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3] });
            const len = vi.fn(() => ps.root.list.length());
            const idx0 = vi.fn(() => ps.root.list[0]());
            const el = Signal.effect(len);
            const e0 = Signal.effect(idx0);

            ps.mutate((d) => {
                d.list[0] = 9;
            });
            expect(len).toHaveBeenCalledTimes(1); // length unchanged
            expect(idx0).toHaveBeenCalledTimes(2); // value changed

            el.unsubscribe();
            e0.unsubscribe();
        });

        it("delete arr[0] creates a hole: structure changes, length does not", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3] });
            const len = vi.fn(() => ps.root.list.length());
            const keys = vi.fn(() => Object.keys(ps.root.list).join(","));
            const i0 = vi.fn(() => ps.root.list[0]());
            const el = Signal.effect(len);
            const ek = Signal.effect(keys);
            const e0 = Signal.effect(i0);

            ps.mutate((d) => {
                delete d.list[0];
            });
            expect(len).toHaveBeenCalledTimes(1); // length stays 3
            expect(keys).toHaveBeenCalledTimes(2); // key "0" removed
            expect(i0).toHaveBeenCalledTimes(2); // 1 → undefined

            el.unsubscribe();
            ek.unsubscribe();
            e0.unsubscribe();
        });

        it("fill overwrites every index", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3] });
            ps.mutate((d) => {
                d.list.fill(0);
            });
            expect(ps.peek().list).toEqual([0, 0, 0]);
        });

        it("copyWithin mutates through the draft", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3, 4, 5] });
            ps.mutate((d) => {
                d.list.copyWithin(0, 3);
            });
            expect(ps.peek().list).toEqual([4, 5, 3, 4, 5]);
        });

        it("deep edit inside an array of objects shares the untouched element", () => {
            const ps = unstable_ProxySignal.state<{ list: Array<{ v: number }> }>({ list: [{ v: 1 }, { v: 2 }] });
            const before = ps.peek().list[1];
            const el1 = vi.fn(() => ps.root.list[1].v());
            const eff = Signal.effect(el1);

            ps.mutate((d) => {
                d.list[0].v = 10;
            });
            expect(ps.peek().list[0].v).toBe(10);
            expect(ps.peek().list[1]).toBe(before); // untouched element identity
            expect(el1).toHaveBeenCalledTimes(1); // sibling element asleep

            eff.unsubscribe();
        });
    });

    // ============================================================
    describe("glitch-freedom & consistency", () => {
        it("effect reading a parent AND child sees one consistent snapshot, runs once", () => {
            const ps = unstable_ProxySignal.state<{ a: { b: number } }>({ a: { b: 1 } });
            const seen: Array<{ parent: { b: number }; child: number }> = [];
            const runs = vi.fn(() => {
                const parent = ps.root.a();
                const child = ps.root.a.b();
                seen.push({ parent, child });
            });
            const eff = Signal.effect(runs);

            ps.mutate((d) => {
                d.a.b = 2;
            });

            expect(runs).toHaveBeenCalledTimes(2);
            const last = seen[seen.length - 1];
            expect(last.child).toBe(2);
            expect(last.parent).toEqual({ b: 2 });
            expect(last.parent.b).toBe(last.child); // no torn read

            eff.unsubscribe();
        });

        it("diamond through a computed re-runs the observer exactly once", () => {
            const ps = unstable_ProxySignal.state<{ a: number; b: number }>({ a: 1, b: 2 });
            const sum = Signal.compute(() => ps.root.a() + ps.root.b());
            const runs = vi.fn(() => sum());
            const eff = Signal.effect(runs);

            expect(runs).toHaveBeenCalledTimes(1);
            ps.mutate((d) => {
                d.a = 10;
                d.b = 20;
            });
            expect(runs).toHaveBeenCalledTimes(2);
            expect(sum.peek()).toBe(30);

            eff.unsubscribe();
            sum.dispose();
        });

        it("effect reading a raw path AND a computed of that path stays consistent", () => {
            const ps = unstable_ProxySignal.state<{ a: number; b: number }>({ a: 1, b: 2 });
            const sum = Signal.compute(() => ps.root.a() + ps.root.b());
            const seen: Array<[number, number]> = [];
            const runs = vi.fn(() => seen.push([ps.root.a(), sum()]));
            const eff = Signal.effect(runs);

            ps.mutate((d) => {
                d.a = 10;
            });
            expect(runs).toHaveBeenCalledTimes(2);
            expect(seen[1]).toEqual([10, 12]); // no glitch: a and (a+b) agree

            eff.unsubscribe();
            sum.dispose();
        });

        it("changing two disjoint deep paths read by one effect re-runs it once", () => {
            const ps = unstable_ProxySignal.state<{ a: { b: number }; c: { d: number } }>({
                a: { b: 1 },
                c: { d: 2 },
            });
            const runs = vi.fn(() => ps.root.a.b() + ps.root.c.d());
            const eff = Signal.effect(runs);

            ps.mutate((d) => {
                d.a.b = 10;
                d.c.d = 20;
            });
            expect(runs).toHaveBeenCalledTimes(2);

            eff.unsubscribe();
        });
    });

    // ============================================================
    describe("set() whole-tree replacement (per-node dedupe)", () => {
        it("structurally-equal but new-ref tree wakes container node but not equal leaves", () => {
            const ps = unstable_ProxySignal.state<{ a: number; b: { c: number } }>({ a: 1, b: { c: 2 } });
            const aRuns = vi.fn(() => ps.root.a());
            const bRuns = vi.fn(() => ps.root.b());
            const cRuns = vi.fn(() => ps.root.b.c());
            const ea = Signal.effect(aRuns);
            const eb = Signal.effect(bRuns);
            const ec = Signal.effect(cRuns);

            ps.set({ a: 1, b: { c: 2 } }); // new refs, deep-equal values

            expect(aRuns).toHaveBeenCalledTimes(1); // leaf 1 === 1, asleep
            expect(cRuns).toHaveBeenCalledTimes(1); // leaf 2 === 2, asleep
            expect(bRuns).toHaveBeenCalledTimes(2); // container ref changed → wake

            ea.unsubscribe();
            eb.unsubscribe();
            ec.unsubscribe();
        });

        it("set() to a structurally different tree re-materialises correct values", () => {
            const ps = unstable_ProxySignal.state<{ a?: { b?: number }; x?: number }>({ a: { b: 1 } });
            const seen: Array<number | undefined> = [];
            const eff = Signal.effect(() => seen.push(ps.root.a.b()));

            ps.set({ x: 5 }); // a removed entirely
            expect(seen).toEqual([1, undefined]);

            ps.set({ a: { b: 42 } }); // a.b resurrected
            expect(seen).toEqual([1, undefined, 42]);

            eff.unsubscribe();
        });

        it("set() to Object.is-equal reference is a no-op", () => {
            const root = { a: 1 };
            const ps = unstable_ProxySignal.state(root);
            const runs = vi.fn(() => ps.root.a());
            const eff = Signal.effect(runs);
            ps.set(root);
            expect(runs).toHaveBeenCalledTimes(1);
            eff.unsubscribe();
        });
    });

    // ============================================================
    describe("prune / lifecycle under churn", () => {
        it("two effects on the same path keep the node until BOTH drop", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({ a: 1 });
            const e1 = Signal.effect(() => ps.root.a());
            const e2 = Signal.effect(() => ps.root.a());
            expect(debugNodeCount(ps)).toBe(2);

            e1.unsubscribe();
            expect(debugNodeCount(ps)).toBe(2); // still one observer

            e2.unsubscribe();
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("a node with both a value and a keys signal survives until both are cold", () => {
            const ps = unstable_ProxySignal.state<{ sub: Record<string, number> }>({ sub: { a: 1 } });
            const valueEff = Signal.effect(() => ps.root.sub());
            const keysEff = Signal.effect(() => Object.keys(ps.root.sub).length);
            expect(debugNodeCount(ps)).toBe(2); // root + sub

            valueEff.unsubscribe();
            expect(debugNodeCount(ps)).toBe(2); // keys signal keeps sub alive

            keysEff.unsubscribe();
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("dropping only the child dependency prunes just the child, keeps the parent", () => {
            const ps = unstable_ProxySignal.state<{ a: { b: number } }>({ a: { b: 1 } });
            const toggle = Signal.state(true);
            const eff = Signal.effect(() => {
                ps.root.a();
                if (toggle()) ps.root.a.b();
            });
            expect(debugNodeCount(ps)).toBe(3); // root + a + b

            toggle.set(false); // drops the a.b read
            expect(debugNodeCount(ps)).toBe(2); // root + a only

            eff.unsubscribe();
            expect(debugNodeCount(ps)).toBe(1);
            toggle.dispose();
        });

        it("dynamic-dependency effect prunes the dropped path and materialises the new one", () => {
            const ps = unstable_ProxySignal.state<{ a: number; b: number }>({ a: 1, b: 2 });
            const which = Signal.state<"a" | "b">("a");
            const seen: number[] = [];
            const eff = Signal.effect(() => {
                seen.push(which() === "a" ? ps.root.a() : ps.root.b());
            });
            expect(debugNodeCount(ps)).toBe(2); // root + a

            which.set("b");
            expect(seen).toEqual([1, 2]);
            expect(debugNodeCount(ps)).toBe(2); // root + b (a pruned)

            // Now mutating a must NOT wake the effect (dependency dropped).
            ps.mutate((d) => {
                d.a = 100;
            });
            expect(seen).toEqual([1, 2]);

            // ...but mutating b must, with the fresh current value.
            ps.mutate((d) => {
                d.b = 20;
            });
            expect(seen).toEqual([1, 2, 20]);

            eff.unsubscribe();
            which.dispose();
        });

        it("re-materialisation after prune returns the CURRENT value, not a stale one", () => {
            const ps = unstable_ProxySignal.state<{ a: number }>({ a: 1 });
            const e1 = Signal.effect(() => ps.root.a());
            e1.unsubscribe(); // node a pruned
            expect(debugNodeCount(ps)).toBe(1);

            ps.mutate((d) => {
                d.a = 77;
            }); // no live node for a during this change

            const seen: number[] = [];
            const e2 = Signal.effect(() => seen.push(ps.root.a()));
            expect(seen).toEqual([77]); // fresh node seeded from current raw

            e2.unsubscribe();
        });

        it("intermediate chain prunes fully to root when the leaf observer drops", () => {
            const ps = unstable_ProxySignal.state<{ a?: { b?: { c?: number } } }>({});
            const eff = Signal.effect(() => ps.root.a.b.c());
            expect(debugNodeCount(ps)).toBe(4);
            eff.unsubscribe();
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("heavy key rotation leaves node count at 1", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({});
            for (let i = 0; i < 200; i++) {
                const eff = Signal.effect(() => ps.root[`k${i % 7}`]());
                eff.unsubscribe();
            }
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("non-tracked reads never create nodes", () => {
            const ps = unstable_ProxySignal.state<{ a: { b: number } }>({ a: { b: 1 } });
            ps.root.a();
            ps.root.a.b();
            Object.keys(ps.root);
            void ("a" in ps.root);
            void raw(ps.root.a.b);
            expect(debugNodeCount(ps)).toBe(1);
        });
    });

    // ============================================================
    describe("deletion & resurrection with a persistent subscriber", () => {
        it("deep node fires to undefined on ancestor delete, then back on re-add (same effect)", () => {
            const ps = unstable_ProxySignal.state<{ a?: { b?: number } }>({ a: { b: 1 } });
            const seen: Array<number | undefined> = [];
            const eff = Signal.effect(() => seen.push(ps.root.a.b()));

            expect(seen).toEqual([1]);

            ps.mutate((d) => {
                delete d.a;
            });
            expect(seen).toEqual([1, undefined]);

            ps.mutate((d) => {
                d.a = { b: 9 };
            });
            expect(seen).toEqual([1, undefined, 9]);

            eff.unsubscribe();
        });

        it("replacing a container with a leaf, then back, drives the deep subscriber", () => {
            const ps = unstable_ProxySignal.state<{ a: unknown }>({ a: { b: 1 } });
            const seen: Array<unknown> = [];
            const eff = Signal.effect(() => seen.push((ps.root.a as unknown as { b(): unknown }).b()));

            ps.set({ a: 5 }); // a is now a leaf; a.b → undefined
            ps.set({ a: { b: 2 } }); // a.b resurrected
            expect(seen).toEqual([1, undefined, 2]);

            eff.unsubscribe();
        });
    });

    // ============================================================
    describe("opaque leaves", () => {
        it("navigating into a Set yields undefined and reference replacement wakes", () => {
            const s1 = new Set([1]);
            const ps = unstable_ProxySignal.state<{ s: Set<number> }>({ s: s1 });
            expect(ps.root.s()).toBe(s1);
            expect(raw((ps.root.s as unknown as Record<string, unknown>).size)).toBeUndefined();

            const runs = vi.fn(() => ps.root.s());
            const eff = Signal.effect(runs);
            const s2 = new Set([2]);
            ps.mutate((d) => {
                d.s = s2;
            });
            expect(ps.root.s()).toBe(s2);
            expect(runs).toHaveBeenCalledTimes(2);
            eff.unsubscribe();
        });

        it("a class instance is an opaque leaf: navigation stops, identity preserved by produce", () => {
            class Box {
                value = 1;
            }
            const box = new Box();
            const ps = unstable_ProxySignal.state<{ box: Box; n: number }>({ box, n: 0 });
            expect(ps.root.box()).toBe(box);
            expect(raw((ps.root.box as unknown as Record<string, unknown>).value)).toBeUndefined();

            ps.mutate((d) => {
                d.n = 1; // touch a sibling only
            });
            expect(ps.peek().box).toBe(box); // not cloned
        });

        it("mutating a Map in place is invisible (opaque, not diffed)", () => {
            const m = new Map<string, number>([["k", 1]]);
            const ps = unstable_ProxySignal.state<{ m: Map<string, number> }>({ m });
            const runs = vi.fn(() => ps.root.m());
            const eff = Signal.effect(runs);

            ps.mutate((d) => {
                d.m.set("k", 2); // same Map reference → no diff
            });
            expect(runs).toHaveBeenCalledTimes(1); // reference unchanged

            eff.unsubscribe();
        });
    });

    // ============================================================
    describe("coercion / navigation robustness", () => {
        it("template / String / JSON coercion never throws", () => {
            const ps = unstable_ProxySignal.state({ a: { b: 1 } });
            expect(() => `${ps.root}`).not.toThrow();
            expect(() => String(ps.root.a)).not.toThrow();
            expect(() => JSON.stringify(ps.root)).not.toThrow();
        });

        it("is not thenable and await resolves to the proxy (no hang)", async () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            expect((ps.root as unknown as { then?: unknown }).then).toBeUndefined();
            const resolved = await (ps.root as unknown as Promise<unknown>);
            expect(resolved).toBe(ps.root);
        });

        it("hasOwnProperty-style probes do not crash and report structure", () => {
            const ps = unstable_ProxySignal.state<{ a: number }>({ a: 1 });
            const probe = ps.root as unknown as { hasOwnProperty(k: string): boolean };
            expect(() => probe.hasOwnProperty("a")).not.toThrow();
        });

        it("Object.keys / for-in / in agree on a plain object", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({ x: 1, y: 2 });
            expect(Object.keys(ps.root).sort()).toEqual(["x", "y"]);
            const seen: string[] = [];
            for (const k in ps.root) seen.push(k);
            expect(seen.sort()).toEqual(["x", "y"]);
            expect("x" in ps.root).toBe(true);
            expect("z" in ps.root).toBe(false);
        });

        it("numeric-string, empty-string and Object.create(null) keys are navigable", () => {
            const base: Record<string, number> = Object.create(null);
            base["0"] = 10;
            base[""] = 20;
            const ps = unstable_ProxySignal.state(base);
            expect(ps.root["0"]()).toBe(10);
            expect(ps.root[""]()).toBe(20);
            expect(Object.keys(ps.root).sort()).toEqual(["", "0"]);
        });
    });

    // ============================================================
    describe("draft misuse & safety", () => {
        it("rejects reading an escaped draft after the recipe returns", () => {
            const ps = unstable_ProxySignal.state({ a: { b: 1 } });
            let escaped: { b: number } | undefined;
            ps.mutate((d) => {
                escaped = d.a;
            });
            expect(() => escaped!.b).toThrow(/escaped/);
        });

        it("spreading a draft into a fresh object then assigning works with primitives", () => {
            const ps = unstable_ProxySignal.state<{ a: number; b: number }>({ a: 1, b: 2 });
            ps.mutate((d) => {
                const snapshot = { ...d };
                d.a = snapshot.b; // 2
                d.b = snapshot.a; // 1
            });
            expect(ps.peek()).toEqual({ a: 2, b: 1 });
        });

        it("reading a nested draft then reassigning its parent key uses the new value", () => {
            const ps = unstable_ProxySignal.state<{ a: { b: number } }>({ a: { b: 1 } });
            ps.mutate((d) => {
                void d.a; // materialise the nested draft
                d.a = { b: 99 };
            });
            expect(ps.peek().a).toEqual({ b: 99 });
        });
    });

    // ============================================================
    describe("dispose semantics", () => {
        it("all reads throw after dispose", () => {
            const ps = unstable_ProxySignal.state({ a: { b: 1 } });
            ps.dispose();
            expect(() => ps.peek()).toThrow(/disposed/);
            expect(() => ps.root.a()).toThrow(/disposed/);
            expect(() => ps.root.a.b()).toThrow(/disposed/);
        });

        it("obs of a disposed tree completes existing subscribers", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            let completed = false;
            const sub = ps.obs.subscribe({ complete: () => (completed = true) });
            ps.dispose();
            expect(completed).toBe(true);
            sub.unsubscribe();
        });
    });

    // ============================================================
    describe("re-entrancy", () => {
        it("an effect writing back into the store during its run settles consistently", () => {
            const ps = unstable_ProxySignal.state<{ a: number; mirror: number }>({ a: 1, mirror: 0 });
            const eff = Signal.effect(() => {
                const a = ps.root.a();
                if (ps.peek().mirror !== a) {
                    ps.mutate((d) => {
                        d.mirror = a;
                    });
                }
            });
            ps.mutate((d) => {
                d.a = 5;
            });
            expect(ps.peek().mirror).toBe(5);
            eff.unsubscribe();
        });
    });

    // ============================================================
    // Regression tests for a real defect found while attacking the
    // implementation: produce() used to store an assigned value verbatim even
    // when it was (or contained) a live draft proxy, poisoning the output tree
    // with drafts that throw "…draft escaped…" on any later access. Fixed by
    // finalizing/unwrapping assigned drafts in _finalize (immer-style).
    // ============================================================
    describe("assigned-draft unwrapping (regression)", () => {
        it("copying a sibling subtree (d.a = d.b) yields a usable plain tree", () => {
            const base = { a: { x: 1 }, b: { y: 2 } };
            const next = produce(base, (d) => {
                d.a = d.b as unknown as typeof d.a;
            });
            expect(next.a).toEqual({ y: 2 });
            // Assigning an untouched sibling shares its identity.
            expect(next.a).toBe(base.b);
        });

        it("conditional self-assign (d.a = cond ? new : d.a) does not poison the store", () => {
            const ps = unstable_ProxySignal.state<{ a: { b: number } }>({ a: { b: 1 } });
            ps.mutate((d) => {
                const keep = true;
                d.a = keep ? d.a : { b: 0 };
            });
            expect(ps.peek().a.b).toBe(1);
        });

        it("rebuilding an array of objects via map() yields a usable tree", () => {
            const base = { list: [{ v: 1 }, { v: 2 }] };
            const next = produce(base, (d) => {
                // map()/filter() read elements through the draft, so the new
                // array is populated with child draft proxies.
                d.list = d.list.map((e) => e);
            });
            expect(next.list.map((e) => e.v)).toEqual([1, 2]);
            // Untouched elements keep identity after unwrapping.
            expect(next.list[0]).toBe(base.list[0]);
        });

        it("unwraps drafts nested in an assigned plain object", () => {
            const base = { a: { x: 1 }, b: { y: 2 }, out: {} as Record<string, unknown> };
            const next = produce(base, (d) => {
                d.out = { copyOfA: d.a, copyOfB: d.b };
            });
            expect(next.out).toEqual({ copyOfA: { x: 1 }, copyOfB: { y: 2 } });
            expect(next.out.copyOfA).toBe(base.a);
        });

        it("finalizes a mutated draft assigned to another key (aliasing)", () => {
            const base = { a: { n: 1 }, b: { n: 0 } };
            const next = produce(base, (d) => {
                d.a.n = 5; // mutate the a-draft
                d.b = d.a; // then alias it under b
            });
            expect(next.a).toEqual({ n: 5 });
            expect(next.b).toEqual({ n: 5 });
            expect(next.a).toBe(next.b); // same finalized object
            expect(base.a.n).toBe(1); // base untouched
        });
    });
});
