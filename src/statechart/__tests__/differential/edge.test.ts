/**
 * Round 1 differential scenarios: edge cases across themes — wildcard vs.
 * system events, conflicting eventless transitions in parallel regions,
 * parallel self-transitions, errors thrown by actions / always guards, after
 * chains and equal delays, tags.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "exact descriptor with a failing guard falls back to the wildcard of the same node",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        EV: { target: "b", guard: () => false, actions: lib.record("exact") },
                        "*": { target: "c", actions: lib.record("wildcard") },
                    },
                },
                b: {},
                c: {},
            },
        }),
        events: [{ type: "EV" }],
    },
    {
        name: "a child's wildcard shadows the parent's after transition (system events are ordinary events)",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    after: { 10: { target: "out", actions: lib.record("parentAfter") } },
                    states: {
                        x: {
                            on: { "*": { actions: lib.record("childWildcard", ({ event }) => event.type) }, NEXT: "y" },
                        },
                        y: {},
                    },
                },
                out: {},
            },
        }),
        events: [{ advance: 10 }, { advance: 10 }, { type: "NEXT" }, { advance: 10 }],
    },
    {
        name: "a wildcard on the final child catches the parent's done event before onDone",
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
                            on: { "*": { actions: lib.record("finalWildcard", ({ event }) => event.type) } },
                        },
                    },
                    onDone: { target: "done", actions: lib.record("pDone") },
                },
                done: {},
            },
        }),
        events: [{ type: "NEXT" }, { type: "OTHER" }],
    },
    {
        name: "eventless transitions in two parallel regions enabled by one event fire in the same macrostep",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            context: { go: false },
            on: { GO: { actions: lib.assign({ go: true }) } },
            states: {
                a: {
                    initial: "a1",
                    states: {
                        a1: {
                            always: {
                                target: "a2",
                                guard: ({ context }: any) => context.go,
                                actions: lib.record("aAlways"),
                            },
                        },
                        a2: {},
                    },
                },
                b: {
                    initial: "b1",
                    states: {
                        b1: {
                            always: {
                                target: "b2",
                                guard: ({ context }: any) => context.go,
                                actions: lib.record("bAlways"),
                            },
                        },
                        b2: {},
                    },
                },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "conflicting eventless transitions: a region's always targeting outside the parallel state wins by document order",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { go: false },
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
                                        target: "#m.out",
                                        guard: ({ context }: any) => context.go,
                                        actions: lib.record("aLeaves"),
                                    },
                                },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    always: {
                                        target: "b2",
                                        guard: ({ context }: any) => context.go,
                                        actions: lib.record("bMoves"),
                                    },
                                },
                                b2: {},
                            },
                        },
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "parallel self-transition from a region leaf re-initializes every region",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        a: {
                            initial: "a1",
                            states: {
                                a1: { entry: lib.record("a1In"), on: { NEXT: "a2" } },
                                a2: {
                                    entry: lib.record("a2In"),
                                    on: { RESTART: "#m.p", RESTART_REENTER: { target: "#m.p", reenter: true } },
                                },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { entry: lib.record("b1In"), on: { NEXT: "b2" } },
                                b2: { entry: lib.record("b2In") },
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "NEXT" }, { type: "RESTART" }, { type: "NEXT" }, { type: "RESTART_REENTER" }],
    },
    {
        name: "entering a parallel state through a deep target in one region initializes the others",
        config: (lib) => ({
            id: "m",
            initial: "idle",
            states: {
                idle: { on: { DEEP: "#m.p.a.a2", REGION: "#m.p.b" } },
                p: {
                    type: "parallel",
                    states: {
                        a: {
                            initial: "a1",
                            states: { a1: { entry: lib.record("a1In") }, a2: { entry: lib.record("a2In") } },
                        },
                        b: {
                            initial: "b1",
                            entry: lib.record("bIn"),
                            states: { b1: { entry: lib.record("b1In") } },
                        },
                    },
                    on: { LEAVE: "idle" },
                },
            },
        }),
        events: [{ type: "DEEP" }, { type: "LEAVE" }, { type: "REGION" }],
    },
    {
        name: "mixed handling in parallel regions: one region transitions, another runs a targetless transition",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            states: {
                a: {
                    initial: "a1",
                    states: {
                        a1: { exit: lib.record("a1Out"), on: { EV: { target: "a2", actions: lib.record("aMove") } } },
                        a2: {},
                    },
                },
                b: {
                    initial: "b1",
                    states: {
                        b1: { exit: lib.record("b1Out"), on: { EV: { actions: lib.record("bStay") } } },
                    },
                },
            },
        }),
        events: [{ type: "EV" }],
    },
    {
        name: "a throwing action: earlier actions of the list ran, the machine is in error status, later events ignored",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    exit: lib.record("aOut"),
                    on: {
                        GO: {
                            target: "b",
                            actions: [
                                lib.record("first"),
                                () => {
                                    throw new Error("action failed");
                                },
                                lib.record("never"),
                            ],
                        },
                        SAFE: "b",
                    },
                },
                b: { entry: lib.record("bIn") },
            },
        }),
        events: [{ type: "GO" }, { type: "SAFE" }],
    },
    {
        name: "a throwing always guard: raw error message (no wrapper)",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: "b" } },
                b: {
                    always: {
                        target: "c",
                        guard: () => {
                            throw new Error("always boom");
                        },
                    },
                },
                c: {},
            },
        },
        events: [{ type: "GO" }],
    },
    {
        name: "a throwing entry action at initialization",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.record("rootIn"),
            states: {
                a: {
                    entry: () => {
                        throw new Error("init boom");
                    },
                    on: { GO: "b" },
                },
                b: {},
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "a throwing assign at initialization",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.assign(() => {
                throw new Error("assign boom");
            }),
            states: { a: { on: { GO: "b" } }, b: {} },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "after chain within a single advance and equal delays on parent and child",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { after: { 10: { target: "b", actions: lib.record("aAfter") } } },
                b: { after: { 10: { target: "p", actions: lib.record("bAfter") } } },
                p: {
                    initial: "x",
                    after: { 10: { target: "done", actions: lib.record("pAfter") } },
                    states: {
                        x: { after: { 10: { target: "y", actions: lib.record("xAfter") } } },
                        y: {},
                    },
                },
                done: {},
            },
        }),
        events: [{ advance: 20 }, { advance: 10 }],
    },
    {
        name: "after self-transition with reenter re-arms the timer (retry loop)",
        config: (lib) => ({
            id: "m",
            context: { tries: 0 },
            initial: "a",
            states: {
                a: {
                    after: {
                        10: [
                            { target: "gaveUp", guard: ({ context }: any) => context.tries >= 3 },
                            {
                                target: "a",
                                reenter: true,
                                actions: [
                                    lib.assign({ tries: ({ context }: any) => context.tries + 1 }),
                                    lib.record("retry"),
                                ],
                            },
                        ],
                    },
                },
                gaveUp: {},
            },
        }),
        events: [{ advance: 10 }, { advance: 25 }, { advance: 100 }],
    },
    {
        name: "tags collected from every active node",
        config: {
            id: "m",
            initial: "p",
            states: {
                p: {
                    tags: ["outer", "shared"],
                    initial: "x",
                    states: {
                        x: { tags: "leafX", on: { NEXT: "y" } },
                        y: { tags: ["leafY", "shared"], on: { LEAVE: "#m.q" } },
                    },
                },
                q: { type: "parallel", tags: "par", states: { r1: { tags: "r1" }, r2: {} } },
            },
        },
        events: [{ type: "NEXT" }, { type: "LEAVE" }],
        probes: { matches: ["p", "q"] },
    },
    {
        name: "entry actions see the triggering event; initial entries see xstate.init",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.record("rootIn", ({ event }) => event.type),
            states: {
                a: { entry: lib.record("aIn", ({ event }) => event.type), on: { GO: "b" } },
                b: {
                    entry: lib.record("bIn", ({ event }) => event),
                    exit: lib.record("bOut", ({ event }) => event.type),
                    on: { BACK: "a" },
                },
            },
        }),
        events: [{ type: "GO", payload: 1 }, { type: "BACK" }],
    },
    {
        name: "a final region that is re-activated: parallel onDone only when all regions are final again",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        a: {
                            initial: "a1",
                            states: {
                                a1: { on: { A: "aFinal" } },
                                aFinal: { type: "final", on: { A_BACK: "a1" } },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: { b1: { on: { B: "bFinal" } }, bFinal: { type: "final" } },
                        },
                    },
                    onDone: { target: "done", actions: lib.record("pDone") },
                },
                done: {},
            },
        }),
        events: [{ type: "A" }, { type: "A_BACK" }, { type: "B" }, { type: "A" }],
    },
    {
        name: "nested compound finals inside a parallel region chain up to the parallel onDone and the root output",
        config: (lib) => ({
            id: "m",
            initial: "p",
            output: ({ event }: any) => ({ cause: event.type, output: event.output }),
            states: {
                p: {
                    type: "parallel",
                    states: {
                        a: {
                            initial: "inner",
                            states: {
                                inner: {
                                    initial: "w",
                                    states: { w: { on: { A: "wf" } }, wf: { type: "final", output: { w: 1 } } },
                                    onDone: {
                                        target: "aFinal",
                                        actions: lib.record("innerDone", ({ event }) => event.output),
                                    },
                                },
                                aFinal: { type: "final", output: { a: 1 } },
                            },
                        },
                        b: { initial: "b1", states: { b1: { on: { B: "bFinal" } }, bFinal: { type: "final" } } },
                    },
                    onDone: { target: "end", actions: lib.record("pDone", ({ event }) => event.output) },
                },
                end: { type: "final", output: ({ event }: any) => ({ end: event.type }) },
            },
        }),
        events: [{ type: "B" }, { type: "A" }],
    },
    {
        name: "parallel root done: machine output from the root output mapper",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            exit: lib.record("rootOut"),
            output: ({ event }: any) => ({ type: event.type, output: event.output }),
            states: {
                a: {
                    initial: "a1",
                    states: { a1: { on: { A: "aFinal" } }, aFinal: { type: "final", output: { a: true } } },
                },
                b: { initial: "b1", states: { b1: { on: { B: "bFinal" } }, bFinal: { type: "final" } } },
            },
        }),
        events: [{ type: "A" }, { type: "B" }, { type: "A" }],
    },
    {
        name: "multiple targets with reenter: true and a history node among the targets",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        a: {
                            initial: "a1",
                            states: {
                                a1: { entry: lib.record("a1In"), on: { NEXT: "a2" } },
                                a2: { entry: lib.record("a2In") },
                                hist: { type: "history" },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: { b1: { entry: lib.record("b1In") }, b2: { entry: lib.record("b2In") } },
                        },
                    },
                    on: {
                        LEAVE: "q",
                        RESTORE_AND_B2: { target: [".a.hist", ".b.b2"], reenter: true, actions: lib.record("multi") },
                    },
                },
                q: { on: { BACK: { target: ["#m.p.a.hist", "#m.p.b.b2"] } } },
            },
        }),
        events: [{ type: "NEXT" }, { type: "LEAVE" }, { type: "BACK" }, { type: "RESTORE_AND_B2" }],
    },
    {
        name: "history restore after an exit caused by an ancestor's after timer",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    after: { 50: "paused" },
                    states: {
                        x: { on: { NEXT: "y" } },
                        y: { entry: lib.record("yIn") },
                        hist: { type: "history" },
                    },
                },
                paused: { on: { RESUME: "#m.p.hist" } },
            },
        }),
        events: [{ type: "NEXT" }, { advance: 50 }, { type: "RESUME" }, { advance: 50 }],
    },
    {
        name: "self-targeting history: transition from inside the parent to its own history node",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        x: { entry: lib.record("xIn"), exit: lib.record("xOut"), on: { NEXT: "y" } },
                        y: { entry: lib.record("yIn"), exit: lib.record("yOut"), on: { SELF_HIST: "#m.p.hist" } },
                        hist: { type: "history", target: "x" },
                    },
                },
            },
        }),
        events: [{ type: "NEXT" }, { type: "SELF_HIST" }],
    },
    {
        name: "transition to a history node whose parent is the ancestor of the source (reenter: true)",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        x: { entry: lib.record("xIn"), exit: lib.record("xOut"), on: { NEXT: "y" } },
                        y: {
                            entry: lib.record("yIn"),
                            exit: lib.record("yOut"),
                            on: { REENTER_HIST: { target: "#m.p.hist", reenter: true } },
                        },
                        hist: { type: "history", target: "x" },
                    },
                },
            },
        }),
        events: [{ type: "NEXT" }, { type: "REENTER_HIST" }],
    },
];

describeScenarios("differential: edge cases", scenarios);
