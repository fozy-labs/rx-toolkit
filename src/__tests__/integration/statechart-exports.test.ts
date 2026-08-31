import {
    and,
    assign,
    cancel,
    log,
    MachineConfigError,
    MachineDefinition,
    mutate,
    not,
    or,
    raise,
    stateIn,
    unstable_createMachine,
    unstable_MachineSignal,
    unstable_Statechart,
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
        it("exports unstable_createMachine", () => {
            expect(unstable_createMachine).toBeDefined();
            expect(typeof unstable_createMachine).toBe("function");
        });

        it("exports MachineDefinition (class, constructed only via unstable_createMachine)", () => {
            expect(MachineDefinition).toBeDefined();
            expect(typeof MachineDefinition).toBe("function");
            const definition = unstable_createMachine({ id: "m", initial: "a", states: { a: {} } });
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
        it("exports unstable_MachineSignal with the static state() factory", () => {
            expect(unstable_MachineSignal).toBeDefined();
            expect(typeof unstable_MachineSignal.state).toBe("function");
        });

        it("exports unstable_Statechart (class)", () => {
            expect(unstable_Statechart).toBeDefined();
            expect(typeof unstable_Statechart).toBe("function");
        });

        it("unstable_MachineSignal.state() wires a running machine end to end", () => {
            const definition = unstable_createMachine({
                id: "m",
                initial: "a",
                states: { a: { on: { GO: "b" } }, b: {} },
            });
            const machine$ = unstable_MachineSignal.state(definition);
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

            const definition = unstable_createMachine(config, implementations);
            const machine$: MachineStateSignal<{ n: number }, { type: "GO" }> = unstable_MachineSignal.state(
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
