import { Signal } from "../signals";

import { KeyedStore, unstable_KeyedSignal } from "./KeyedSignal";

const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

/** Inspect the private reactive-node map of a store without a prod test hook. */
const hasNode = (store: KeyedStore<any>, key: string): boolean =>
    (store as unknown as { _nodes: Map<string, unknown> })._nodes.has(key);

describe("unstable_KeyedSignal", () => {
    describe("map semantics", () => {
        it("set / get / has / size / delete / clear behave like a map", () => {
            const k = unstable_KeyedSignal.state<number>();
            expect(k.size).toBe(0);
            expect(k.get("a")).toBeUndefined();
            expect(k.has("a")).toBe(false);

            k.set("a", 1);
            k.set("b", 2);
            expect(k.size).toBe(2);
            expect(k.get("a")).toBe(1);
            expect(k.has("b")).toBe(true);
            expect([...k.values()].sort()).toEqual([1, 2]);

            expect(k.delete("a")).toBe(true);
            expect(k.delete("a")).toBe(false);
            expect(k.size).toBe(1);

            k.clear();
            expect(k.size).toBe(0);
        });

        it("seeds from a plain object, an array of pairs, or a Map", () => {
            const fromObj = unstable_KeyedSignal.state<number>({ a: 1, b: 2 });
            expect(fromObj.peek()).toEqual({ a: 1, b: 2 });
            expect(fromObj.size).toBe(2);

            const fromPairs = unstable_KeyedSignal.state<number>([
                ["a", 1],
                ["b", 2],
            ]);
            expect(fromPairs.peek()).toEqual({ a: 1, b: 2 });

            const fromMap = unstable_KeyedSignal.state<number>(new Map([["a", 1]]));
            expect(fromMap.get("a")).toBe(1);
        });

        it("set replacing a key keeps size stable", () => {
            const k = unstable_KeyedSignal.state<number>({ a: 1 });
            k.set("a", 3);
            expect(k.size).toBe(1);
            expect(k.get("a")).toBe(3);
        });
    });

    describe("callable — reactive whole snapshot", () => {
        it("() wakes on any change; peek() is non-reactive", () => {
            const k = unstable_KeyedSignal.state<number>();
            k.set("a", 1);
            let runs = 0;
            let last: Readonly<Record<string, number>> = {};
            const eff = Signal.effect(() => {
                last = k();
                runs++;
            });
            const initial = runs;

            k.set("b", 2); // add → wake
            expect(runs - initial).toBe(1);
            k.set("a", 9); // replace → wake
            expect(runs - initial).toBe(2);
            k.delete("b"); // remove → wake
            expect(runs - initial).toBe(3);
            expect(last).toEqual({ a: 9 });

            expect(k.peek()).toEqual({ a: 9 });
            expect(k.snapshot()).toBe(k.peek()); // memoized

            eff.unsubscribe();
            k.dispose();
        });
    });

    describe("obs — snapshot stream", () => {
        it("replays the current snapshot on subscribe, then emits on every change", () => {
            const k = unstable_KeyedSignal.state<number>({ a: 1 });
            const seen: Readonly<Record<string, number>>[] = [];
            const sub = k.obs.subscribe((s) => seen.push(s));

            expect(seen).toHaveLength(1); // immediate replay on subscribe
            expect(seen[0]).toEqual({ a: 1 });

            k.set("b", 2);
            expect(seen).toHaveLength(2);
            expect(seen[1]).toEqual({ a: 1, b: 2 });

            sub.unsubscribe();
            k.dispose();
        });
    });

    describe("per-key reactivity", () => {
        it("get$ re-runs only when its own key changes", () => {
            const k = unstable_KeyedSignal.state<number>();
            k.set("a", 1);
            let runs = 0;
            const eff = Signal.effect(() => {
                k.get$("a");
                runs++;
            });
            const initial = runs;

            k.set("b", 10);
            k.delete("b");
            k.set("c", 20);
            expect(runs - initial).toBe(0);

            k.set("a", 2);
            expect(runs - initial).toBe(1);

            eff.unsubscribe();
            k.dispose();
        });

        it("observing an absent key then adding/removing it wakes the observer", () => {
            const k = unstable_KeyedSignal.state<number>();
            const seen: (number | undefined)[] = [];
            const eff = Signal.effect(() => seen.push(k.get$("x")));
            expect(seen).toEqual([undefined]);

            k.set("x", 5);
            expect(seen.at(-1)).toBe(5);
            k.set("x", 6);
            expect(seen.at(-1)).toBe(6);
            k.delete("x");
            expect(seen.at(-1)).toBeUndefined();

            eff.unsubscribe();
            k.dispose();
        });

        it("setting a key to an Object.is-equal value does not wake", () => {
            const k = unstable_KeyedSignal.state<{ v: number }>();
            const obj = { v: 1 };
            k.set("a", obj);
            let runs = 0;
            const eff = Signal.effect(() => {
                k.get$("a");
                runs++;
            });
            const initial = runs;
            k.set("a", obj);
            expect(runs - initial).toBe(0);
            eff.unsubscribe();
            k.dispose();
        });
    });

    describe("structural reactivity", () => {
        it("values$ re-runs on add/remove but not on value replacement", () => {
            const k = unstable_KeyedSignal.state<number>();
            k.set("a", 1);
            let runs = 0;
            const eff = Signal.effect(() => {
                k.values$();
                runs++;
            });
            const initial = runs;

            k.set("a", 2); // replace → no structural change
            expect(runs - initial).toBe(0);
            k.set("b", 3); // add → wake
            expect(runs - initial).toBe(1);
            k.delete("b"); // remove → wake
            expect(runs - initial).toBe(2);

            eff.unsubscribe();
            k.dispose();
        });
    });

    describe("node lifecycle (reaping) — KeyedStore", () => {
        it("reaps a node once its key is gone and its last observer leaves", async () => {
            const core = new KeyedStore<number>();
            core.set("a", 1);
            const eff = Signal.effect(() => core.get$("a"));

            core.delete("a"); // key gone, but still observed → node retained
            expect(hasNode(core, "a")).toBe(true);

            eff.unsubscribe();
            await flushMicrotasks();
            expect(hasNode(core, "a")).toBe(false);

            core.dispose();
        });

        it("deleting an unobserved key drops its node immediately", () => {
            const core = new KeyedStore<number>();
            core.set("a", 1);
            const eff = Signal.effect(() => core.get$("a")); // materialize node
            eff.unsubscribe(); // reap is deferred and the key is present → node retained
            expect(hasNode(core, "a")).toBe(true);

            core.delete("a");
            expect(hasNode(core, "a")).toBe(false);
            core.dispose();
        });

        it("an untracked get$ allocates no node — a miss on an absent key cannot leak", () => {
            const core = new KeyedStore<number>();
            expect(core.get$("ghost")).toBeUndefined();
            expect(hasNode(core, "ghost")).toBe(false);

            core.set("a", 1);
            expect(core.get$("a")).toBe(1);
            expect(hasNode(core, "a")).toBe(false);
            core.dispose();
        });

        it("does not reap a node whose key is still present", async () => {
            const core = new KeyedStore<number>();
            core.set("a", 1);
            const eff = Signal.effect(() => core.get$("a"));
            eff.unsubscribe();
            await flushMicrotasks();
            expect(hasNode(core, "a")).toBe(true);
            core.dispose();
        });

        it("a dormant computed's peek does not leak a node for an absent key", async () => {
            // ComputeCache tracks dependencies without ever subscribing, so the
            // node it materializes never gets an observer — reaping must not
            // depend on a last-observer-leaving event that will never come.
            const core = new KeyedStore<number>();
            const c = Signal.compute(() => core.get$("ghost"));
            expect(c.peek()).toBeUndefined();

            await flushMicrotasks();
            expect(hasNode(core, "ghost")).toBe(false);

            // The reaped node must not have broken dormant correctness.
            core.set("ghost", 5);
            expect(c.peek()).toBe(5);

            c.dispose();
            core.dispose();
        });

        it("a dormant computed's peek on a present key retains the node until the key is deleted", async () => {
            const core = new KeyedStore<number>();
            core.set("a", 1);
            const c = Signal.compute(() => core.get$("a"));
            expect(c.peek()).toBe(1);

            await flushMicrotasks();
            expect(hasNode(core, "a")).toBe(true); // key present → retained

            core.delete("a");
            expect(hasNode(core, "a")).toBe(false); // unobserved → dropped with the key

            c.dispose();
            core.dispose();
        });

        it("creation-time reap keeps an absent-key node subscribed in the same tick", async () => {
            const core = new KeyedStore<number>();
            const eff = Signal.effect(() => core.get$("ghost"));

            await flushMicrotasks();
            expect(hasNode(core, "ghost")).toBe(true); // observed → kept despite absent key

            eff.unsubscribe();
            await flushMicrotasks();
            expect(hasNode(core, "ghost")).toBe(false);
            core.dispose();
        });

        it("a re-subscribe within the same tick cancels the reap", async () => {
            const core = new KeyedStore<number>();
            const c = Signal.compute(() => core.get$("x"));
            const e1 = Signal.effect(() => c());
            const e2 = Signal.effect(() => c());
            e1.unsubscribe();
            await flushMicrotasks();
            expect(hasNode(core, "x")).toBe(true);
            e2.unsubscribe();
            c.dispose();
            core.dispose();
        });
    });

    describe("dormant computed correctness", () => {
        it("a computed reflects changes made while unobserved, even across a reap", async () => {
            const k = unstable_KeyedSignal.state<number>();
            k.set("a", 1);
            const c = Signal.compute(() => k.get$("a"));
            const eff = Signal.effect(() => c());
            expect(c.peek()).toBe(1);

            eff.unsubscribe();
            await flushMicrotasks();

            k.set("a", 42);
            expect(c.peek()).toBe(42);

            k.delete("a");
            await flushMicrotasks();
            k.set("a", 7);
            expect(c.peek()).toBe(7);

            c.dispose();
            k.dispose();
        });
    });
});
