/**
 * Round 1 differential scenarios: final states — `done.state` events on
 * compound states with output, machine output at the root, done at
 * initialization, done chains.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "top-level final: status done, static machine output, exit actions run, later events ignored",
        config: (lib) => ({
            id: "m",
            initial: "a",
            exit: lib.record("rootOut"),
            output: { result: "static" },
            states: {
                a: { exit: lib.record("aOut"), on: { FINISH: "done" } },
                done: { type: "final", entry: lib.record("doneIn"), exit: lib.record("doneOut") },
            },
        }),
        events: [{ type: "FINISH" }, { type: "FINISH" }],
    },
    {
        name: "machine output function receives the done event of the top-level final with its output",
        config: (lib) => ({
            id: "m",
            context: { count: 2 },
            initial: "a",
            output: ({ context, event }: any) => ({
                count: context.count,
                finalOutput: event.output,
                type: event.type,
            }),
            states: {
                a: {
                    on: {
                        FINISH: {
                            target: "done",
                            actions: lib.assign({ count: ({ context }: any) => context.count + 1 }),
                        },
                    },
                },
                done: {
                    type: "final",
                    output: ({ context, event }: any) => ({ fromFinal: context.count, cause: event.type }),
                },
            },
        }),
        events: [{ type: "FINISH" }],
    },
    {
        name: "done.state on a compound state: onDone receives the final child's output",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { NEXT: "f" } },
                        f: {
                            type: "final",
                            entry: lib.record("fIn"),
                            output: ({ event }: any) => ({ via: event.type, value: 42 }),
                        },
                    },
                    onDone: {
                        target: "next",
                        actions: lib.record("pDone", ({ event }) => event),
                    },
                },
                next: { entry: lib.record("nextIn") },
            },
        }),
        events: [{ type: "NEXT" }],
    },
    {
        name: "done.state with a static output and a guarded onDone array",
        config: (lib) => ({
            id: "m",
            context: { accept: false },
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { NEXT: "f", ACCEPT: { actions: lib.assign({ accept: true }) } } },
                        f: { type: "final", output: { code: 7 } },
                    },
                    onDone: [
                        { target: "accepted", guard: ({ context }: any) => context.accept },
                        { target: "rejected", actions: lib.record("rejected", ({ event }) => event.output) },
                    ],
                },
                accepted: {},
                rejected: { on: { RETRY: "p" } },
            },
        }),
        events: [{ type: "NEXT" }, { type: "RETRY" }, { type: "ACCEPT" }, { type: "NEXT" }],
    },
    {
        name: "done chain: a compound's onDone targets a final sibling, finishing the grandparent and the machine",
        config: (lib) => ({
            id: "m",
            initial: "outer",
            output: ({ event }: any) => event.output,
            states: {
                outer: {
                    initial: "inner",
                    states: {
                        inner: {
                            initial: "work",
                            states: {
                                work: { on: { NEXT: "innerFinal" } },
                                innerFinal: { type: "final", output: { inner: true } },
                            },
                            onDone: { target: "outerFinal", actions: lib.record("innerDone", ({ event }) => event) },
                        },
                        outerFinal: { type: "final", output: ({ event }: any) => ({ outer: true, cause: event.type }) },
                    },
                    onDone: { target: "machineFinal", actions: lib.record("outerDone", ({ event }) => event) },
                },
                machineFinal: { type: "final", output: ({ event }: any) => ({ machine: true, from: event.output }) },
            },
        }),
        events: [{ type: "NEXT" }],
    },
    {
        name: "done at initialization: initial state is a top-level final",
        config: (lib) => ({
            id: "m",
            initial: "done",
            entry: lib.record("rootIn"),
            exit: lib.record("rootOut"),
            output: { immediate: true },
            states: {
                done: { type: "final", entry: lib.record("doneIn"), exit: lib.record("doneOut") },
            },
        }),
        events: [{ type: "ANY" }],
    },
    {
        name: "done at initialization through a nested initial final and onDone",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "f",
                    states: { f: { type: "final", output: { nested: true } } },
                    onDone: { target: "end", actions: lib.record("pDone", ({ event }) => event.output) },
                },
                end: { type: "final", output: ({ event }: any) => event.output },
            },
            output: ({ event }: any) => ({ machine: event.output }),
        }),
        events: [],
    },
    {
        name: "a nested final state without onDone on its parent: the machine keeps running",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { NEXT: "f" } },
                        f: { type: "final", entry: lib.record("fIn") },
                    },
                    on: { LEAVE: "q" },
                },
                q: {},
            },
        }),
        events: [{ type: "NEXT" }, { type: "NEXT" }, { type: "LEAVE" }],
    },
    {
        name: "a nested final state keeps its own transitions (on / after allowed on final)",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { GO: "f" } },
                        f: { type: "final", on: { X: { target: "a", actions: lib.record("fromFinal") } } },
                    },
                    onDone: { actions: lib.record("pDone") },
                },
            },
        }),
        events: [{ type: "GO" }, { type: "X" }, { type: "GO" }],
    },
    {
        name: "final output function reads context assigned by the transition into it",
        config: (lib) => ({
            id: "m",
            context: { total: 0 },
            initial: "a",
            output: ({ event }: any) => event.output,
            states: {
                a: {
                    on: {
                        FINISH: {
                            target: "done",
                            actions: lib.assign({ total: ({ event }: any) => event.amount }),
                        },
                    },
                },
                done: { type: "final", output: ({ context }: any) => ({ total: context.total }) },
            },
        }),
        events: [{ type: "FINISH", amount: 9 }],
    },
    {
        name: "re-entering a compound state after it was done re-arms onDone",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { NEXT: "f" } },
                        f: { type: "final" },
                    },
                    onDone: { target: "q", actions: lib.record("pDone") },
                },
                q: { on: { AGAIN: "p" } },
            },
        }),
        events: [{ type: "NEXT" }, { type: "AGAIN" }, { type: "NEXT" }],
    },
];

describeScenarios("differential: final & done", scenarios);
