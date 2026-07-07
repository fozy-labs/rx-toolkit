import { Signal } from "../signals";

import { unstable_ProxySignal as ProxySignal } from "./ProxySignal";

describe("unstable_ProxySignal lifecycle", () => {
    describe("dormant computed correctness", () => {
        it("computed.peek() reflects a mutate that happened while the computed was unobserved", () => {
            const s$ = ProxySignal.state({ a: { b: 1 } });
            const c = Signal.compute(() => s$.root.a.b());
            const eff = Signal.effect(() => {
                c();
            });
            expect(c.peek()).toBe(1);

            // make the computed dormant
            eff.unsubscribe();

            s$.mutate((draft) => {
                draft.a.b = 42;
            });

            expect(c.peek()).toBe(42);

            c.dispose();
            s$.dispose();
        });

        it("computed re-observed after several mutates emits the current value, not a stale one", () => {
            const s$ = ProxySignal.state({ a: { b: 1 } });
            const c = Signal.compute(() => s$.root.a.b());
            const eff1 = Signal.effect(() => {
                c();
            });
            expect(c.peek()).toBe(1);
            eff1.unsubscribe();

            s$.mutate((draft) => {
                draft.a.b = 2;
            });
            s$.mutate((draft) => {
                draft.a.b = 3;
            });
            s$.mutate((draft) => {
                draft.a.b = 4;
            });

            const seen: number[] = [];
            const eff2 = Signal.effect(() => {
                seen.push(c());
            });
            expect(seen).toEqual([4]);

            eff2.unsubscribe();
            c.dispose();
            s$.dispose();
        });

        it("effect unsubscribed and a new effect on the same path sees updates from subsequent mutates", () => {
            const s$ = ProxySignal.state({ a: { b: 1 } });

            const seen1: number[] = [];
            const c1 = Signal.compute(() => s$.root.a.b());
            const eff1 = Signal.effect(() => {
                seen1.push(c1());
            });
            expect(seen1).toEqual([1]);
            eff1.unsubscribe();
            c1.dispose();

            s$.mutate((draft) => {
                draft.a.b = 2;
            });

            const seen2: number[] = [];
            const c2 = Signal.compute(() => s$.root.a.b());
            const eff2 = Signal.effect(() => {
                seen2.push(c2());
            });
            expect(seen2).toEqual([2]);

            s$.mutate((draft) => {
                draft.a.b = 3;
            });
            expect(seen2).toEqual([2, 3]);

            eff2.unsubscribe();
            c2.dispose();
            s$.dispose();
        });
    });

    describe("long-lived stores", () => {
        it("reading many distinct dynamic paths then deleting those entries keeps subsequent reads returning undefined", () => {
            const s$ = ProxySignal.state<{ items: Record<string, { v: number }> }>({
                items: {},
            });

            s$.mutate((draft) => {
                for (let i = 0; i < 100; i++) {
                    draft.items[String(i)] = { v: i };
                }
            });

            for (let i = 0; i < 100; i++) {
                const key = String(i);
                expect((s$.root as any).items[key].v()).toBe(i);
            }

            s$.mutate((draft) => {
                for (let i = 0; i < 100; i++) {
                    delete draft.items[String(i)];
                }
            });

            for (let i = 0; i < 100; i++) {
                const key = String(i);
                expect((s$.root as any).items[key]?.()).toBeUndefined();
                expect((s$.root as any).items[key].v()).toBeUndefined();
            }

            s$.dispose();
        });

        it("a path recreated after its subtree was deleted and re-added still tracks updates in an active effect", () => {
            const s$ = ProxySignal.state<{ a?: { b: number } }>({ a: { b: 1 } });

            const seen: (number | undefined)[] = [];
            const c = Signal.compute(() => s$.root.a.b());
            const eff = Signal.effect(() => {
                seen.push(c());
            });
            expect(seen).toEqual([1]);

            s$.mutate((draft) => {
                delete draft.a;
            });
            expect(seen[seen.length - 1]).toBeUndefined();

            s$.mutate((draft) => {
                draft.a = { b: 7 };
            });
            expect(seen[seen.length - 1]).toBe(7);

            s$.mutate((draft) => {
                draft.a!.b = 8;
            });
            expect(seen[seen.length - 1]).toBe(8);

            eff.unsubscribe();
            c.dispose();
            s$.dispose();
        });
    });

    describe("collections inside the store", () => {
        it("mutate can set into a Map held in the state and root subscriber sees a new root reference", () => {
            const s$ = ProxySignal.state<{ m: Map<string, number> }>({
                m: new Map([["a", 1]]),
            });
            const roots: { m: Map<string, number> }[] = [];
            const sub = s$.obs.subscribe((v) => roots.push(v));
            const before = s$.peek();

            s$.mutate((draft) => {
                draft.m.set("b", 2);
            });

            expect(s$.peek()).not.toBe(before);
            expect(s$.peek().m.get("b")).toBe(2);
            expect(roots).toHaveLength(2);
            expect(roots[1]).toBe(s$.peek());

            sub.unsubscribe();
            s$.dispose();
        });

        it("mutate can add to a Set held in the state and s$.peek() reflects it", () => {
            const s$ = ProxySignal.state<{ s: Set<number> }>({
                s: new Set([1]),
            });

            s$.mutate((draft) => {
                draft.s.add(2);
            });

            expect(s$.peek().s.has(2)).toBe(true);
            expect(s$.peek().s.size).toBe(2);

            s$.dispose();
        });

        it("replacing a Map wholesale via update() notifies a computed reading the parent object path", () => {
            const s$ = ProxySignal.state<{ container: { m: Map<string, number> } }>({
                container: { m: new Map([["a", 1]]) },
            });

            const seen: { m: Map<string, number> }[] = [];
            const c = Signal.compute(() => s$.root.container());
            const eff = Signal.effect(() => {
                seen.push(c());
            });
            expect(seen).toHaveLength(1);

            s$.update((prev) => ({
                ...prev,
                container: { m: new Map([["b", 2]]) },
            }));

            expect(seen).toHaveLength(2);
            expect(seen[1].m.get("b")).toBe(2);

            eff.unsubscribe();
            c.dispose();
            s$.dispose();
        });
    });
});
