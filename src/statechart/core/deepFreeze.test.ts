import { deepFreeze } from "./deepFreeze";

describe("deepFreeze", () => {
    it("freezes plain objects and arrays recursively, in place, and returns the same reference", () => {
        const value = { a: { b: [1, { c: 2 }] }, d: [[3]] };
        expect(deepFreeze(value)).toBe(value);
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.a)).toBe(true);
        expect(Object.isFrozen(value.a.b)).toBe(true);
        expect(Object.isFrozen(value.a.b[1])).toBe(true);
        expect(Object.isFrozen(value.d)).toBe(true);
        expect(Object.isFrozen(value.d[0])).toBe(true);
    });

    it("freezes null-prototype objects and symbol-keyed members", () => {
        const symbol = Symbol("s");
        const value = Object.assign(Object.create(null) as Record<string, unknown>, {
            nested: { [symbol]: { deep: true } },
        });
        deepFreeze(value);
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.nested)).toBe(true);
        expect(Object.isFrozen((value.nested as Record<symbol, unknown>)[symbol])).toBe(true);
    });

    it("leaves the values of `except` root keys unfrozen (the keys themselves become read-only)", () => {
        const context = { count: 0, nested: { deep: true } };
        const value = { context, other: { x: 1 } };
        deepFreeze(value, { except: ["context"] });
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.other)).toBe(true);
        expect(Object.isFrozen(context)).toBe(false);
        expect(Object.isFrozen(context.nested)).toBe(false);
        context.count = 1;
        expect(value.context.count).toBe(1);
        expect(() => {
            (value as { context: unknown }).context = {};
        }).toThrow(TypeError);
    });

    it("applies `except` to root keys only: a nested key of the same name is frozen", () => {
        const value = { inner: { context: { n: 1 } } };
        deepFreeze(value, { except: ["context"] });
        expect(Object.isFrozen(value.inner.context)).toBe(true);
    });

    it("tolerates cycles and shared references", () => {
        const shared = { s: 1 };
        const value: { self?: unknown; a: typeof shared; b: typeof shared; list: unknown[] } = {
            a: shared,
            b: shared,
            list: [],
        };
        value.self = value;
        value.list.push(value, shared);
        expect(() => deepFreeze(value)).not.toThrow();
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(shared)).toBe(true);
        expect(Object.isFrozen(value.list)).toBe(true);
    });

    it("leaves functions, class instances, Map / Set / Date untouched (but freezes the plain objects around them)", () => {
        class Thing {
            value = { n: 1 };
        }
        const fn = Object.assign(() => undefined, { prop: { p: 1 } });
        const value = {
            fn,
            thing: new Thing(),
            map: new Map([["k", { v: 1 }]]),
            set: new Set([{ s: 1 }]),
            date: new Date(0),
        };
        deepFreeze(value);
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(fn)).toBe(false);
        expect(Object.isFrozen(fn.prop)).toBe(false);
        expect(Object.isFrozen(value.thing)).toBe(false);
        expect(Object.isFrozen(value.thing.value)).toBe(false);
        expect(Object.isFrozen(value.map)).toBe(false);
        expect(Object.isFrozen(value.map.get("k"))).toBe(false);
        expect(Object.isFrozen(value.set)).toBe(false);
        expect(Object.isFrozen(value.date)).toBe(false);
        expect(() => value.map.set("k2", { v: 2 })).not.toThrow();
    });

    it("is idempotent and a no-op for primitives", () => {
        const value = { a: [1] };
        deepFreeze(value);
        expect(() => deepFreeze(value)).not.toThrow();
        expect(deepFreeze(value)).toBe(value);
        expect(deepFreeze(42)).toBe(42);
        expect(deepFreeze("s")).toBe("s");
        expect(deepFreeze(null)).toBe(null);
        expect(deepFreeze(undefined)).toBe(undefined);
    });

    it("makes mutation throw (strict mode)", () => {
        const value = { a: { b: 1 }, list: [1] };
        deepFreeze(value);
        expect(() => {
            value.a.b = 2;
        }).toThrow(TypeError);
        expect(() => {
            value.list.push(2);
        }).toThrow(TypeError);
    });
});
