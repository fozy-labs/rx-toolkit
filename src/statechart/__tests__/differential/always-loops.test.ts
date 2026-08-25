/**
 * Round 2 differential scenarios: eventless loops resolved by context
 * (self-loops with and without reenter, ping-pong between states, event-driven
 * unlocking, loops driven by raised events) and eventless transitions declared
 * on the root node.
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "always self-loop with reenter: exit / entry run per iteration until the guard resolves the loop",
        config: (lib) => ({
            id: "m",
            initial: "loop",
            context: { n: 0 },
            states: {
                loop: {
                    entry: lib.record("loopIn", ({ context }) => context.n),
                    exit: lib.record("loopOut", ({ context }) => context.n),
                    always: [
                        {
                            target: "done",
                            guard: ({ context }: any) => context.n >= 3,
                            actions: lib.record("leave"),
                        },
                        {
                            target: "loop",
                            reenter: true,
                            actions: lib.assign({ n: ({ context }: any) => context.n + 1 }),
                        },
                    ],
                },
                done: { entry: lib.record("doneIn", ({ context }) => context.n) },
            },
        }),
        events: [],
    },
    {
        name: "always self-target without reenter: no exit / entry, the context change alone drives the loop",
        config: (lib) => ({
            id: "m",
            initial: "idle",
            context: { n: 0 },
            states: {
                idle: { on: { GO: "loop" } },
                loop: {
                    entry: lib.record("loopIn"),
                    exit: lib.record("loopOut"),
                    always: [
                        { target: "done", guard: ({ context }: any) => context.n >= 3 },
                        {
                            target: "loop",
                            actions: [
                                lib.assign({ n: ({ context }: any) => context.n + 1 }),
                                lib.record("tick", ({ context }) => context.n),
                            ],
                        },
                    ],
                },
                done: { entry: lib.record("doneIn", ({ context }) => context.n) },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "ping-pong always between two states resolved by a counter",
        config: (lib) => ({
            id: "m",
            initial: "idle",
            context: { n: 0 },
            states: {
                idle: { on: { GO: "a" } },
                a: {
                    entry: lib.record("aIn"),
                    always: {
                        target: "b",
                        actions: [
                            lib.assign({ n: ({ context }: any) => context.n + 1 }),
                            lib.record("aToB", ({ context }) => context.n),
                        ],
                    },
                },
                b: {
                    entry: lib.record("bIn"),
                    always: [
                        { target: "out", guard: ({ context }: any) => context.n >= 3, actions: lib.record("bOut") },
                        { target: "a", actions: lib.record("bToA") },
                    ],
                },
                out: { entry: lib.record("outIn", ({ context }) => context.n) },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "targetless always unlocked by events: each event grants more iterations",
        config: (lib) => ({
            id: "m",
            initial: "loop",
            context: { budget: 0, n: 0 },
            states: {
                loop: {
                    always: {
                        guard: ({ context }: any) => context.n < context.budget,
                        actions: [
                            lib.assign({ n: ({ context }: any) => context.n + 1 }),
                            lib.record("step", ({ context }) => context.n),
                        ],
                    },
                    on: {
                        GRANT: {
                            actions: lib.assign({ budget: ({ context, event }: any) => context.budget + event.amount }),
                        },
                        NOOP: {},
                    },
                },
            },
        }),
        events: [{ type: "GRANT", amount: 2 }, { type: "NOOP" }, { type: "GRANT", amount: 1 }],
    },
    {
        name: "always loop driven by raised events handled by the parent's targetless transitions",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { n: 0, stop: false },
            states: {
                p: {
                    initial: "loop",
                    on: {
                        BUMP: { actions: lib.assign({ n: ({ context }: any) => context.n + 1 }) },
                        HALT: { actions: lib.assign({ stop: true }) },
                    },
                    states: {
                        loop: {
                            always: [
                                { target: "settled", guard: ({ context }: any) => context.stop },
                                {
                                    guard: ({ context }: any) => context.n < 2,
                                    actions: [lib.raise({ type: "BUMP" }), lib.record("raisedBump")],
                                },
                                { actions: [lib.raise({ type: "HALT" }), lib.record("raisedHalt")] },
                            ],
                        },
                        settled: { entry: lib.record("settledIn", ({ context }) => context.n) },
                    },
                },
            },
        }),
        events: [],
    },
    {
        name: "eventless transition on the root: evaluated for every leaf, shadowed by a leaf's own enabled always",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { flag: false },
            always: {
                target: ".c",
                guard: ({ context }: any) => context.flag,
                actions: [lib.record("rootAlways"), lib.assign({ flag: false })],
            },
            states: {
                a: { on: { SET: { actions: lib.assign({ flag: true }) }, TO_B: "b" } },
                b: {
                    always: {
                        target: "d",
                        guard: ({ context }: any) => context.flag,
                        actions: [lib.record("bAlways"), lib.assign({ flag: false })],
                    },
                    on: { SET: { actions: lib.assign({ flag: true }) } },
                },
                c: { entry: lib.record("cIn"), on: { RESET: "a", TO_B: "b" } },
                d: { entry: lib.record("dIn"), on: { SET: { actions: lib.assign({ flag: true }) } } },
            },
        }),
        events: [{ type: "SET" }, { type: "RESET" }, { type: "TO_B" }, { type: "SET" }, { type: "SET" }],
    },
    {
        name: "root always at initialization: the initial snapshot already reflects the root's eventless transition",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { skip: true },
            always: {
                target: ".b",
                guard: ({ context }: any) => context.skip,
                actions: [lib.record("rootAlways"), lib.assign({ skip: false })],
            },
            states: {
                a: { entry: lib.record("aIn"), exit: lib.record("aOut") },
                b: { entry: lib.record("bIn"), on: { NEXT: "c" } },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ type: "NEXT" }],
    },
    {
        name: "root always whose target is already active: exit / entry run once, then the machine settles",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { flag: false },
            always: { target: ".c", guard: ({ context }: any) => context.flag, actions: lib.record("rootAlways") },
            states: {
                a: { on: { SET: { actions: lib.assign({ flag: true }) } } },
                c: {
                    entry: lib.record("cIn"),
                    exit: lib.record("cOut"),
                    on: { CLEAR: { actions: lib.assign({ flag: false }) } },
                },
            },
        }),
        events: [{ type: "SET" }, { type: "CLEAR" }],
    },
    {
        name: "root always on a parallel root: fires for the region whose leaf has no enabled always of its own",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            context: { flag: false },
            always: {
                target: "#m.r1.done",
                guard: ({ context }: any) => context.flag,
                actions: [lib.record("rootAlways"), lib.assign({ flag: false })],
            },
            states: {
                r1: {
                    initial: "x",
                    states: {
                        x: { on: { SET: { actions: lib.assign({ flag: true }) } } },
                        done: { entry: lib.record("doneIn") },
                    },
                },
                r2: {
                    initial: "y",
                    states: {
                        y: {
                            entry: lib.record("yIn"),
                            always: {
                                target: "z",
                                guard: ({ context }: any) => context.flag,
                                actions: lib.record("yAlways"),
                            },
                        },
                        z: { entry: lib.record("zIn") },
                    },
                },
            },
        }),
        events: [{ type: "SET" }],
    },
];

describeScenarios("differential: always loops and root eventless transitions", scenarios);
