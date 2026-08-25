/**
 * Round 2 differential scenarios: `context` given as a factory function —
 * per-instance objects, isolation from the factory's template and from other
 * instances, lazy invocation (once per instance, never at createMachine time),
 * and the factory result never being exposed as the snapshot's context object.
 */
import { createActor, createMachine as createXStateMachine } from "xstate";

import { createMachine, Statechart } from "@/statechart";

import { describeScenarios, libraries, runScenario, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "context factory: nested objects and arrays are per instance and updated through assign without touching the template",
        config: (lib) => {
            const template = { items: ["seed"], nested: { n: 0 } };
            return {
                id: "m",
                initial: "a",
                context: () => ({ items: [...template.items], nested: { ...template.nested }, template }),
                states: {
                    a: {
                        on: {
                            ADD: {
                                actions: [
                                    lib.assign({
                                        items: ({ context, event }: any) => [...context.items, event.item],
                                        nested: ({ context }: any) => ({ n: context.nested.n + 1 }),
                                    }),
                                    lib.record("added", ({ context }) => [
                                        context.items,
                                        context.nested,
                                        context.template,
                                    ]),
                                ],
                            },
                        },
                    },
                },
            };
        },
        events: [
            { type: "ADD", item: "x" },
            { type: "ADD", item: "y" },
        ],
    },
    {
        name: "context factory with an initial entry assign: the initial snapshot holds the assigned context",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: () => ({ n: 1, from: "factory" }),
            entry: [
                lib.assign({ n: ({ context }: any) => context.n * 10 }),
                lib.record("rootIn", ({ context, event }) => [event.type, context]),
            ],
            states: { a: { on: { GO: "b" } }, b: {} },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "context factory returning an empty object, guards reading absent keys",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: () => ({}),
            states: {
                a: {
                    on: {
                        GO: [
                            {
                                target: "b",
                                guard: ({ context }: any) => context.flag === true,
                                actions: lib.record("flagged"),
                            },
                            { target: "c", actions: lib.record("unflagged") },
                        ],
                        FLAG: { actions: lib.assign({ flag: true }) },
                    },
                },
                b: {},
                c: { on: { BACK: "a" } },
            },
        }),
        events: [{ type: "GO" }, { type: "BACK" }, { type: "FLAG" }, { type: "GO" }],
    },
];

describeScenarios("differential: context factory", scenarios);

describe("differential: context factory invocation", () => {
    function countingScenario(calls: { n: number }): Scenario {
        return {
            name: "counting",
            config: (lib) => ({
                id: "m",
                initial: "a",
                context: () => {
                    calls.n += 1;
                    return { n: calls.n };
                },
                states: { a: { on: { GO: { actions: lib.assign({ n: 100 }) } } } },
            }),
            events: [{ type: "GO" }],
        };
    }

    it.each([
        ["xstate", libraries.xstate],
        ["rx-toolkit", libraries.rxToolkit],
    ])("%s: the factory is invoked exactly once per instance run", (_name, library) => {
        const calls = { n: 0 };
        const trace = runScenario(library, countingScenario(calls));
        expect(calls.n).toBe(1);
        expect(trace[0]!.context).toEqual({ n: 1 });
        expect(trace[1]!.context).toEqual({ n: 100 });
    });

    it("the factory is not invoked at createMachine time in either library", () => {
        const calls = { n: 0 };
        const config = {
            id: "m",
            initial: "a",
            context: () => {
                calls.n += 1;
                return {};
            },
            states: { a: {} },
        };
        createXStateMachine(config as any);
        expect(calls.n).toBe(0);
        createMachine(config as any);
        expect(calls.n).toBe(0);
    });

    it("every instance gets its own factory result and the snapshot never exposes the object the factory returned", () => {
        const shared = { n: 1 };
        const config = {
            id: "m",
            initial: "a",
            context: () => shared,
            states: { a: {} },
        };

        const xMachine = createXStateMachine(config as any);
        const xFirst = createActor(xMachine).start();
        const xSecond = createActor(xMachine).start();
        expect(xFirst.getSnapshot().context).toEqual(shared);
        expect(xFirst.getSnapshot().context).not.toBe(shared);
        expect(xFirst.getSnapshot().context).not.toBe(xSecond.getSnapshot().context);
        xFirst.stop();
        xSecond.stop();

        const definition = createMachine(config as any);
        const first = new Statechart(definition, { isDisabled: true, inspector: null });
        const second = new Statechart(definition, { isDisabled: true, inspector: null });
        expect(first.getSnapshot().context).toEqual(shared);
        expect(first.getSnapshot().context).not.toBe(shared);
        expect(first.getSnapshot().context).not.toBe(second.getSnapshot().context);
        first.dispose();
        second.dispose();
    });
});
