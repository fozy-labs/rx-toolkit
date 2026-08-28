import { assign, raise } from "./actions";
import { MachineConfigError } from "./core/MachineConfigError";
import * as normalizeModule from "./core/normalize";
import { createMachine } from "./createMachine";
import { and, not, or, stateIn } from "./guards";
import { assertImplementations, getMachineModel, MachineDefinition } from "./MachineDefinition";

const config = {
    id: "light",
    initial: "green",
    context: { ready: false },
    states: {
        green: { after: { SHORT: "yellow" } },
        yellow: { on: { TIMER: { target: "red", guard: "isReady", actions: "warn" } } },
        red: { on: { TIMER: "green" } },
    },
};

function expectConfigError(fn: () => unknown, path: string, detail: string): void {
    let caught: unknown;
    try {
        fn();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(MachineConfigError);
    expect((caught as MachineConfigError).path).toBe(path);
    expect((caught as MachineConfigError).detail).toContain(detail);
}

describe("MachineDefinition", () => {
    describe("construction", () => {
        it("is created only through createMachine and exposes config, id and frozen implementation tables", () => {
            const definition = createMachine(config);
            expect(definition).toBeInstanceOf(MachineDefinition);
            expect(definition.config).toBe(config);
            expect(definition.id).toBe("light");
            expect(definition.implementations).toEqual({ actions: {}, guards: {}, delays: {} });
            expect(Object.isFrozen(definition.implementations)).toBe(true);
            expect(Object.isFrozen(definition.implementations.actions)).toBe(true);
            expect(getMachineModel(definition).root.id).toBe("light");
        });

        it("copies the implementation tables (later mutation of the source object has no effect)", () => {
            const implementations = { actions: { warn: () => undefined } };
            const definition = createMachine(config, implementations);
            implementations.actions = { warn: () => undefined };
            expect(definition.implementations.actions.warn).not.toBe(implementations.actions.warn);
        });
    });

    describe("implementation shape validation", () => {
        it("rejects unknown implementation keys (XState actors / services / devTools)", () => {
            expectConfigError(
                () => createMachine(config, { actors: {} } as never),
                "implementations",
                "'actors' is not supported (allowed: actions, guards, delays)",
            );
        });

        it("rejects non-object implementation tables", () => {
            expectConfigError(
                () => createMachine(config, [] as never),
                "implementations",
                "implementations must be a plain object",
            );
            expectConfigError(
                () => createMachine(config, { actions: [] } as never),
                "implementations.actions",
                "must be a plain object",
            );
        });

        it("rejects action / guard / delay values that could never run", () => {
            expectConfigError(
                () => createMachine(config, { actions: { warn: "warn" } } as never),
                "implementations.actions",
                "action 'warn' must be a function or a builtin action (got string)",
            );
            expectConfigError(
                () => createMachine(config, { actions: { warn: and(["x"]) } } as never),
                "implementations.actions.warn",
                "'xstate.and' is a guard builtin and cannot be used as an action",
            );
            expectConfigError(
                () => createMachine(config, { guards: { isReady: true } } as never),
                "implementations.guards",
                "guard 'isReady' must be a function or a builtin guard (got boolean)",
            );
            expectConfigError(
                () => createMachine(config, { guards: { isReady: assign({}) } } as never),
                "implementations.guards.isReady",
                "'xstate.assign' is an action builtin and cannot be used as a guard",
            );
            expectConfigError(
                () => createMachine(config, { delays: { SHORT: "100" } } as never),
                "implementations.delays",
                "delay 'SHORT' must be a non-negative finite number or a function (got string)",
            );
            expectConfigError(
                () => createMachine(config, { delays: { SHORT: -1 } }),
                "implementations.delays",
                "delay 'SHORT' must be a non-negative finite number or a function (got -1)",
            );
        });

        it("validates builtin payloads inside the tables", () => {
            expectConfigError(
                () => createMachine(config, { actions: { later: raise({ type: "TIMER" }, { delay: -5 }) } }),
                "implementations.actions.later",
                "delay must be a non-negative finite number (got -5)",
            );
        });
    });

    describe("source", () => {
        it("exposes config.source and carries it over provide()", () => {
            const source = "stateDiagram-v2\n    [*] --> green\n";
            const definition = createMachine({ ...config, source });
            expect(definition.source).toBe(source);
            expect(definition.provide({ guards: { isReady: () => true } }).source).toBe(source);
            expect(createMachine(config).source).toBeUndefined();
        });
    });

    describe("provide()", () => {
        it("returns a new definition with merged tables (new wins) and leaves the original untouched", () => {
            const warn = () => undefined;
            const warn2 = () => undefined;
            const isReady = () => true;
            const base = createMachine(config, { actions: { warn }, delays: { SHORT: 100 } });
            const provided = base.provide({ actions: { warn: warn2 }, guards: { isReady } });

            expect(provided).not.toBe(base);
            expect(provided).toBeInstanceOf(MachineDefinition);
            expect(provided.config).toBe(base.config);
            expect(getMachineModel(provided)).toBe(getMachineModel(base));
            expect(provided.implementations).toEqual({
                actions: { warn: warn2 },
                guards: { isReady },
                delays: { SHORT: 100 },
            });
            expect(base.implementations).toEqual({ actions: { warn }, guards: {}, delays: { SHORT: 100 } });
        });

        it("validates the provided tables", () => {
            const base = createMachine(config);
            expectConfigError(
                () => base.provide({ services: {} } as never),
                "implementations",
                "'services' is not supported (allowed: actions, guards, delays)",
            );
        });
    });

    describe("assertImplementations()", () => {
        it("passes when every referenced name is implemented", () => {
            const definition = createMachine(config, {
                actions: { warn: () => undefined },
                guards: { isReady: () => true },
                delays: { SHORT: 10 },
            });
            expect(() => assertImplementations(definition)).not.toThrow();
        });

        it("reports missing names in the order actions, guards, delays", () => {
            const definition = createMachine(config);
            expectConfigError(
                () => assertImplementations(definition),
                "implementations.actions",
                "action 'warn' is not implemented",
            );
            expectConfigError(
                () => assertImplementations(definition.provide({ actions: { warn: () => undefined } })),
                "implementations.guards",
                "guard 'isReady' is not implemented",
            );
            expectConfigError(
                () =>
                    assertImplementations(
                        definition.provide({ actions: { warn: () => undefined }, guards: { isReady: () => true } }),
                    ),
                "implementations.delays",
                "delay 'SHORT' is not implemented",
            );
        });

        it("resolves names referenced by builtins stored in the tables", () => {
            const base = createMachine(config, {
                actions: { warn: raise({ type: "TIMER" }, { delay: "LATER" }) },
                guards: { isReady: and(["a", not("b")]) },
                delays: { SHORT: 1 },
            });
            expectConfigError(
                () => assertImplementations(base),
                "implementations.guards",
                "guard 'a' is not implemented",
            );
            const withGuards = base.provide({ guards: { a: () => true, b: or(["c"]) } });
            expectConfigError(
                () => assertImplementations(withGuards),
                "implementations.guards",
                "guard 'c' is not implemented",
            );
            const withAllGuards = withGuards.provide({ guards: { c: () => false } });
            expectConfigError(
                () => assertImplementations(withAllGuards),
                "implementations.delays",
                "delay 'LATER' is not implemented",
            );
            expect(() => assertImplementations(withAllGuards.provide({ delays: { LATER: 5 } }))).not.toThrow();
        });

        it("resolves stateIn('#id') inside table guards against the model", () => {
            const definition = createMachine(config, {
                actions: { warn: () => undefined },
                guards: { isReady: stateIn("#nope") },
                delays: { SHORT: 1 },
            });
            expectConfigError(
                () => assertImplementations(definition),
                "implementations.guards.isReady",
                "Child state node '#nope' does not exist on machine 'light'",
            );
            expect(() =>
                assertImplementations(definition.provide({ guards: { isReady: stateIn("#light.green") } })),
            ).not.toThrow();
        });

        it("rejects named guards that reference themselves through builtins", () => {
            const definition = createMachine(config, {
                actions: { warn: () => undefined },
                guards: { isReady: and(["other"]), other: or([not("isReady")]) },
                delays: { SHORT: 1 },
            });
            expectConfigError(
                () => assertImplementations(definition),
                "implementations.guards",
                "guard 'isReady' references itself through 'isReady' -> 'other' -> 'isReady'",
            );
        });

        it("remembers a definition that passed and does not re-scan it; a failing one is re-checked every time", () => {
            const definition = createMachine(config, {
                actions: { warn: () => undefined },
                guards: { isReady: and(["a"]), a: () => true },
                delays: { SHORT: 10 },
            });
            const provided = definition.provide({ delays: { SHORT: 20 } });
            const failing = createMachine(config, {
                actions: { warn: () => undefined },
                guards: { isReady: and(["missing"]) },
                delays: { SHORT: 10 },
            });
            // Installed after the eager shape validation of createMachine / provide.
            const validateGuard = vi.spyOn(normalizeModule, "validateGuard");

            assertImplementations(definition);
            expect(validateGuard).toHaveBeenCalledTimes(1); // the builtin `isReady`
            validateGuard.mockClear();
            assertImplementations(definition);
            assertImplementations(definition);
            expect(validateGuard).not.toHaveBeenCalled();

            // A definition returned by provide() is a new object: checked once more.
            assertImplementations(provided);
            expect(validateGuard).toHaveBeenCalledTimes(1);
            validateGuard.mockClear();

            expect(() => assertImplementations(failing)).toThrow(MachineConfigError);
            expect(() => assertImplementations(failing)).toThrow(MachineConfigError);
            expect(validateGuard).toHaveBeenCalledTimes(2);
            validateGuard.mockRestore();
        });

        it("does not fail for names referenced only by another table's unused entries", () => {
            const definition = createMachine(
                { initial: "a", states: { a: {} } },
                { actions: { unused: () => undefined }, guards: { g: () => true } },
            );
            expect(() => assertImplementations(definition)).not.toThrow();
        });
    });
});
