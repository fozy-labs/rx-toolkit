/**
 * Round 1 differential scenarios: parallel states — value shape, events
 * handled by several regions, multiple targets, `onDone`, nested parallel,
 * cross-region guards.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "parallel value shape: atomic regions, compound regions, entry order on entering the parallel state",
        config: (lib) => ({
            id: "m",
            initial: "idle",
            states: {
                idle: { on: { START: "p" } },
                p: {
                    type: "parallel",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        atomicRegion: { entry: lib.record("atomicIn"), exit: lib.record("atomicOut") },
                        compoundRegion: {
                            initial: "c1",
                            entry: lib.record("compoundIn"),
                            exit: lib.record("compoundOut"),
                            states: {
                                c1: { entry: lib.record("c1In"), exit: lib.record("c1Out"), on: { NEXT: "c2" } },
                                c2: { entry: lib.record("c2In"), exit: lib.record("c2Out") },
                            },
                        },
                        deepRegion: {
                            initial: "d1",
                            states: {
                                d1: { initial: "d1a", states: { d1a: { on: { NEXT: "d1b" } }, d1b: {} } },
                            },
                        },
                    },
                    on: { STOP: "idle" },
                },
            },
        }),
        events: [{ type: "START" }, { type: "NEXT" }, { type: "STOP" }],
    },
    {
        name: "one event handled by several regions at once; a region without a matching transition stays",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            states: {
                a: {
                    initial: "a1",
                    states: {
                        a1: { on: { TICK: { target: "a2", actions: lib.record("aTick") } } },
                        a2: { on: { TICK: { target: "a1", actions: lib.record("aTickBack") } } },
                    },
                },
                b: {
                    initial: "b1",
                    states: {
                        b1: { on: { TICK: { target: "b2", actions: lib.record("bTick") } } },
                        b2: {},
                    },
                },
                c: {
                    initial: "c1",
                    states: { c1: { on: { OTHER: "c2" } }, c2: {} },
                },
            },
        }),
        events: [{ type: "TICK" }, { type: "TICK" }, { type: "OTHER" }],
    },
    {
        name: "multiple targets into different regions of one parallel state",
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
                                a1: { entry: lib.record("a1In"), exit: lib.record("a1Out") },
                                a2: { entry: lib.record("a2In"), exit: lib.record("a2Out") },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { entry: lib.record("b1In"), exit: lib.record("b1Out") },
                                b2: { entry: lib.record("b2In"), exit: lib.record("b2Out") },
                            },
                        },
                    },
                    on: {
                        BOTH: { target: [".a.a2", ".b.b2"], actions: lib.record("both") },
                        RESET: { target: ["#m.p.a.a1", "#m.p.b.b1"] },
                        ONLY_A: { target: ".a.a2" },
                    },
                },
            },
        }),
        events: [{ type: "BOTH" }, { type: "RESET" }, { type: "ONLY_A" }, { type: "BOTH" }],
    },
    {
        name: "onDone of a parallel state fires when every region is in a final child",
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
                                a1: { on: { A_DONE: "aFinal" } },
                                aFinal: { type: "final", entry: lib.record("aFinalIn") },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { on: { B_DONE: "bFinal" } },
                                bFinal: { type: "final", entry: lib.record("bFinalIn") },
                            },
                        },
                    },
                    onDone: { target: "finished", actions: lib.record("pDone", ({ event }) => event) },
                },
                finished: { entry: lib.record("finishedIn") },
            },
        }),
        events: [{ type: "A_DONE" }, { type: "B_DONE" }],
    },
    {
        name: "onDone of a parallel state with a region that starts in a final state",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        a: { initial: "aFinal", states: { aFinal: { type: "final" } } },
                        b: {
                            initial: "b1",
                            states: { b1: { on: { B_DONE: "bFinal" } }, bFinal: { type: "final" } },
                        },
                    },
                    onDone: { target: "finished", actions: lib.record("pDone", ({ event }) => event.type) },
                },
                finished: {},
            },
        }),
        events: [{ type: "B_DONE" }],
    },
    {
        name: "leaving a parallel state: exit order of regions and their leaves",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    exit: lib.record("pOut"),
                    states: {
                        a: {
                            initial: "a1",
                            exit: lib.record("aOut"),
                            states: {
                                a1: {
                                    exit: lib.record("a1Out"),
                                    initial: "a1x",
                                    states: { a1x: { exit: lib.record("a1xOut") } },
                                },
                            },
                        },
                        b: { initial: "b1", exit: lib.record("bOut"), states: { b1: { exit: lib.record("b1Out") } } },
                    },
                    on: { LEAVE: { target: "q", actions: lib.record("leave") } },
                },
                q: { entry: lib.record("qIn") },
            },
        }),
        events: [{ type: "LEAVE" }],
    },
    {
        name: "nested parallel states inside a region",
        config: {
            id: "m",
            type: "parallel",
            states: {
                outer: {
                    initial: "o1",
                    states: {
                        o1: {
                            type: "parallel",
                            states: {
                                i1: { initial: "x", states: { x: { on: { GO: "y" } }, y: {} } },
                                i2: { initial: "x", states: { x: { on: { GO: "y" } }, y: {} } },
                            },
                            on: { UP: "o2" },
                        },
                        o2: {},
                    },
                },
                side: { initial: "s1", states: { s1: { on: { GO: "s2" } }, s2: {} } },
            },
        },
        events: [{ type: "GO" }, { type: "UP" }],
    },
    {
        name: "region transition takes priority over the parallel state's own transition for the same event",
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
                                a1: { on: { EV: { target: "a2", actions: lib.record("aHandles") } } },
                                a2: {},
                            },
                        },
                        b: { initial: "b1", states: { b1: {}, b2: {} } },
                    },
                    on: { EV: { target: "out", actions: lib.record("pHandles") } },
                },
                out: {},
            },
        }),
        events: [{ type: "EV" }, { type: "EV" }],
    },
    {
        name: "cross-region always with stateIn: a region reacts to another region's state change",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            states: {
                a: {
                    initial: "a1",
                    states: { a1: { on: { GO: "a2" } }, a2: { on: { BACK: "a1" } } },
                },
                b: {
                    initial: "b1",
                    states: {
                        b1: {
                            always: { target: "b2", guard: lib.stateIn("#m.a.a2"), actions: lib.record("bFollows") },
                        },
                        b2: { always: { target: "b1", guard: lib.not(lib.stateIn({ a: "a2" })) } },
                    },
                },
            },
        }),
        events: [{ type: "GO" }, { type: "BACK" }],
    },
    {
        name: "transition from one region into a sibling region's state is an external transition of the parallel parent",
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
                            entry: lib.record("aIn"),
                            exit: lib.record("aOut"),
                            states: {
                                a1: { entry: lib.record("a1In"), exit: lib.record("a1Out"), on: { JUMP: "#m.p.b.b2" } },
                            },
                        },
                        b: {
                            initial: "b1",
                            entry: lib.record("bIn"),
                            exit: lib.record("bOut"),
                            states: {
                                b1: { entry: lib.record("b1In"), exit: lib.record("b1Out") },
                                b2: { entry: lib.record("b2In"), exit: lib.record("b2Out") },
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "JUMP" }],
    },
    {
        name: "parallel root: value and regions handling their own events",
        config: {
            id: "m",
            type: "parallel",
            states: {
                a: { initial: "a1", states: { a1: { on: { A: "a2" } }, a2: {} } },
                b: { initial: "b1", states: { b1: { on: { B: "b2" } }, b2: {} } },
            },
        },
        events: [{ type: "A" }, { type: "B" }],
    },
];

describeScenarios("differential: parallel", scenarios);
