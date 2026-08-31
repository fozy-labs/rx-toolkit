import { sendTo, assign as xstateAssign, stateIn as xstateStateIn } from "xstate";

import { MachineConfigError } from "./core/MachineConfigError";
import { unstable_createMachine as createMachine } from "./createMachine";
import { getMachineModel, MachineDefinition } from "./MachineDefinition";

describe("createMachine", () => {
    it("returns a MachineDefinition wrapping the very same config object", () => {
        const config = { id: "m", initial: "a", states: { a: {} } };
        const definition = createMachine(config);
        expect(definition).toBeInstanceOf(MachineDefinition);
        expect(definition.config).toBe(config);
        expect(definition.id).toBe("m");
        expect(getMachineModel(definition).config).toBe(config);
    });

    it("deep-freezes the config in place, except the initial context object", () => {
        const context = { count: 0, nested: { deep: true } };
        const config = {
            id: "m",
            initial: "a",
            context,
            states: { a: { on: { GO: [{ target: "b", actions: ["x"] }] } }, b: { meta: { tag: 1 } } },
        };
        createMachine(config);

        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.states)).toBe(true);
        expect(Object.isFrozen(config.states.a.on.GO)).toBe(true);
        expect(Object.isFrozen(config.states.a.on.GO[0])).toBe(true);
        expect(Object.isFrozen(config.states.a.on.GO[0].actions)).toBe(true);
        expect(Object.isFrozen(config.states.b.meta)).toBe(true);
        expect(Object.isFrozen(context)).toBe(false);
        expect(Object.isFrozen(context.nested)).toBe(false);
        context.count = 1;
        expect(getMachineModel(createMachine(config)).context()).toBe(context);
    });

    it("throws MachineConfigError with a path-qualified message for invalid configs", () => {
        expect(() => createMachine({ initial: "a", states: { a: { invoke: { src: "x" } } } } as never)).toThrow(
            new MachineConfigError("states.a", "'invoke' is not supported"),
        );
        expect(() =>
            createMachine({ initial: "a", states: { a: { on: { GO: { target: "b", cond: "x" } } } } } as never),
        ).toThrow("states.a.on.GO[0]: 'cond' has been renamed to 'guard'");
    });

    it("throws MachineConfigError for malformed implementation tables", () => {
        expect(() => createMachine({ initial: "a", states: { a: {} } }, { actions: { a: 1 } } as never)).toThrow(
            MachineConfigError,
        );
    });

    it("leaves a rejected config unfrozen: config first, then implementations, then the freeze", () => {
        const badConfig = { id: "m", initial: "a", states: { a: { invoke: { src: "x" }, on: { GO: "a" } } } };
        expect(() => createMachine(badConfig as never)).toThrow(MachineConfigError);
        expect(Object.isFrozen(badConfig)).toBe(false);
        expect(Object.isFrozen(badConfig.states.a)).toBe(false);
        expect(Object.isFrozen(badConfig.states.a.on)).toBe(false);

        const config = { id: "m", initial: "a", states: { a: { on: { GO: [{ target: "a", actions: ["x"] }] } } } };
        expect(() => createMachine(config, { actions: { x: 1 } } as never)).toThrow(MachineConfigError);
        expect(Object.isFrozen(config)).toBe(false);
        expect(Object.isFrozen(config.states.a.on.GO)).toBe(false);
        expect(Object.isFrozen(config.states.a.on.GO[0].actions)).toBe(false);

        // Fixable in place, then accepted and frozen.
        delete (badConfig.states.a as { invoke?: unknown }).invoke;
        expect(() => createMachine(badConfig as never)).not.toThrow();
        expect(Object.isFrozen(badConfig.states.a)).toBe(true);
        expect(Object.isFrozen(badConfig.states.a.on)).toBe(true);
    });

    it("rejects reserved xstate event descriptors that could never fire", () => {
        expect(() =>
            createMachine({ initial: "a", states: { a: { on: { "xstate.error.actor.child": "a" } } } }),
        ).toThrow(
            new MachineConfigError(
                "states.a.on",
                "'xstate.error.actor.child' is a reserved XState actor-system event; actors/invoke are not supported, so the handler could never fire",
            ),
        );
        expect(() => createMachine({ initial: "a", states: { a: { on: { "xstate.init": "a" } } } })).toThrow(
            /'xstate.init' is a reserved XState system event/,
        );
        expect(() => createMachine({ initial: "a", states: { a: { on: { "xstate.stop": "a" } } } })).toThrow(
            /'xstate.stop' is a reserved XState system event/,
        );
    });

    it("rejects XState's own creators, in the config and in the implementation tables", () => {
        expect(() =>
            createMachine({ initial: "a", states: { a: { entry: xstateAssign({ n: 1 }) as never } } }),
        ).toThrow("states.a.entry[0]: 'xstate.assign' was created by the xstate package");
        expect(() =>
            createMachine(
                { initial: "a", states: { a: {} } },
                { actions: { x: sendTo("child", { type: "X" }) as never } },
            ),
        ).toThrow("implementations.actions.x: 'xstate.sendTo' is an XState builtin that is not supported");
        expect(() =>
            createMachine({ initial: "a", states: { a: {} } }, { guards: { g: xstateStateIn("a") as never } }),
        ).toThrow("implementations.guards.g: 'stateIn' guard was created by the xstate package");
        // provide() validates the same way.
        const definition = createMachine({ initial: "a", states: { a: {} } });
        expect(() => definition.provide({ actions: { x: xstateAssign({}) as never } })).toThrow(
            "implementations.actions.x: 'xstate.assign' was created by the xstate package",
        );
    });

    it("exposes the config as a read-only view, matching the deep freeze at runtime", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "a" } } } });
        expect(() => {
            // @ts-expect-error -- `config` is deeply read-only
            definition.config.id = "other";
        }).toThrow(TypeError);
        const nodeA = definition.config.states?.a;
        if (nodeA === undefined) throw new Error("expected states.a");
        expect(() => {
            // @ts-expect-error -- nested objects are read-only too
            nodeA.on = {};
        }).toThrow(TypeError);
        expect(definition.config.id).toBe("m");
        expect(nodeA.on).toEqual({ GO: "a" });
    });

    it("does not check implementation names eagerly (provide() may add them later)", () => {
        expect(() =>
            createMachine({ initial: "a", states: { a: { entry: "missing", on: { E: { guard: "missing" } } } } }),
        ).not.toThrow();
    });
});
