import { assign, cancel, log, mutate, raise } from "./actions";
import { isBuiltin } from "./core/createBuiltin";
import { BUILTIN } from "./types/brand";

function nameOf(value: unknown): string {
    return (value as { name: string }).name;
}

describe("builtin action creators", () => {
    it("assign() carries the XState type, the brand and the assignment (object or function)", () => {
        const partial = { count: 1 };
        const objectForm = assign(partial);
        expect(isBuiltin(objectForm)).toBe(true);
        expect(objectForm[BUILTIN]).toBe("assign");
        expect(objectForm.type).toBe("xstate.assign");
        expect(objectForm.assignment).toBe(partial);
        expect(nameOf(objectForm)).toBe("assign");
        expect(Object.isFrozen(objectForm)).toBe(true);

        const assigner = () => ({ count: 2 });
        expect(assign(assigner).assignment).toBe(assigner);
    });

    it("mutate() carries its own (non-XState) type, the brand and the recipe", () => {
        const recipe = () => undefined;
        const action = mutate(recipe);
        expect(isBuiltin(action)).toBe(true);
        expect(action[BUILTIN]).toBe("mutate");
        expect(action.type).toBe("rx-toolkit.mutate");
        expect(action.recipe).toBe(recipe);
        expect(nameOf(action)).toBe("mutate");
        expect(Object.isFrozen(action)).toBe(true);
    });

    it("raise() carries the event (or expression), the delay and the id", () => {
        const immediate = raise({ type: "PING" });
        expect(immediate[BUILTIN]).toBe("raise");
        expect(immediate.type).toBe("xstate.raise");
        expect(immediate.event).toEqual({ type: "PING" });
        expect(immediate.delay).toBeUndefined();
        expect(immediate.id).toBeUndefined();
        expect(nameOf(immediate)).toBe("raise");

        const delayFn = () => 5;
        const eventFn = () => ({ type: "PING" });
        const delayed = raise(eventFn, { delay: delayFn, id: "ping" });
        expect(delayed.event).toBe(eventFn);
        expect(delayed.delay).toBe(delayFn);
        expect(delayed.id).toBe("ping");
        expect(raise({ type: "PING" }, { delay: "NAMED" }).delay).toBe("NAMED");
    });

    it("cancel() carries the send id or the expression", () => {
        const byId = cancel("ping");
        expect(byId[BUILTIN]).toBe("cancel");
        expect(byId.type).toBe("xstate.cancel");
        expect(byId.sendId).toBe("ping");
        expect(nameOf(byId)).toBe("cancel");
        const expr = () => "ping";
        expect(cancel(expr).sendId).toBe(expr);
    });

    it("log() carries the value / expression and the label; defaults to logging { context, event }", () => {
        const labelled = log("hello", "greeting");
        expect(labelled[BUILTIN]).toBe("log");
        expect(labelled.type).toBe("xstate.log");
        expect(labelled.value).toBe("hello");
        expect(labelled.label).toBe("greeting");
        expect(nameOf(labelled)).toBe("log");

        const expr = () => 1;
        expect(log(expr).value).toBe(expr);
        expect(log(expr).label).toBeUndefined();

        const defaulted = log();
        expect(typeof defaulted.value).toBe("function");
        const args = { context: { a: 1 }, event: { type: "E" } };
        expect((defaulted.value as (a: typeof args, p: undefined) => unknown)(args, undefined)).toEqual(args);
    });

    it("builtins are declarative: calling one throws", () => {
        for (const builtin of [assign({}), mutate(() => undefined), raise({ type: "E" }), cancel("x"), log()]) {
            expect(() => (builtin as unknown as () => void)()).toThrow(/declarative builtin/);
        }
    });

    it("serializes like XState ({ type: fn.name }) under a function-replacing replacer", () => {
        const json = JSON.stringify(
            { entry: [assign({}), mutate(() => undefined), raise({ type: "E" }), cancel("x"), log()] },
            (_key, value: unknown) =>
                typeof value === "function" ? { type: (value as { name: string }).name } : value,
        );
        expect(JSON.parse(json)).toEqual({
            entry: [{ type: "assign" }, { type: "mutate" }, { type: "raise" }, { type: "cancel" }, { type: "log" }],
        });
    });
});
