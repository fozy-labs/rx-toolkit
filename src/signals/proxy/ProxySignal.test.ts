import { Signal } from "../signals";

import { unstable_ProxySignal as ProxySignal } from "./ProxySignal";
import type { ProxyStateSignal } from "./types";

type Shape = {
    user: { name: string; age: number };
    items: { id: number; name: string }[];
    maybe?: { v: number } | null;
};

const makeShape = (): Shape => ({
    user: { name: "Alice", age: 30 },
    items: [
        { id: 1, name: "one" },
        { id: 2, name: "two" },
    ],
    maybe: { v: 5 },
});

/** How many Proxies `run` constructs. */
function countProxies(run: () => void): number {
    const NativeProxy = globalThis.Proxy;
    let count = 0;
    globalThis.Proxy = new NativeProxy(NativeProxy, {
        construct(target, args, newTarget) {
            count++;
            return Reflect.construct(target, args, newTarget);
        },
    });
    try {
        run();
    } finally {
        globalThis.Proxy = NativeProxy;
    }
    return count;
}

describe("unstable_ProxySignal", () => {
    describe("root signal (classic behavior)", () => {
        it("returns the initial state when called", () => {
            const state = makeShape();
            const s$ = ProxySignal.state(state);
            expect(s$()).toBe(state);
        });

        it("peek() returns current state without creating a dependency", () => {
            const s$ = ProxySignal.state({ n: 1 });
            let runs = 0;
            const c = Signal.compute(() => {
                runs++;
                return s$.peek().n;
            });
            const eff = Signal.effect(() => {
                c();
            });
            expect(runs).toBe(1);
            s$.set({ n: 2 });
            expect(runs).toBe(1);
            eff.unsubscribe();
            c.dispose();
        });

        it("call is tracked inside Signal.compute and recomputes on set", () => {
            const s$ = ProxySignal.state({ n: 1 });
            let runs = 0;
            const c = Signal.compute(() => {
                runs++;
                return s$().n;
            });
            const eff = Signal.effect(() => {
                c();
            });
            expect(runs).toBe(1);
            s$.set({ n: 2 });
            expect(runs).toBe(2);
            expect(c.peek()).toBe(2);
            eff.unsubscribe();
            c.dispose();
        });

        it("set() replaces the state and notifies root subscribers", () => {
            const s$ = ProxySignal.state({ n: 1 });
            const values: { n: number }[] = [];
            const sub = s$.obs.subscribe((v) => values.push(v));
            const next = { n: 2 };
            s$.set(next);
            expect(s$()).toBe(next);
            expect(values.map((v) => v.n)).toEqual([1, 2]);
            sub.unsubscribe();
        });

        it("set() with Object.is-equal value does not notify", () => {
            const state = { n: 1 };
            const s$ = ProxySignal.state(state);
            const values: { n: number }[] = [];
            const sub = s$.obs.subscribe((v) => values.push(v));
            s$.set(state);
            expect(values.length).toBe(1);
            sub.unsubscribe();
        });

        it("update() replaces state with updater result", () => {
            const s$ = ProxySignal.state({ n: 1 });
            s$.update((v) => ({ n: v.n + 10 }));
            expect(s$.peek().n).toBe(11);
        });

        it("obs emits current value on subscribe and on subsequent changes", () => {
            const s$ = ProxySignal.state({ n: 1 });
            const values: number[] = [];
            const sub = s$.obs.subscribe((v) => values.push(v.n));
            expect(values).toEqual([1]);
            s$.set({ n: 2 });
            s$.set({ n: 3 });
            expect(values).toEqual([1, 2, 3]);
            sub.unsubscribe();
        });
    });

    describe("root path reads", () => {
        it("reads a top-level property", () => {
            const s$ = ProxySignal.state(makeShape());
            expect(s$.root.user()).toEqual({ name: "Alice", age: 30 });
        });

        it("reads a nested property", () => {
            const s$ = ProxySignal.state(makeShape());
            expect(s$.root.user.name()).toBe("Alice");
        });

        it("reads an array element by index", () => {
            const s$ = ProxySignal.state(makeShape());
            expect(s$.root.items[0]()).toEqual({ id: 1, name: "one" });
        });

        it("reads through arrays of objects", () => {
            const s$ = ProxySignal.state(makeShape());
            expect(s$.root.items[1].name()).toBe("two");
        });

        it("reflects the latest state after set()", () => {
            const s$ = ProxySignal.state(makeShape());
            expect(s$.root.user.name()).toBe("Alice");
            const next = makeShape();
            next.user.name = "Bob";
            s$.set(next);
            expect(s$.root.user.name()).toBe("Bob");
        });

        it("the same path accessed twice returns the same value", () => {
            const s$ = ProxySignal.state(makeShape());
            expect(s$.root.user()).toBe(s$.root.user());
        });

        it("a path node is not a thenable, so awaiting it gives the node", async () => {
            const s$ = ProxySignal.state(makeShape());
            const node = s$.root.user;
            expect((node as unknown as { then?: unknown }).then).toBeUndefined();
            const timeout = new Promise((resolve) => setTimeout(resolve, 50, "timeout"));
            await expect(Promise.race([(async () => node)(), timeout])).resolves.toBe(node);
        });
    });

    describe("optional-chaining semantics", () => {
        it("missing key returns undefined", () => {
            const s$ = ProxySignal.state<Record<string, unknown>>({});
            expect(s$.root.nope()).toBeUndefined();
        });

        it("path through null returns undefined ([null] -> root[0].value())", () => {
            const s$ = ProxySignal.state<Array<{ value: number } | null>>([null]);
            expect(s$.root[0].value()).toBeUndefined();
        });

        it("path through undefined returns undefined", () => {
            const s$ = ProxySignal.state<{ a?: { b: number } }>({});
            expect(s$.root.a.b()).toBeUndefined();
        });

        it("leaf null is returned as null, not undefined", () => {
            const s$ = ProxySignal.state<{ a: number | null }>({ a: null });
            expect(s$.root.a()).toBeNull();
        });

        it("out-of-bounds array index returns undefined", () => {
            const s$ = ProxySignal.state<{ items: number[] }>({ items: [1, 2] });
            expect(s$.root.items[9]()).toBeUndefined();
        });

        it("traversing through a primitive returns undefined and does not throw", () => {
            const s$ = ProxySignal.state<{ a: number }>({ a: 5 });
            expect(() => (s$.root.a as any).b.c()).not.toThrow();
            expect((s$.root.a as any).b.c()).toBeUndefined();
        });
    });

    describe("initialValue fallback", () => {
        it("returns initialValue when the resolved value is undefined", () => {
            const s$ = ProxySignal.state<{ a?: { b: number } }>({});
            expect(s$.root.a.b(42)).toBe(42);
        });

        it("returns the actual value when present, ignoring initialValue", () => {
            const s$ = ProxySignal.state<{ a?: { b: number } }>({ a: { b: 7 } });
            expect(s$.root.a.b(42)).toBe(7);
        });

        it("returns null (not initialValue) when the leaf value is null", () => {
            const s$ = ProxySignal.state<{ a: number | null }>({ a: null });
            expect(s$.root.a(42)).toBeNull();
        });

        it("returns falsy actual values (0, empty string, false) instead of initialValue", () => {
            const s$ = ProxySignal.state<{ zero?: number; empty?: string; flag?: boolean }>({
                zero: 0,
                empty: "",
                flag: false,
            });
            expect(s$.root.zero(42)).toBe(0);
            expect(s$.root.empty("fallback")).toBe("");
            expect(s$.root.flag(true)).toBe(false);
        });
    });

    describe("mutate: draft operations", () => {
        it("assigns a top-level property", () => {
            const s$ = ProxySignal.state(makeShape());
            s$.mutate((draft) => {
                draft.user = { name: "Bob", age: 40 };
            });
            expect(s$.peek().user).toEqual({ name: "Bob", age: 40 });
        });

        it("assigns a nested property", () => {
            const s$ = ProxySignal.state(makeShape());
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            expect(s$.peek().user.name).toBe("Bob");
        });

        it("pushes into an array", () => {
            const s$ = ProxySignal.state(makeShape());
            s$.mutate((draft) => {
                draft.items.push({ id: 3, name: "three" });
            });
            expect(s$.peek().items).toHaveLength(3);
            expect(s$.peek().items[2]).toEqual({ id: 3, name: "three" });
        });

        it("assigns an array element by index", () => {
            const s$ = ProxySignal.state(makeShape());
            s$.mutate((draft) => {
                draft.items[0] = { id: 9, name: "nine" };
            });
            expect(s$.peek().items[0]).toEqual({ id: 9, name: "nine" });
        });

        it("splices an array", () => {
            const s$ = ProxySignal.state(makeShape());
            s$.mutate((draft) => {
                draft.items.splice(0, 1);
            });
            expect(s$.peek().items).toHaveLength(1);
            expect(s$.peek().items[0].id).toBe(2);
        });

        it("deletes a property via delete operator", () => {
            const s$ = ProxySignal.state(makeShape());
            s$.mutate((draft) => {
                delete draft.maybe;
            });
            expect(s$.peek().maybe).toBeUndefined();
            expect("maybe" in s$.peek()).toBe(false);
        });

        it("mutates a deep-frozen state", () => {
            const s$ = ProxySignal.state<{ user: { name: string } }>(
                Object.freeze({ user: Object.freeze({ name: "a" }) }),
            );
            s$.mutate((draft) => {
                draft.user.name = "b";
            });
            expect(s$.peek()).toEqual({ user: { name: "b" } });
        });

        it("reading from the draft returns already-mutated values", () => {
            const s$ = ProxySignal.state(makeShape());
            let seen: string | undefined;
            s$.mutate((draft) => {
                draft.user.name = "Bob";
                seen = draft.user.name;
            });
            expect(seen).toBe("Bob");
        });

        it("a later mutate does not change a snapshot whose array was rebuilt from drafts", () => {
            const s$ = ProxySignal.state({ items: [{ id: 1, done: false }] });
            s$.mutate((draft) => {
                draft.items = [...draft.items];
            });
            const snapshot = s$.peek();
            const seen: (boolean | undefined)[] = [];
            const eff = Signal.effect(() => {
                seen.push(s$.root.items[0].done());
            });
            s$.mutate((draft) => {
                draft.items[0].done = true;
            });
            expect(snapshot.items[0].done).toBe(false);
            expect(s$.peek().items[0].done).toBe(true);
            expect(seen).toEqual([false, true]);
            eff.unsubscribe();
        });

        it("does not modify the pre-mutate state object", () => {
            const state = makeShape();
            const s$ = ProxySignal.state(state);
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            expect(state.user.name).toBe("Alice");
        });

        it("produces a new root reference when something changed", () => {
            const state = makeShape();
            const s$ = ProxySignal.state(state);
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            expect(s$.peek()).not.toBe(state);
        });

        it("preserves references of untouched subtrees (structural sharing)", () => {
            const state = makeShape();
            const originalItems = state.items;
            const s$ = ProxySignal.state(state);
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            expect(s$.peek().items).toBe(originalItems);
        });
    });

    describe("granular reactivity", () => {
        it("computed on root.a.b recomputes when mutate changes a.b", () => {
            const s$ = ProxySignal.state({ a: { b: 1, c: 2 } });
            let runs = 0;
            const c = Signal.compute(() => {
                runs++;
                return s$.root.a.b();
            });
            const eff = Signal.effect(() => {
                c();
            });
            expect(runs).toBe(1);
            s$.mutate((draft) => {
                draft.a.b = 99;
            });
            expect(runs).toBe(2);
            expect(c.peek()).toBe(99);
            eff.unsubscribe();
            c.dispose();
        });

        it("computed on root.a.b does not recompute when mutate changes an unrelated key", () => {
            const s$ = ProxySignal.state({ a: { b: 1, c: 2 } });
            let runs = 0;
            const c = Signal.compute(() => {
                runs++;
                return s$.root.a.b();
            });
            const eff = Signal.effect(() => {
                c();
            });
            expect(runs).toBe(1);
            s$.mutate((draft) => {
                draft.a.c = 99;
            });
            expect(runs).toBe(1);
            eff.unsubscribe();
            c.dispose();
        });

        it("computed on items[0].name does not recompute when items[1] is mutated", () => {
            const s$ = ProxySignal.state(makeShape());
            let runs = 0;
            const c = Signal.compute(() => {
                runs++;
                return s$.root.items[0].name();
            });
            const eff = Signal.effect(() => {
                c();
            });
            expect(runs).toBe(1);
            s$.mutate((draft) => {
                draft.items[1].name = "changed";
            });
            expect(runs).toBe(1);
            eff.unsubscribe();
            c.dispose();
        });

        it("root subscriber is notified on mutate", () => {
            const s$ = ProxySignal.state(makeShape());
            const values: Shape[] = [];
            const sub = s$.obs.subscribe((v) => values.push(v));
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            expect(values).toHaveLength(2);
            expect(values[1].user.name).toBe("Bob");
            sub.unsubscribe();
        });

        it("mutate that changes nothing notifies no one", () => {
            const s$ = ProxySignal.state(makeShape());
            const values: Shape[] = [];
            const sub = s$.obs.subscribe((v) => values.push(v));
            let runs = 0;
            const c = Signal.compute(() => {
                runs++;
                return s$.root.user.name();
            });
            const eff = Signal.effect(() => {
                c();
            });
            s$.mutate(() => {
                // no changes
            });
            expect(values).toHaveLength(1);
            expect(runs).toBe(1);
            eff.unsubscribe();
            c.dispose();
            sub.unsubscribe();
        });

        it("mutate that edits a subtree and assigns the original back notifies no one", () => {
            const s$ = ProxySignal.state({ form: { name: "Ann" } });
            const original = s$.peek().form;
            const names: string[] = [];
            const emitted: unknown[] = [];
            const eff = Signal.effect(() => {
                names.push(s$.root.form.name());
            });
            const sub = s$.obs.subscribe((value) => emitted.push(value));
            s$.mutate((draft) => {
                draft.form.name = "typo";
                draft.form = original;
            });
            expect(s$.peek().form).toBe(original);
            expect(names).toEqual(["Ann"]);
            expect(emitted).toHaveLength(1);
            sub.unsubscribe();
            eff.unsubscribe();
        });

        it("path subscriber is notified when its key is deleted (value becomes undefined)", () => {
            const s$ = ProxySignal.state(makeShape());
            const seen: unknown[] = [];
            const c = Signal.compute(() => {
                return s$.root.maybe();
            });
            const eff = Signal.effect(() => {
                seen.push(c());
            });
            expect(seen).toEqual([{ v: 5 }]);
            s$.mutate((draft) => {
                delete draft.maybe;
            });
            expect(seen).toHaveLength(2);
            expect(seen[1]).toBeUndefined();
            eff.unsubscribe();
            c.dispose();
        });

        it("path subscriber is notified when mutate assigns undefined to its key", () => {
            const s$ = ProxySignal.state(makeShape());
            const seen: unknown[] = [];
            const eff = Signal.effect(() => {
                seen.push(s$.root.maybe());
            });
            s$.mutate((draft) => {
                draft.maybe = undefined;
            });
            expect(s$.peek().maybe).toBeUndefined();
            expect(seen).toEqual([{ v: 5 }, undefined]);
            eff.unsubscribe();
        });

        it("path subscriber is notified when an ancestor is replaced with null", () => {
            const s$ = ProxySignal.state<{ a: { b: number } | null }>({ a: { b: 1 } });
            const seen: (number | undefined)[] = [];
            const c = Signal.compute(() => {
                return s$.root.a.b();
            });
            const eff = Signal.effect(() => {
                seen.push(c());
            });
            expect(seen).toEqual([1]);
            s$.mutate((draft) => {
                draft.a = null;
            });
            expect(seen).toHaveLength(2);
            expect(seen[1]).toBeUndefined();
            eff.unsubscribe();
            c.dispose();
        });

        it("several changes in one mutate recompute a multi-path computed once", () => {
            const s$ = ProxySignal.state({ a: { x: 1 }, b: { y: 2 } });
            let runs = 0;
            const c = Signal.compute(() => {
                runs++;
                return s$.root.a.x() + s$.root.b.y();
            });
            const eff = Signal.effect(() => {
                c();
            });
            expect(runs).toBe(1);
            s$.mutate((draft) => {
                draft.a.x = 10;
                draft.b.y = 20;
            });
            expect(runs).toBe(2);
            expect(c.peek()).toBe(30);
            eff.unsubscribe();
            c.dispose();
        });

        it("set() also notifies only path subscribers whose value actually changed", () => {
            const s$ = ProxySignal.state(makeShape());
            let userRuns = 0;
            let itemsRuns = 0;
            const cUser = Signal.compute(() => {
                userRuns++;
                return s$.root.user.name();
            });
            const cItems = Signal.compute(() => {
                itemsRuns++;
                return s$.root.items();
            });
            const eff = Signal.effect(() => {
                cUser();
                cItems();
            });
            expect(userRuns).toBe(1);
            expect(itemsRuns).toBe(1);

            const next = makeShape();
            next.items = s$.peek().items;
            next.user.name = "Bob";
            s$.set(next);

            expect(userRuns).toBe(2);
            expect(itemsRuns).toBe(1);
            eff.unsubscribe();
            cUser.dispose();
            cItems.dispose();
        });
    });

    describe("key set of a path", () => {
        it("`in` and Object.keys report the keys of the value at the path", () => {
            const s$ = ProxySignal.state(makeShape());
            expect("age" in s$.root.user).toBe(true);
            expect("nick" in s$.root.user).toBe(false);
            expect(Object.keys(s$.root.user)).toEqual(["name", "age"]);
            expect(Object.keys(s$.root.items)).toEqual(["0", "1"]);
            expect(Object.keys(s$.root.maybe.v)).toEqual([]);
        });

        it("a Map or Set at the path has no keys", () => {
            const s$ = ProxySignal.state({ m: new Map([["a", 1]]) });
            expect(Object.keys(s$.root.m)).toEqual([]);
            expect("a" in s$.root.m).toBe(false);
        });

        it("wakes `in` and Object.keys readers on a key-set change only", () => {
            const s$ = ProxySignal.state<{ user: { name: string; nick?: string } }>({ user: { name: "Ann" } });
            const keys: string[][] = [];
            const hasNick: boolean[] = [];
            const effKeys = Signal.effect(() => {
                keys.push(Object.keys(s$.root.user));
            });
            const effHas = Signal.effect(() => {
                hasNick.push("nick" in s$.root.user);
            });
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            s$.mutate((draft) => {
                draft.user.nick = "b";
            });
            s$.mutate((draft) => {
                delete draft.user.nick;
            });
            expect(keys).toEqual([["name"], ["name", "nick"], ["name"]]);
            expect(hasNick).toEqual([false, true, false]);
            effKeys.unsubscribe();
            effHas.unsubscribe();
        });

        it("a computed over Object.keys stays truthful while unobserved", () => {
            const s$ = ProxySignal.state<Record<string, number>>({ a: 1 });
            const c = Signal.compute(() => Object.keys(s$.root).join());
            expect(c.peek()).toBe("a");
            s$.mutate((draft) => {
                draft.b = 2;
            });
            expect(c.peek()).toBe("a,b");
        });

        it("a property descriptor gets the child path on access", () => {
            const s$ = ProxySignal.state(makeShape());
            const desc = Object.getOwnPropertyDescriptor(s$.root.user, "name")!;
            expect(desc).toMatchObject({ enumerable: true, configurable: true, set: undefined });
            expect((desc.get!() as () => string)()).toBe("Alice");
            expect({ ...s$.root.user }.age()).toBe(30);
            expect(Object.getOwnPropertyDescriptor(s$.root.user, "nick")).toBeUndefined();
        });

        it("Object.keys creates no child paths, tracked or not", () => {
            const s$ = ProxySignal.state<{ c: Record<string, { i: number }> }>({
                c: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, { i }])),
            });
            const node = s$.root.c;
            const lengths: number[] = [];
            let created = countProxies(() => lengths.push(Object.keys(node).length));
            const effect = Signal.effect(() => {
                created += countProxies(() => lengths.push(Object.keys(node).length));
            });
            s$.mutate((draft) => {
                draft.c.extra = { i: -1 };
            });
            effect.unsubscribe();
            expect(lengths).toEqual([100, 100, 101]);
            expect(created).toBe(0);
        });
    });

    describe("read-only tree", () => {
        it.each([
            ["assignment", (node: object) => ((node as Record<string, unknown>).age = 31)],
            ["delete", (node: object) => delete (node as Record<string, unknown>).age],
            ["Object.defineProperty", (node: object) => Object.defineProperty(node, "x", { value: 1 })],
            ["Object.setPrototypeOf", (node: object) => Object.setPrototypeOf(node, null)],
            ["Object.preventExtensions", (node: object) => Object.preventExtensions(node)],
            ["Object.freeze", (node: object) => Object.freeze(node)],
        ])("%s on a path throws and leaves the path readable", (_, operation) => {
            const s$ = ProxySignal.state(makeShape());
            expect(() => operation(s$.root.user)).toThrow(TypeError);
            expect(s$.root.user.name()).toBe("Alice");
            expect(s$.peek().user).toEqual({ name: "Alice", age: 30 });
        });
    });

    describe("commit delivery order", () => {
        it("an .obs subscriber reads fresh path values during delivery", () => {
            const s$ = ProxySignal.state(makeShape());
            const c = Signal.compute(() => s$.root.user.name());
            const eff = Signal.effect(() => {
                c();
            });
            const seen: string[] = [];
            const sub = s$.obs.subscribe(() => {
                seen.push(c.peek());
            });
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            expect(seen).toEqual(["Alice", "Bob"]);
            eff.unsubscribe();
            c.dispose();
            sub.unsubscribe();
        });

        it("a cold computed read during delivery does not swallow the path notification", () => {
            const s$ = ProxySignal.state(makeShape());
            const c = Signal.compute(() => s$.root.user.name());
            expect(c.peek()).toBe("Alice");
            const names: string[] = [];
            const eff = Signal.effect(() => {
                names.push(s$.root.user.name());
            });
            const seen: string[] = [];
            const sub = s$.obs.subscribe(() => {
                seen.push(c.peek());
            });
            s$.mutate((draft) => {
                draft.user.name = "Bob";
            });
            expect(seen).toEqual(["Alice", "Bob"]);
            expect(names).toEqual(["Alice", "Bob"]);
            eff.unsubscribe();
            c.dispose();
            sub.unsubscribe();
        });

        it("a nested write from an .obs subscriber leaves paths and effects at the newest value", () => {
            const s$ = ProxySignal.state(makeShape());
            const c = Signal.compute(() => s$.root.user.name());
            const names: string[] = [];
            const eff = Signal.effect(() => {
                names.push(s$.root.user.name());
            });
            const seen: string[] = [];
            const sub = s$.obs.subscribe((value) => {
                seen.push(c.peek());
                if (value.user.name === "outer") {
                    s$.mutate((draft) => {
                        draft.user.name = "nested";
                    });
                }
            });
            s$.mutate((draft) => {
                draft.user.name = "outer";
            });
            expect(seen).toEqual(["Alice", "outer", "nested"]);
            expect(names).toEqual(["Alice", "nested"]);
            expect(s$.root.user.name()).toBe("nested");
            eff.unsubscribe();
            c.dispose();
            sub.unsubscribe();
        });
    });

    describe("nested write from a lifecycle hook", () => {
        /** A hook that writes back into the signal on a specific value, like a clamp/validation hook. */
        const withNestedWrite = (
            write: (s$: ProxyStateSignal<Shape>, value: Shape) => void,
            options?: { name?: string },
        ) => {
            const nested = options?.name ?? "nested";
            let s$: ProxyStateSignal<Shape>;
            s$ = ProxySignal.state(makeShape(), {
                hooks: [
                    {
                        onChange: (value: Shape) => {
                            if (value.user.name === "outer")
                                write(s$, { ...makeShape(), user: { name: nested, age: 40 } });
                        },
                    },
                ],
            });
            return s$;
        };

        it("an effect on the path converges to the committed value, as with plain Signal.state", () => {
            const s$ = withNestedWrite((ps, value) => ps.set(value));
            const names: string[] = [];
            const eff = Signal.effect(() => {
                names.push(s$.root.user.name());
            });
            s$.set({ ...makeShape(), user: { name: "outer", age: 40 } });
            // The outer write assigns the root after the nested one, so it wins
            // (plain Signal.state semantics); path readers must land there too.
            expect(s$.peek().user.name).toBe("outer");
            expect(names).toEqual(["Alice", "outer"]);
            eff.unsubscribe();
            s$.dispose();
        });

        it("an observed computed over the path converges to the committed value", () => {
            const s$ = withNestedWrite((ps, value) => ps.set(value));
            const c = Signal.compute(() => s$.root.user.name());
            const seen: string[] = [];
            const eff = Signal.effect(() => {
                seen.push(c());
            });
            s$.set({ ...makeShape(), user: { name: "outer", age: 40 } });
            expect(s$.peek().user.name).toBe("outer");
            expect(seen).toEqual(["Alice", "outer"]);
            expect(c.peek()).toBe("outer");
            eff.unsubscribe();
            c.dispose();
            s$.dispose();
        });

        it("an .obs subscriber reads fresh path values during both the nested and the outer delivery", () => {
            const s$ = withNestedWrite((ps, value) => ps.set(value));
            const c = Signal.compute(() => s$.root.user.name());
            const eff = Signal.effect(() => {
                c();
            });
            const seen: string[] = [];
            const sub = s$.obs.subscribe((value) => {
                // The delivered root and the path nodes must agree at every delivery.
                seen.push(`${value.user.name}:${s$.root.user.name()}:${c.peek()}`);
            });
            s$.set({ ...makeShape(), user: { name: "outer", age: 40 } });
            expect(seen).toEqual(["Alice:Alice:Alice", "nested:nested:nested", "outer:outer:outer"]);
            eff.unsubscribe();
            c.dispose();
            sub.unsubscribe();
            s$.dispose();
        });

        it("a nested mutate from the hook converges the same way", () => {
            const s$ = withNestedWrite((ps) => {
                ps.mutate((draft) => {
                    draft.user.name = "nested";
                });
            });
            const names: string[] = [];
            const eff = Signal.effect(() => {
                names.push(s$.root.user.name());
            });
            s$.mutate((draft) => {
                draft.user.name = "outer";
            });
            expect(s$.peek().user.name).toBe("outer");
            expect(names).toEqual(["Alice", "outer"]);
            eff.unsubscribe();
            s$.dispose();
        });

        it("a throwing hook aborts the write before anything changes", () => {
            const s$ = ProxySignal.state(makeShape(), {
                hooks: [
                    {
                        onChange: () => {
                            throw new Error("hook failed");
                        },
                    },
                ],
            });
            const names: string[] = [];
            const eff = Signal.effect(() => {
                names.push(s$.root.user.name());
            });
            expect(() => s$.set({ ...makeShape(), user: { name: "Bob", age: 40 } })).toThrow("hook failed");
            expect(s$.peek().user.name).toBe("Alice");
            expect(names).toEqual(["Alice"]);
            eff.unsubscribe();
            s$.dispose();
        });
    });

    describe("dispose", () => {
        it("completes the root obs", () => {
            const s$ = ProxySignal.state({ n: 1 });
            let completed = false;
            const sub = s$.obs.subscribe({ complete: () => (completed = true) });
            s$.dispose();
            expect(completed).toBe(true);
            sub.unsubscribe();
        });

        it("peek() after dispose does not throw", () => {
            const s$ = ProxySignal.state({ n: 1 });
            s$.dispose();
            expect(() => s$.peek()).not.toThrow();
        });
    });
});
