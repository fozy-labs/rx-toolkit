import { isBuiltin } from "./core/createBuiltin";
import { and, not, or, stateIn } from "./guards";
import { BUILTIN } from "./types/brand";

function nameOf(value: unknown): string {
    return (value as { name: string }).name;
}

describe("builtin guard creators", () => {
    it("and() / or() carry a frozen copy of the guard list", () => {
        const guards = ["a", { type: "b" }, () => true] as const;
        const both = and([...guards]);
        expect(isBuiltin(both)).toBe(true);
        expect(both[BUILTIN]).toBe("and");
        expect(both.type).toBe("xstate.and");
        expect(both.guards).toEqual(guards);
        expect(Object.isFrozen(both.guards)).toBe(true);
        expect(nameOf(both)).toBe("and");

        const list = ["a", "b"];
        const either = or(list);
        expect(either[BUILTIN]).toBe("or");
        expect(either.type).toBe("xstate.or");
        expect(either.guards).not.toBe(list);
        list.push("c");
        expect(either.guards).toEqual(["a", "b"]);
        expect(nameOf(either)).toBe("or");
    });

    it("not() wraps a single guard of any shape", () => {
        const inner = () => false;
        const negated = not(inner);
        expect(negated[BUILTIN]).toBe("not");
        expect(negated.type).toBe("xstate.not");
        expect(negated.guard).toBe(inner);
        expect(nameOf(negated)).toBe("not");
        expect(not("name").guard).toBe("name");
        expect((not(and(["a"])).guard as { type: string }).type).toBe("xstate.and");
    });

    it("stateIn() keeps the state value (string or object)", () => {
        const byId = stateIn("#m.a");
        expect(byId[BUILTIN]).toBe("stateIn");
        expect(byId.type).toBe("xstate.stateIn");
        expect(byId.stateValue).toBe("#m.a");
        expect(nameOf(byId)).toBe("stateIn");
        const value = { a: "b" };
        expect(stateIn(value).stateValue).toBe(value);
    });

    it("builtins are declarative: calling one throws", () => {
        for (const builtin of [and([]), or([]), not("x"), stateIn("a")]) {
            expect(() => (builtin as unknown as () => void)()).toThrow(/declarative builtin/);
        }
    });

    it("serializes like XState ({ type: fn.name }) under a function-replacing replacer", () => {
        const json = JSON.stringify({ guard: and([or(["a"]), not("b"), stateIn("c")]) }, (_key, value: unknown) =>
            typeof value === "function" ? { type: (value as { name: string }).name } : value,
        );
        expect(JSON.parse(json)).toEqual({ guard: { type: "and" } });
    });
});
