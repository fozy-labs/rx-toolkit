/**
 * Round 1 differential scenarios: history states — shallow / deep, default
 * targets, restoring after an external exit, history under parallel parents.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "shallow history with a default target: restores the last child, default when never visited",
        config: (lib) => ({
            id: "m",
            initial: "outside",
            states: {
                outside: { on: { ENTER: "p", ENTER_HIST: "#m.p.hist" } },
                p: {
                    initial: "x",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        x: { entry: lib.record("xIn"), on: { NEXT: "y" } },
                        y: { entry: lib.record("yIn"), on: { NEXT: "z" } },
                        z: { entry: lib.record("zIn") },
                        hist: { type: "history", target: "z" },
                    },
                    on: { LEAVE: "outside" },
                },
            },
        }),
        events: [
            { type: "ENTER_HIST" },
            { type: "LEAVE" },
            { type: "ENTER" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "ENTER_HIST" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "ENTER_HIST" },
        ],
    },
    {
        name: "history without a default target falls back to the parent's initial state",
        config: (lib) => ({
            id: "m",
            initial: "outside",
            states: {
                outside: { on: { ENTER_HIST: "#m.p.hist" } },
                p: {
                    initial: "x",
                    states: {
                        x: { entry: lib.record("xIn"), on: { NEXT: "y" } },
                        y: { entry: lib.record("yIn") },
                        hist: { type: "history" },
                    },
                    on: { LEAVE: "outside" },
                },
            },
        }),
        events: [{ type: "ENTER_HIST" }, { type: "NEXT" }, { type: "LEAVE" }, { type: "ENTER_HIST" }],
    },
    {
        name: "shallow vs deep history: shallow re-initializes the nested compound, deep restores its leaf",
        config: (lib) => ({
            id: "m",
            initial: "outside",
            states: {
                outside: {
                    on: { SHALLOW: "#m.p.shallowHist", DEEP: "#m.p.deepHist", ENTER: "p" },
                },
                p: {
                    initial: "x",
                    states: {
                        x: {
                            initial: "x1",
                            entry: lib.record("xIn"),
                            states: {
                                x1: { entry: lib.record("x1In"), on: { NEXT: "x2" } },
                                x2: {
                                    entry: lib.record("x2In"),
                                    initial: "x2a",
                                    states: {
                                        x2a: { entry: lib.record("x2aIn"), on: { NEXT: "x2b" } },
                                        x2b: { entry: lib.record("x2bIn") },
                                    },
                                },
                            },
                            on: { SWITCH: "y" },
                        },
                        y: { entry: lib.record("yIn"), on: { SWITCH: "x" } },
                        shallowHist: { type: "history", history: "shallow" },
                        deepHist: { type: "history", history: "deep" },
                    },
                    on: { LEAVE: "outside" },
                },
            },
        }),
        events: [
            { type: "ENTER" },
            { type: "NEXT" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "SHALLOW" },
            { type: "LEAVE" },
            { type: "DEEP" },
            { type: "NEXT" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "DEEP" },
            { type: "SWITCH" },
            { type: "LEAVE" },
            { type: "DEEP" },
            { type: "LEAVE" },
            { type: "SHALLOW" },
        ],
    },
    {
        name: "history: true is shallow; history node addressed by its own id",
        config: {
            id: "m",
            initial: "outside",
            states: {
                outside: { on: { BACK: "#h" } },
                p: {
                    initial: "x",
                    states: {
                        x: { initial: "x1", states: { x1: { on: { NEXT: "x2" } }, x2: {} }, on: { SWITCH: "y" } },
                        y: {},
                        hist: { id: "h", type: "history", history: true },
                    },
                    on: { LEAVE: "outside" },
                },
            },
        },
        events: [
            { type: "BACK" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK" },
            { type: "SWITCH" },
            { type: "LEAVE" },
            { type: "BACK" },
        ],
    },
    {
        name: "deep history under a parallel parent restores every region",
        config: (lib) => ({
            id: "m",
            initial: "outside",
            states: {
                outside: { on: { RESUME: "#m.p.hist", ENTER: "p" } },
                p: {
                    type: "parallel",
                    entry: lib.record("pIn"),
                    states: {
                        left: {
                            initial: "l1",
                            states: {
                                l1: { entry: lib.record("l1In"), on: { L: "l2" } },
                                l2: { entry: lib.record("l2In") },
                            },
                        },
                        right: {
                            initial: "r1",
                            states: {
                                r1: { entry: lib.record("r1In"), on: { R: "r2" } },
                                r2: {
                                    entry: lib.record("r2In"),
                                    initial: "r2a",
                                    states: {
                                        r2a: { entry: lib.record("r2aIn"), on: { R: "r2b" } },
                                        r2b: { entry: lib.record("r2bIn") },
                                    },
                                },
                            },
                        },
                        hist: { type: "history", history: "deep" },
                    },
                    on: { LEAVE: "outside" },
                },
            },
        }),
        events: [
            { type: "RESUME" },
            { type: "L" },
            { type: "R" },
            { type: "R" },
            { type: "LEAVE" },
            { type: "RESUME" },
        ],
    },
    {
        name: "shallow history under a parallel parent (default: all regions re-initialized)",
        config: {
            id: "m",
            initial: "outside",
            states: {
                outside: { on: { RESUME: "#m.p.hist" } },
                p: {
                    type: "parallel",
                    states: {
                        left: { initial: "l1", states: { l1: { on: { L: "l2" } }, l2: {} } },
                        right: {
                            initial: "r1",
                            states: {
                                r1: { on: { R: "r2" } },
                                r2: { initial: "r2a", states: { r2a: { on: { R: "r2b" } }, r2b: {} } },
                            },
                        },
                        hist: { type: "history" },
                    },
                    on: { LEAVE: "outside" },
                },
            },
        },
        events: [
            { type: "RESUME" },
            { type: "L" },
            { type: "R" },
            { type: "R" },
            { type: "LEAVE" },
            { type: "RESUME" },
        ],
    },
    {
        name: "history recorded on every exit: the most recent configuration wins",
        config: {
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { NEXT: "b" } },
                        b: { on: { NEXT: "c" } },
                        c: { on: { NEXT: "a" } },
                        hist: { type: "history" },
                    },
                    on: { LEAVE: "q" },
                },
                q: { on: { BACK: "#m.p.hist" } },
            },
        },
        events: [
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK" },
            { type: "NEXT" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK" },
        ],
    },
    {
        name: "history target through a transition with actions, entry order of restored states",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        a: { entry: lib.record("aIn"), exit: lib.record("aOut"), on: { NEXT: "b" } },
                        b: {
                            entry: lib.record("bIn"),
                            exit: lib.record("bOut"),
                            initial: "b1",
                            states: {
                                b1: { entry: lib.record("b1In"), exit: lib.record("b1Out"), on: { NEXT: "b2" } },
                                b2: { entry: lib.record("b2In"), exit: lib.record("b2Out") },
                            },
                        },
                        hist: { type: "history", history: "deep" },
                    },
                    on: { LEAVE: "q" },
                },
                q: {
                    entry: lib.record("qIn"),
                    exit: lib.record("qOut"),
                    on: { BACK: { target: "#m.p.hist", actions: lib.record("back") } },
                },
            },
        }),
        events: [{ type: "NEXT" }, { type: "NEXT" }, { type: "LEAVE" }, { type: "BACK" }],
    },
];

describeScenarios("differential: history", scenarios);
