import { Signal } from "../signals";

import { produce } from "./produce";
import { debugNodeCount, PROXY_RAW, unstable_ProxySignal } from "./ProxySignal";

describe("unstable_ProxySignal", () => {
    describe("basic reads", () => {
        it("peek() returns the whole raw tree", () => {
            const initial = { a: 1, b: { c: 2 } };
            const ps = unstable_ProxySignal.state(initial);
            expect(ps.peek()).toBe(initial);
        });

        it("node() returns the value at its path", () => {
            const ps = unstable_ProxySignal.state({ a: 1, b: { c: 2 } });
            expect(ps.root.a()).toBe(1);
            expect(ps.root.b()).toEqual({ c: 2 });
            expect(ps.root.b.c()).toBe(2);
            expect(ps.root()).toEqual({ a: 1, b: { c: 2 } });
        });

        it("reading an absent path yields undefined", () => {
            const ps = unstable_ProxySignal.state<{ a?: { b?: number } }>({});
            expect(ps.root.a()).toBeUndefined();
            expect(ps.root.a.b()).toBeUndefined();
        });

        it("[PROXY_RAW] reads a node non-reactively", () => {
            const ps = unstable_ProxySignal.state({ a: { b: 1 } });
            const eff = Signal.effect(() => {
                // Reading via PROXY_RAW must not establish a dependency.
                void (ps.root.a as unknown as Record<symbol, unknown>)[PROXY_RAW];
            });
            expect(debugNodeCount(ps)).toBe(1);
            eff.unsubscribe();
        });
    });

    describe("value reactivity", () => {
        it("re-runs an effect when the read path changes", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            const seen: number[] = [];
            const eff = Signal.effect(() => seen.push(ps.root.a()));

            expect(seen).toEqual([1]);
            ps.mutate((d) => {
                d.a = 2;
            });
            expect(seen).toEqual([1, 2]);

            eff.unsubscribe();
        });

        it("does NOT re-run when a sibling path changes (point invalidation)", () => {
            const ps = unstable_ProxySignal.state({ a: 1, b: 2 });
            const runs = vi.fn(() => ps.root.a());
            const eff = Signal.effect(runs);

            expect(runs).toHaveBeenCalledTimes(1);
            ps.mutate((d) => {
                d.b = 20;
            });
            expect(runs).toHaveBeenCalledTimes(1);

            ps.mutate((d) => {
                d.a = 10;
            });
            expect(runs).toHaveBeenCalledTimes(2);

            eff.unsubscribe();
        });

        it("wakes an ancestor subscription on a deep change (copy-on-write)", () => {
            const ps = unstable_ProxySignal.state({ a: { b: { c: 1 } } });
            const seen: Array<{ b: { c: number } }> = [];
            const eff = Signal.effect(() => seen.push(ps.root.a()));

            expect(seen).toHaveLength(1);
            ps.mutate((d) => {
                d.a.b.c = 2;
            });
            expect(seen).toHaveLength(2);
            expect(seen[1]).toEqual({ b: { c: 2 } });

            eff.unsubscribe();
        });

        it("does NOT wake an ancestor when an untouched sibling subtree is left alone", () => {
            const ps = unstable_ProxySignal.state({ a: { x: 1 }, b: { y: 2 } });
            const aRuns = vi.fn(() => ps.root.a());
            const eff = Signal.effect(aRuns);

            ps.mutate((d) => {
                d.b.y = 20;
            });
            expect(aRuns).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });

        it("dedupes writes with Object.is (no-op update notifies nobody)", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            const runs = vi.fn(() => ps.root.a());
            const eff = Signal.effect(runs);

            ps.mutate((d) => {
                d.a = 1;
            });
            expect(runs).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });
    });

    describe("structural reactivity", () => {
        it("Object.keys() re-runs on add/remove, not on value change", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({ a: 1 });
            const keys: string[] = [];
            const eff = Signal.effect(() => keys.push(Object.keys(ps.root).sort().join(",")));

            expect(keys).toEqual(["a"]);

            ps.mutate((d) => {
                d.a = 99; // value change, same key set
            });
            expect(keys).toEqual(["a"]);

            ps.mutate((d) => {
                d.b = 2; // add key
            });
            expect(keys).toEqual(["a", "a,b"]);

            ps.mutate((d) => {
                delete d.a; // remove key
            });
            expect(keys).toEqual(["a", "a,b", "b"]);

            eff.unsubscribe();
        });

        it("`in` re-runs only when that structure changes", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({ a: 1 });
            const present: boolean[] = [];
            const eff = Signal.effect(() => present.push("b" in ps.root));

            expect(present).toEqual([false]);

            ps.mutate((d) => {
                d.a = 5; // value change — structure unchanged
            });
            expect(present).toEqual([false]);

            ps.mutate((d) => {
                d.b = 2; // structure change
            });
            expect(present).toEqual([false, true]);

            eff.unsubscribe();
        });

        it("value subscription is independent of the structural signal", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({ a: 1 });
            const valueRuns = vi.fn(() => ps.root.a());
            const eff = Signal.effect(valueRuns);

            ps.mutate((d) => {
                d.b = 2; // structural change only, `a` value untouched
            });
            expect(valueRuns).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });
    });

    describe("arrays", () => {
        it("reactive length and index reads", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2] });
            const lengths: number[] = [];
            const eff = Signal.effect(() => lengths.push(ps.root.list.length()));

            expect(lengths).toEqual([2]);
            ps.mutate((d) => {
                d.list.push(3);
            });
            expect(lengths).toEqual([2, 3]);
            expect(ps.peek().list).toEqual([1, 2, 3]);

            eff.unsubscribe();
        });

        it("does not wake an unchanged index on push", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2] });
            const idxRuns = vi.fn(() => ps.root.list[0]());
            const eff = Signal.effect(idxRuns);

            ps.mutate((d) => {
                d.list.push(3); // index 0 unchanged
            });
            expect(idxRuns).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });

        it("splice replaces elements structurally", () => {
            const ps = unstable_ProxySignal.state<{ list: number[] }>({ list: [1, 2, 3] });
            const el1: Array<number | undefined> = [];
            const eff = Signal.effect(() => el1.push(ps.root.list[1]()));

            ps.mutate((d) => {
                d.list.splice(1, 1); // remove middle
            });
            expect(ps.peek().list).toEqual([1, 3]);
            expect(el1).toEqual([2, 3]); // index 1 now holds 3

            eff.unsubscribe();
        });
    });

    describe("set() whole-tree replacement", () => {
        it("replaces the tree and fires only nodes whose value changed", () => {
            const ps = unstable_ProxySignal.state({ a: 1, b: 2 });
            const aRuns = vi.fn(() => ps.root.a());
            const bRuns = vi.fn(() => ps.root.b());
            const ea = Signal.effect(aRuns);
            const eb = Signal.effect(bRuns);

            ps.set({ a: 1, b: 3 }); // a value equal → no wake; b changed → wake

            expect(aRuns).toHaveBeenCalledTimes(1);
            expect(bRuns).toHaveBeenCalledTimes(2);
            expect(ps.peek()).toEqual({ a: 1, b: 3 });

            ea.unsubscribe();
            eb.unsubscribe();
        });

        it("ignores a set() to an Object.is-equal reference", () => {
            const root = { a: 1 };
            const ps = unstable_ProxySignal.state(root);
            const runs = vi.fn(() => ps.root.a());
            const eff = Signal.effect(runs);

            ps.set(root);
            expect(runs).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });
    });

    describe("opaque leaves (Map/Set/class instances)", () => {
        it("treats a Map as an opaque leaf and reacts to reference replacement", () => {
            const m1 = new Map([["k", 1]]);
            const ps = unstable_ProxySignal.state<{ m: Map<string, number> }>({ m: m1 });

            expect(ps.root.m()).toBe(m1);
            // Navigation does not reach inside a Map.
            const mapLeaf = ps.root.m as unknown as Record<string, Record<symbol, unknown>>;
            expect(mapLeaf.k[PROXY_RAW]).toBeUndefined();

            const runs = vi.fn(() => ps.root.m());
            const eff = Signal.effect(runs);

            const m2 = new Map<string, number>();
            ps.mutate((d) => {
                d.m = m2;
            });
            expect(ps.root.m()).toBe(m2);
            expect(runs).toHaveBeenCalledTimes(2);

            eff.unsubscribe();
        });
    });

    describe("garbage collection", () => {
        it("materialises a node lazily and prunes it when the last observer drops", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({});
            expect(debugNodeCount(ps)).toBe(1);

            const eff = Signal.effect(() => ps.root.k());
            expect(debugNodeCount(ps)).toBe(2);

            eff.unsubscribe();
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("prunes an intermediate chain up to the root", () => {
            const ps = unstable_ProxySignal.state<{ a?: { b?: { c?: number } } }>({});
            const eff = Signal.effect(() => ps.root.a.b.c());
            expect(debugNodeCount(ps)).toBe(4); // root + a + b + c

            eff.unsubscribe();
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("does not leak under key rotation", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({});
            for (let i = 0; i < 50; i++) {
                const eff = Signal.effect(() => ps.root[`k${i}`]());
                eff.unsubscribe();
            }
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("does not create nodes for non-tracked reads", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            ps.root.a();
            Object.keys(ps.root);
            expect(debugNodeCount(ps)).toBe(1);
        });

        it("keeps a node alive while any of its two signals is observed", () => {
            const ps = unstable_ProxySignal.state<Record<string, number>>({ a: 1 });
            const valueEff = Signal.effect(() => ps.root.a());
            const keysEff = Signal.effect(() => Object.keys(ps.root));
            expect(debugNodeCount(ps)).toBe(2);

            valueEff.unsubscribe(); // keys signal still observed on root's child? (root keys)
            // Root keys signal lives on the root node, which is never pruned;
            // node `a` had only a value signal, now cold → pruned.
            expect(debugNodeCount(ps)).toBe(1);

            keysEff.unsubscribe();
            expect(debugNodeCount(ps)).toBe(1);
        });
    });

    describe("whole-tree obs", () => {
        it("emits the current root and every subsequent change", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            const seen: number[] = [];
            const sub = ps.obs.subscribe((v) => seen.push(v.a));

            ps.mutate((d) => {
                d.a = 2;
            });
            ps.mutate((d) => {
                d.a = 3;
            });
            expect(seen).toEqual([1, 2, 3]);

            sub.unsubscribe();
        });
    });

    describe("computed integration", () => {
        it("derives through a computed with a consistent snapshot", () => {
            const ps = unstable_ProxySignal.state({ a: 2 });
            const doubled = Signal.compute(() => ps.root.a() * 10);
            expect(doubled()).toBe(20);

            const seen: number[] = [];
            const eff = Signal.effect(() => seen.push(doubled()));

            ps.mutate((d) => {
                d.a = 3;
            });
            expect(seen).toEqual([20, 30]);

            eff.unsubscribe();
            doubled.dispose();
        });
    });

    describe("lifecycle & safety", () => {
        it("throws when read after dispose", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            ps.dispose();
            expect(() => ps.root.a()).toThrow(/disposed/);
            expect(() => ps.peek()).toThrow(/disposed/);
        });

        it("double dispose is a no-op", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            ps.dispose();
            expect(() => ps.dispose()).not.toThrow();
        });

        it("rejects mutation of a draft that escaped its recipe", () => {
            const ps = unstable_ProxySignal.state({ a: { b: 1 } });
            let escaped: { b: number } | undefined;
            ps.mutate((d) => {
                escaped = d.a;
            });
            expect(() => {
                escaped!.b = 5;
            }).toThrow(/escaped/);
        });

        it("leaves state intact and notifies nobody when a recipe throws", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            const runs = vi.fn(() => ps.root.a());
            const eff = Signal.effect(runs);

            expect(() =>
                ps.mutate((d) => {
                    d.a = 2;
                    throw new Error("recipe-boom");
                }),
            ).toThrow("recipe-boom");

            expect(ps.peek().a).toBe(1);
            expect(runs).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });

        it("mutation traps on the reactive tree are read-only", () => {
            const ps = unstable_ProxySignal.state<{ a: number }>({ a: 1 });
            expect(() => {
                (ps.root as unknown as { a: number }).a = 2;
            }).toThrow(/read-only/);
        });

        it("Object.defineProperty / setPrototypeOf / freeze throw read-only", () => {
            const ps = unstable_ProxySignal.state<{ a: number }>({ a: 1 });
            expect(() => Object.defineProperty(ps.root, "x", { value: 1 })).toThrow(/read-only/);
            expect(() => Object.setPrototypeOf(ps.root, null)).toThrow(/read-only/);
            expect(() => Object.freeze(ps.root)).toThrow(/read-only/);
        });

        it("a rejected defineProperty/freeze does not corrupt the node (reads & iteration survive)", () => {
            const ps = unstable_ProxySignal.state<{ a: number; b: number }>({ a: 1, b: 2 });
            expect(() => Object.defineProperty(ps.root, "x", { value: 1, configurable: false })).toThrow(/read-only/);
            expect(() => Object.freeze(ps.root)).toThrow(/read-only/);

            // The root proxy is still fully functional — the aborted mutations
            // never reached the internal target.
            expect(ps.root.a()).toBe(1);
            expect("b" in ps.root).toBe(true);
            expect(Object.keys(ps.root).sort()).toEqual(["a", "b"]);
        });

        it("reactivity survives an attempted freeze of the tree", () => {
            const ps = unstable_ProxySignal.state<{ a: number }>({ a: 1 });
            const seen: number[] = [];
            const eff = Signal.effect(() => seen.push(ps.root.a()));

            expect(() => Object.freeze(ps.root)).toThrow(/read-only/);

            ps.mutate((d) => {
                d.a = 2;
            });
            expect(seen).toEqual([1, 2]);

            eff.unsubscribe();
        });
    });

    describe("robustness of coercion / navigation", () => {
        it("does not throw when stringified or JSON-serialised", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            expect(() => `${ps.root}`).not.toThrow();
            expect(() => JSON.stringify(ps.root)).not.toThrow();
        });

        it("is not accidentally thenable", () => {
            const ps = unstable_ProxySignal.state({ a: 1 });
            expect((ps.root as unknown as { then?: unknown }).then).toBeUndefined();
        });
    });

    describe("produce (copy-on-write) unit", () => {
        it("shares structure for untouched subtrees", () => {
            const base = { a: { x: 1 }, b: { y: 2 } };
            const next = produce(base, (d) => {
                d.a.x = 5;
            });

            expect(next).not.toBe(base);
            expect(next.a).not.toBe(base.a);
            expect(next.b).toBe(base.b); // untouched → same reference
            expect(next.a.x).toBe(5);
            expect(base.a.x).toBe(1); // base unmodified
        });

        it("returns the same reference for a no-op recipe", () => {
            const base = { a: 1 };
            expect(produce(base, () => {})).toBe(base);
            expect(
                produce(base, (d) => {
                    d.a = 1; // redundant write
                }),
            ).toBe(base);
        });

        it("supports nested arrays with structural sharing", () => {
            const base = { list: [{ v: 1 }, { v: 2 }] };
            const next = produce(base, (d) => {
                d.list[0].v = 10;
            });

            expect(next.list).not.toBe(base.list);
            expect(next.list[0]).not.toBe(base.list[0]);
            expect(next.list[1]).toBe(base.list[1]); // untouched element shared
            expect(next.list[0].v).toBe(10);
        });
    });
});
