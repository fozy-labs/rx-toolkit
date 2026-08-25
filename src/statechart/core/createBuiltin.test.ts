import { BUILTIN } from "../types/brand";

import { createBuiltin, isBuiltin } from "./createBuiltin";

interface TestBuiltin {
    readonly [BUILTIN]: "test";
    readonly type: "xstate.test";
    readonly payload: number;
}

function makeTestBuiltin(): TestBuiltin {
    return createBuiltin<TestBuiltin>("test", "test", "xstate.test", { payload: 1 });
}

describe("createBuiltin", () => {
    it("returns a frozen function carrying the brand, the type and the payload", () => {
        const builtin = makeTestBuiltin();

        expect(typeof builtin).toBe("function");
        expect(builtin[BUILTIN]).toBe("test");
        expect(builtin.type).toBe("xstate.test");
        expect(builtin.payload).toBe(1);
        expect(Object.isFrozen(builtin)).toBe(true);
    });

    it("names the function like XState so `{ type: fn.name }` serialization matches", () => {
        const builtin = makeTestBuiltin() as unknown as (...args: unknown[]) => unknown;
        expect(builtin.name).toBe("test");
        expect(
            JSON.parse(
                JSON.stringify({ a: builtin }, (_key, value: unknown) =>
                    typeof value === "function" ? { type: value.name } : value,
                ),
            ),
        ).toEqual({ a: { type: "test" } });
    });

    it("throws when called: builtins are declarative", () => {
        const builtin = makeTestBuiltin() as unknown as () => unknown;
        expect(() => builtin()).toThrow(/declarative builtin/);
    });

    it("isBuiltin recognizes builtins only, not inline functions or objects", () => {
        expect(isBuiltin(makeTestBuiltin())).toBe(true);
        expect(isBuiltin(() => undefined)).toBe(false);
        expect(isBuiltin({ type: "xstate.test" })).toBe(false);
        expect(isBuiltin("assign")).toBe(false);
    });
});
