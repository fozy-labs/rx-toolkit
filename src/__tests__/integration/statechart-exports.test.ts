import {
    and,
    assign,
    cancel,
    createMachine,
    log,
    MachineConfigError,
    MachineDefinition,
    MachineSignal,
    mutate,
    not,
    or,
    raise,
    Statechart,
    stateIn,
} from "@/statechart";
import type {
    AnyEventObject,
    EventObject,
    MachineConfig,
    MachineContext,
    MachineImplementations,
    MachineSnapshot,
    MachineStateSignal,
    StatechartOptions,
    StatechartOptionsOrKey,
    StatechartStatus,
    StateValue,
    ToMermaidOptions,
    ToXStateSourceOptions,
} from "@/statechart";

describe("Statechart module exports", () => {
    describe("definition", () => {
        it("exports createMachine", () => {
            expect(createMachine).toBeDefined();
            expect(typeof createMachine).toBe("function");
        });

        it("exports MachineDefinition (class, constructed only via createMachine)", () => {
            expect(MachineDefinition).toBeDefined();
            expect(typeof MachineDefinition).toBe("function");
            const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });
            expect(definition).toBeInstanceOf(MachineDefinition);
            expect(typeof definition.provide).toBe("function");
            expect(typeof definition.toXStateSource).toBe("function");
            expect(typeof definition.toMermaid).toBe("function");
        });

        it("exports MachineConfigError", () => {
            expect(MachineConfigError).toBeDefined();
            expect(typeof MachineConfigError).toBe("function"); // class
            expect(new MachineConfigError("states.a", "oops")).toBeInstanceOf(Error);
        });
    });

    describe("runtime", () => {
        it("exports MachineSignal with the static state() factory", () => {
            expect(MachineSignal).toBeDefined();
            expect(typeof MachineSignal.state).toBe("function");
        });

        it("exports Statechart (class)", () => {
            expect(Statechart).toBeDefined();
            expect(typeof Statechart).toBe("function");
        });

        it("MachineSignal.state() wires a running machine end to end", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: { a: { on: { GO: "b" } }, b: {} },
            });
            const machine$ = MachineSignal.state(definition);
            expect(machine$().value).toBe("a");
            machine$.send({ type: "GO" });
            expect(machine$().value).toBe("b");
            machine$.dispose();
        });
    });

    describe("builtins", () => {
        it("exports the action creators", () => {
            expect(typeof assign).toBe("function");
            expect(typeof mutate).toBe("function");
            expect(typeof raise).toBe("function");
            expect(typeof cancel).toBe("function");
            expect(typeof log).toBe("function");
        });

        it("exports the guard creators", () => {
            expect(typeof and).toBe("function");
            expect(typeof or).toBe("function");
            expect(typeof not).toBe("function");
            expect(typeof stateIn).toBe("function");
        });
    });

    describe("types", () => {
        it("exports the public types", () => {
            const config: MachineConfig<{ n: number }, { type: "GO" }> = {
                id: "m",
                initial: "a",
                context: { n: 0 },
                states: { a: {} },
            };
            const implementations: MachineImplementations<{ n: number }, { type: "GO" }> = {};
            const options: StatechartOptions = { key: "x", autoStart: false };
            const optionsOrKey: StatechartOptionsOrKey = "x";
            const status: StatechartStatus = "idle";
            const value: StateValue = { a: "b" };
            const event: EventObject = { type: "GO" };
            const anyEvent: AnyEventObject = { type: "GO", extra: 1 };
            const context: MachineContext = { n: 1 };
            const mermaidOptions: ToMermaidOptions = { direction: "LR" };
            const sourceOptions: ToXStateSourceOptions = { includeImport: false };

            const definition = createMachine(config, implementations);
            const machine$: MachineStateSignal<{ n: number }, { type: "GO" }> = MachineSignal.state(
                definition,
                options,
            );
            const snapshot: MachineSnapshot<{ n: number }> = machine$();
            expect(snapshot.status).toBe("active");
            expect([optionsOrKey, status, value, event, anyEvent, context, mermaidOptions, sourceOptions]).toHaveLength(
                8,
            );
            machine$.dispose();
        });
    });
});
