/**
 * Round 2 differential scenarios: nesting — a parallel state inside a compound
 * state (with shallow / deep history around it), a compound region inside a
 * parallel state with its own history node, and deep `#id.path` targets into
 * parallel regions (from outside, from a sibling region, into a nested
 * parallel two levels down, multiple targets, custom leaf ids).
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "parallel inside a compound with shallow and deep history: shallow re-initializes the regions, deep restores the leaves",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    states: {
                        x: { entry: lib.record("xIn"), on: { GO: "par" } },
                        par: {
                            type: "parallel",
                            entry: lib.record("parIn"),
                            exit: lib.record("parOut"),
                            states: {
                                r1: {
                                    initial: "r1a",
                                    states: {
                                        r1a: { entry: lib.record("r1aIn"), on: { NEXT: "r1b" } },
                                        r1b: { entry: lib.record("r1bIn") },
                                    },
                                },
                                r2: {
                                    initial: "r2a",
                                    states: {
                                        r2a: { entry: lib.record("r2aIn"), on: { NEXT: "r2b" } },
                                        r2b: { entry: lib.record("r2bIn") },
                                    },
                                },
                            },
                        },
                        shallow: { type: "history" },
                        deep: { type: "history", history: "deep" },
                    },
                    on: { PAUSE: "paused" },
                },
                paused: {
                    entry: lib.record("pausedIn"),
                    on: { RESUME_SHALLOW: "#m.p.shallow", RESUME_DEEP: "#m.p.deep" },
                },
            },
        }),
        events: [
            { type: "GO" },
            { type: "NEXT" },
            { type: "PAUSE" },
            { type: "RESUME_SHALLOW" },
            { type: "NEXT" },
            { type: "PAUSE" },
            { type: "RESUME_DEEP" },
        ],
        probes: { matches: [{ p: { par: { r1: "r1b" } } }, { p: "par" }, "paused"] },
    },
    {
        name: "compound region inside a parallel state with its own deep history: a target into the region's history restores only that region",
        config: (lib) => ({
            id: "m",
            initial: "idle",
            states: {
                idle: { on: { ENTER: "par", RESTORE: "#m.par.r1.hist" } },
                par: {
                    type: "parallel",
                    entry: lib.record("parIn"),
                    states: {
                        r1: {
                            initial: "a",
                            entry: lib.record("r1In"),
                            states: {
                                a: { entry: lib.record("aIn"), on: { NEXT: "b" } },
                                b: {
                                    entry: lib.record("bIn"),
                                    initial: "b1",
                                    states: {
                                        b1: { entry: lib.record("b1In"), on: { NEXT: "b2" } },
                                        b2: { entry: lib.record("b2In") },
                                    },
                                },
                                hist: { type: "history", history: "deep" },
                            },
                        },
                        r2: {
                            initial: "x",
                            entry: lib.record("r2In"),
                            states: {
                                x: { entry: lib.record("xIn"), on: { NEXT: "y" } },
                                y: { entry: lib.record("yIn") },
                            },
                        },
                    },
                    on: { LEAVE: "idle" },
                },
            },
        }),
        events: [
            { type: "ENTER" },
            { type: "NEXT" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "RESTORE" },
            { type: "LEAVE" },
            { type: "ENTER" },
        ],
        probes: { matches: [{ par: { r1: { b: "b2" } } }, { par: { r2: "x" } }] },
    },
    {
        name: "history of a compound region is recorded when the parallel parent is exited by an ancestor's transition",
        config: (lib) => ({
            id: "m",
            initial: "outer",
            states: {
                outer: {
                    initial: "par",
                    on: { FREEZE: "frozen" },
                    states: {
                        par: {
                            type: "parallel",
                            states: {
                                r1: {
                                    initial: "a",
                                    states: {
                                        a: { on: { NEXT: "b" } },
                                        b: { entry: lib.record("bIn") },
                                        hist: { type: "history" },
                                    },
                                },
                                r2: {
                                    initial: "x",
                                    states: {
                                        x: { on: { NEXT: "y" } },
                                        y: { entry: lib.record("yIn") },
                                    },
                                },
                            },
                        },
                    },
                },
                frozen: { on: { THAW: "#m.outer.par.r1.hist" } },
            },
        }),
        events: [{ type: "NEXT" }, { type: "FREEZE" }, { type: "THAW" }],
    },
    {
        name: "deep #id.path targets into parallel regions: from outside, into a nested parallel two levels down, by custom leaf id, multiple targets",
        config: (lib) => ({
            id: "m",
            initial: "idle",
            states: {
                idle: {
                    on: {
                        DEEP: "#m.par.r1.inner.i2",
                        NESTED: "#m.par.r2.sub.s2.s2b",
                        BY_ID: "#leafTarget",
                        MULTI: { target: ["#m.par.r2.sub.s1.s1b", "#m.par.r2.sub.s2.s2b"] },
                    },
                },
                par: {
                    type: "parallel",
                    entry: lib.record("parIn"),
                    exit: lib.record("parOut"),
                    states: {
                        r1: {
                            initial: "inner",
                            states: {
                                inner: {
                                    initial: "i1",
                                    entry: lib.record("innerIn"),
                                    states: {
                                        i1: { entry: lib.record("i1In") },
                                        i2: { entry: lib.record("i2In") },
                                    },
                                },
                            },
                        },
                        r2: {
                            initial: "s0",
                            states: {
                                s0: { entry: lib.record("s0In"), on: { INTO_SUB: "#m.par.r2.sub.s1.s1b" } },
                                sub: {
                                    type: "parallel",
                                    entry: lib.record("subIn"),
                                    states: {
                                        s1: {
                                            initial: "s1a",
                                            states: {
                                                s1a: { entry: lib.record("s1aIn") },
                                                s1b: { id: "leafTarget", entry: lib.record("s1bIn") },
                                            },
                                        },
                                        s2: {
                                            initial: "s2a",
                                            states: {
                                                s2a: { entry: lib.record("s2aIn") },
                                                s2b: { entry: lib.record("s2bIn") },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    on: { LEAVE: "idle" },
                },
            },
        }),
        events: [
            { type: "DEEP" },
            { type: "INTO_SUB" },
            { type: "LEAVE" },
            { type: "NESTED" },
            { type: "LEAVE" },
            { type: "BY_ID" },
            { type: "LEAVE" },
            { type: "MULTI" },
        ],
        probes: {
            matches: [{ par: { r1: { inner: "i2" } } }, { par: { r2: { sub: { s1: "s1b" } } } }, { par: { r2: "s0" } }],
        },
    },
    {
        name: "deep target from one region into a nested parallel of a sibling region re-initializes the source region",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            states: {
                r1: {
                    initial: "a",
                    states: {
                        a: { entry: lib.record("aIn"), exit: lib.record("aOut"), on: { CROSS: "#m.r2.sub.s2.s2b" } },
                        b: {},
                    },
                },
                r2: {
                    initial: "s0",
                    entry: lib.record("r2In"),
                    exit: lib.record("r2Out"),
                    states: {
                        s0: { entry: lib.record("s0In"), exit: lib.record("s0Out") },
                        sub: {
                            type: "parallel",
                            entry: lib.record("subIn"),
                            states: {
                                s1: { initial: "s1a", states: { s1a: { entry: lib.record("s1aIn") } } },
                                s2: {
                                    initial: "s2a",
                                    states: {
                                        s2a: { entry: lib.record("s2aIn") },
                                        s2b: { entry: lib.record("s2bIn") },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "CROSS" }],
        probes: { matches: [{ r1: "a" }, { r2: { sub: { s2: "s2b" } } }] },
    },
];

describeScenarios("differential: nesting of parallel and compound states", scenarios);
