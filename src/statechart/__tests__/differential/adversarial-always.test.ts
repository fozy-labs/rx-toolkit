/**
 * Round 3 (adversarial) differential scenarios: `always` arrays whose first
 * candidate stops being enabled after its own assign, eventless transitions
 * that see the triggering event, entry-time assigns that flip guards, and
 * always-vs-raise interleaving.
 */
import { describeScenarios, type Scenario } from "./harness";

type Counter = { context: { n: number } };

const scenarios: Scenario[] = [
    {
        name: "always array: the first targetless candidate assigns until its guard fails, then the second candidate transitions",
        config: (lib) => ({
            id: "m",
            context: { n: 0 },
            initial: "loop",
            states: {
                loop: {
                    entry: lib.record("loopIn"),
                    exit: lib.record("loopOut"),
                    always: [
                        {
                            guard: ({ context }: Counter) => context.n < 3,
                            actions: [
                                lib.assign({ n: ({ context }: Counter) => context.n + 1 }),
                                lib.record("bump", ({ context }) => context.n),
                            ],
                        },
                        { target: "done", actions: lib.record("toDone", ({ context }) => context.n) },
                    ],
                },
                done: { entry: lib.record("doneIn") },
            },
        }),
        events: [],
    },
    {
        name: "always array: the first candidate's target state bounces back with always, and its assign has disabled the first candidate",
        config: (lib) => ({
            id: "m",
            context: { flag: true },
            initial: "router",
            states: {
                router: {
                    entry: lib.record("routerIn"),
                    always: [
                        {
                            guard: ({ context }: { context: { flag: boolean } }) => context.flag,
                            target: "x",
                            actions: [lib.assign({ flag: false }), lib.record("toX")],
                        },
                        { target: "y", actions: lib.record("toY") },
                    ],
                },
                x: { entry: lib.record("xIn"), always: { target: "router", actions: lib.record("back") } },
                y: { entry: lib.record("yIn") },
            },
        }),
        events: [],
    },
    {
        name: "always guard sees the event that triggered the macrostep: xstate.init, an external event, a raised event, an after event",
        config: (lib) => ({
            id: "m",
            context: { seen: [] as string[] },
            initial: "a",
            states: {
                a: {
                    always: {
                        guard: ({ event }: { event: { type: string } }) => event.type === "xstate.init",
                        target: "b",
                        actions: lib.record("initAlways", ({ event }) => event.type),
                    },
                },
                b: {
                    on: { GO: { target: "c", actions: lib.record("go") } },
                },
                c: {
                    always: [
                        {
                            guard: ({ event }: { event: { type: string } }) => event.type === "GO",
                            target: "d",
                            actions: [
                                lib.record("goAlways", ({ event }) => event),
                                lib.raise({ type: "RAISED", n: 1 }),
                            ],
                        },
                    ],
                },
                d: {
                    on: { RAISED: { target: "e", actions: lib.record("raised", ({ event }) => event) } },
                },
                e: {
                    always: {
                        guard: ({ event }: { event: { type: string } }) => event.type === "RAISED",
                        target: "f",
                        actions: lib.record("raisedAlways", ({ event }) => event),
                    },
                },
                f: {
                    after: { 10: "g" },
                },
                g: {
                    always: {
                        guard: ({ event }: { event: { type: string } }) => event.type.startsWith("xstate.after"),
                        target: "h",
                        actions: lib.record("afterAlways", ({ event }) => event),
                    },
                },
                h: {},
            },
        }),
        events: [{ type: "GO" }, { advance: 10 }],
    },
    {
        name: "entry assign of the target flips the target's own always guard: the state is left in the same macrostep",
        config: (lib) => ({
            id: "m",
            context: { ready: false },
            initial: "a",
            states: {
                a: { on: { GO: "b" } },
                b: {
                    entry: [lib.record("bIn", ({ context }) => context), lib.assign({ ready: true })],
                    exit: lib.record("bOut", ({ context }) => context),
                    always: { guard: ({ context }: { context: { ready: boolean } }) => context.ready, target: "c" },
                },
                c: { entry: lib.record("cIn", ({ context }) => context) },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "transition action assigns and the target's always is guarded on the assigned value: guard sees the new context",
        config: (lib) => ({
            id: "m",
            context: { n: 0 },
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: { target: "b", actions: lib.assign({ n: 5 }) },
                        GO_SMALL: { target: "b", actions: lib.assign({ n: 1 }) },
                    },
                },
                b: {
                    always: [
                        { guard: ({ context }: Counter) => context.n > 3, target: "big" },
                        { guard: ({ context }: Counter) => context.n > 0, target: "small" },
                    ],
                },
                big: { on: { RESET: "a" } },
                small: { on: { RESET: "a" } },
            },
        }),
        events: [{ type: "GO" }, { type: "RESET" }, { type: "GO_SMALL" }],
    },
    {
        name: "always with a raise in its actions: the raised event is handled after the eventless transition settles, then always runs again",
        config: (lib) => ({
            id: "m",
            context: { n: 0 },
            initial: "a",
            states: {
                a: {
                    always: {
                        guard: ({ context }: Counter) => context.n === 0,
                        target: "b",
                        actions: [lib.raise({ type: "PING" }), lib.record("aAlways")],
                    },
                    on: { PING: { actions: lib.record("pingInA") } },
                },
                b: {
                    entry: lib.record("bIn"),
                    on: { PING: { target: "c", actions: [lib.assign({ n: 1 }), lib.record("pingInB")] } },
                    always: { guard: ({ context }: Counter) => context.n === 1, target: "never" },
                },
                c: {
                    entry: lib.record("cIn"),
                    always: {
                        guard: ({ context }: Counter) => context.n === 1,
                        target: "d",
                        actions: lib.record("cAlways"),
                    },
                },
                d: { entry: lib.record("dIn") },
                never: { entry: lib.record("neverIn") },
            },
        }),
        events: [],
    },
    {
        name: "always on a parent with a child's always guarded: child guard failing lets the parent's always fire, and the parent's assign then enables the child",
        config: (lib) => ({
            id: "m",
            context: { childReady: false },
            initial: "parent",
            states: {
                parent: {
                    initial: "child",
                    always: {
                        guard: ({ context }: { context: { childReady: boolean } }) => !context.childReady,
                        actions: [lib.assign({ childReady: true }), lib.record("parentAlways")],
                    },
                    states: {
                        child: {
                            always: {
                                guard: ({ context }: { context: { childReady: boolean } }) => context.childReady,
                                target: "#m.out",
                                actions: lib.record("childAlways"),
                            },
                        },
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [],
    },
    {
        name: "always in two parallel regions where the first region's always exits the parallel state: the second region's always never runs",
        config: (lib) => ({
            id: "m",
            context: { go: false },
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    on: { GO: { actions: lib.assign({ go: true }) } },
                    states: {
                        a: {
                            initial: "a1",
                            states: {
                                a1: {
                                    always: {
                                        guard: ({ context }: { context: { go: boolean } }) => context.go,
                                        target: "#m.out",
                                        actions: lib.record("aAlways"),
                                    },
                                },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    always: {
                                        guard: ({ context }: { context: { go: boolean } }) => context.go,
                                        target: "b2",
                                        actions: lib.record("bAlways"),
                                    },
                                },
                                b2: { entry: lib.record("b2In") },
                            },
                        },
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
];

describeScenarios("differential: adversarial always", scenarios);
