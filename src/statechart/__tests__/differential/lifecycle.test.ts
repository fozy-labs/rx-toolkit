/**
 * Round 2 differential scenarios: lifecycle edges — events and timers after
 * the machine is done / stopped / errored, stop() on a finished machine, and
 * the entry actions of the initial configuration at start (order, assign
 * visibility, xstate.init, immediate and delayed raises, after timers).
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "events after a top-level final: transitions on the final and on the root are dead, the after timer was cancelled",
        config: (lib) => ({
            id: "m",
            initial: "a",
            on: { PING: { actions: lib.record("rootPing") } },
            states: {
                a: { on: { FINISH: "f" } },
                f: {
                    type: "final",
                    on: { BACK: { target: "a", actions: lib.record("back") } },
                    after: { 10: { target: "a", actions: lib.record("fAfter") } },
                },
            },
        }),
        events: [{ type: "FINISH" }, { type: "PING" }, { type: "BACK" }, { advance: 10 }],
        probes: { matches: ["f", "a"], can: [{ type: "PING" }, { type: "BACK" }] },
    },
    {
        name: "done through an always chain at initialization: no event is ever handled",
        config: (lib) => ({
            id: "m",
            initial: "a",
            on: { PING: { actions: lib.record("rootPing") } },
            states: {
                a: { entry: lib.record("aIn"), always: "b" },
                b: { entry: lib.record("bIn"), always: "f" },
                f: { type: "final", entry: lib.record("fIn"), output: { done: true } },
            },
        }),
        events: [{ type: "PING" }, { advance: 10 }],
        probes: { matches: ["f"] },
    },
    {
        name: "stop() then send / advance: nothing changes, the delayed raise and the after timer are cancelled",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: lib.raise({ type: "LATER" }, { delay: 10, id: "later" }),
                    after: { 20: { target: "b", actions: lib.record("aAfter") } },
                    on: {
                        GO: { target: "c", actions: lib.record("go") },
                        LATER: { target: "d", actions: lib.record("later") },
                    },
                },
                b: {},
                c: {},
                d: {},
            },
        }),
        events: [{ advance: 5 }, { stop: true }, { type: "GO" }, { advance: 30 }],
        probes: { matches: ["a", "c"], can: [{ type: "GO" }] },
    },
    {
        name: "stop() inside a parallel state: no exit actions, regions keep their value in the stopped snapshot",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            exit: lib.record("rootOut"),
            states: {
                r1: {
                    initial: "a",
                    states: {
                        a: { exit: lib.record("aOut"), on: { NEXT: "b" } },
                        b: { exit: lib.record("bOut") },
                    },
                },
                r2: {
                    initial: "x",
                    states: { x: { exit: lib.record("xOut"), after: { 10: "y" } }, y: {} },
                },
            },
        }),
        events: [{ type: "NEXT" }, { stop: true }, { advance: 10 }, { type: "NEXT" }],
        probes: { matches: [{ r1: "b" }, { r2: "x" }] },
    },
    {
        name: "stop() on a done machine is a no-op: the snapshot stays done with its output",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: { on: { FINISH: "f" } },
                f: { type: "final", output: { ok: true } },
            },
        },
        events: [{ type: "FINISH" }, { stop: true }, { type: "FINISH" }],
    },
    {
        name: "stop() on a machine in error status keeps the error snapshot",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        BOOM: {
                            actions: () => {
                                throw new Error("boom");
                            },
                        },
                        GO: { target: "b", actions: lib.record("go") },
                    },
                },
                b: {},
            },
        }),
        events: [{ type: "BOOM" }, { stop: true }, { type: "GO" }],
    },
    {
        name: "initial entry actions at start: root → compound → leaf order, assign visible to later entries, log in the list, after armed",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { steps: [] as string[] },
            entry: [
                lib.assign({ steps: ({ context }: any) => [...context.steps, "root"] }),
                lib.record("rootIn", ({ context, event }) => [event.type, context.steps]),
                lib.log(({ context }: any) => context.steps.length, "steps"),
            ],
            states: {
                p: {
                    initial: "x",
                    entry: [
                        lib.assign({ steps: ({ context }: any) => [...context.steps, "p"] }),
                        lib.record("pIn", ({ context }) => context.steps),
                    ],
                    states: {
                        x: {
                            entry: [
                                lib.assign({ steps: ({ context }: any) => [...context.steps, "x"] }),
                                lib.record("xIn", ({ context }) => context.steps),
                            ],
                            after: { 10: { target: "y", actions: lib.record("xAfter") } },
                        },
                        y: { entry: lib.record("yIn", ({ context, event }) => [event.type, context.steps]) },
                    },
                },
            },
        }),
        events: [{ advance: 10 }],
    },
    {
        name: "initial entry actions on a parallel root run for every region in document order and see xstate.init",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            entry: lib.record("rootIn", ({ event }) => event.type),
            states: {
                r1: {
                    initial: "a",
                    entry: lib.record("r1In", ({ event }) => event.type),
                    states: {
                        a: {
                            initial: "a1",
                            entry: lib.record("aIn"),
                            states: { a1: { entry: lib.record("a1In", ({ event }) => event.type) } },
                        },
                    },
                },
                r2: {
                    initial: "x",
                    entry: lib.record("r2In"),
                    states: { x: { entry: lib.record("xIn", ({ event }) => event.type) } },
                },
            },
        }),
        events: [],
    },
    {
        name: "initial state entry raises immediately and with a delay: the immediate one is processed before the first snapshot",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: [
                        lib.raise({ type: "NOW" }),
                        lib.raise({ type: "LATER" }, { delay: 10, id: "later" }),
                        lib.record("aIn"),
                    ],
                    on: { NOW: { target: "b", actions: lib.record("now") } },
                },
                b: { entry: lib.record("bIn"), on: { LATER: { target: "c", actions: lib.record("later") } } },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ advance: 10 }],
    },
    {
        name: "initial entry action assigns from the initial event; a guarded initial always reads that context",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { initType: "" },
            entry: lib.assign({ initType: ({ event }: any) => event.type }),
            states: {
                a: {
                    always: [
                        {
                            target: "init",
                            guard: ({ context }: any) => context.initType === "xstate.init",
                            actions: lib.record("sawInit", ({ context }) => context.initType),
                        },
                        { target: "other" },
                    ],
                },
                init: {},
                other: {},
            },
        }),
        events: [],
    },
];

describeScenarios("differential: lifecycle (done / stopped / start)", scenarios);
