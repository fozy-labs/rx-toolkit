/**
 * Round 3 (adversarial) differential scenarios: history of parallel states and
 * history restores that bring back final children (re-raising done events).
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "history node directly under a parallel state, targeted from outside: shallow restores nothing but the regions, deep restores the leaves",
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
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { entry: lib.record("b1In"), on: { NEXT: "b2" } },
                                b2: { entry: lib.record("b2In") },
                            },
                        },
                        shallowHist: { type: "history", history: "shallow" },
                        deepHist: { type: "history", history: "deep" },
                    },
                    on: { LEAVE: "away" },
                },
                away: {
                    on: {
                        BACK_SHALLOW: "#m.p.shallowHist",
                        BACK_DEEP: "#m.p.deepHist",
                        BACK_PLAIN: "p",
                    },
                },
            },
        }),
        events: [
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK_DEEP" },
            { type: "LEAVE" },
            { type: "BACK_SHALLOW" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK_DEEP" },
            { type: "LEAVE" },
            { type: "BACK_PLAIN" },
        ],
    },
    {
        name: "history of one region targeted from outside the parallel state: that region is restored, the other starts fresh",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    entry: lib.record("pIn"),
                    states: {
                        a: {
                            initial: "a1",
                            entry: lib.record("aIn"),
                            states: {
                                a1: { entry: lib.record("a1In"), on: { NEXT: "a2" } },
                                a2: { entry: lib.record("a2In"), on: { NEXT: "a3" } },
                                a3: { entry: lib.record("a3In") },
                                aHist: { id: "aHist", type: "history" },
                            },
                        },
                        b: {
                            initial: "b1",
                            entry: lib.record("bIn"),
                            states: {
                                b1: { entry: lib.record("b1In"), on: { NEXT: "b2" } },
                                b2: { entry: lib.record("b2In") },
                            },
                        },
                    },
                    on: { LEAVE: "away" },
                },
                away: { on: { BACK: "#aHist" } },
            },
        }),
        events: [{ type: "NEXT" }, { type: "NEXT" }, { type: "LEAVE" }, { type: "BACK" }, { type: "NEXT" }],
    },
    {
        name: "deep history restoring a final child re-raises the parent's done event (targetless onDone runs again)",
        config: (lib) => ({
            id: "m",
            context: { done: 0 },
            initial: "c",
            states: {
                c: {
                    initial: "c1",
                    states: {
                        c1: { on: { FINISH: "cFinal" } },
                        cFinal: { type: "final", entry: lib.record("cFinalIn"), output: { from: "cFinal" } },
                        hist: { type: "history", history: "deep" },
                    },
                    onDone: {
                        actions: [
                            lib.assign({ done: ({ context }: { context: { done: number } }) => context.done + 1 }),
                            lib.record("cDone", ({ event }) => event),
                        ],
                    },
                    on: { LEAVE: "away" },
                },
                away: { on: { BACK: "#m.c.hist" } },
            },
        }),
        events: [{ type: "FINISH" }, { type: "LEAVE" }, { type: "BACK" }, { type: "LEAVE" }, { type: "BACK" }],
    },
    {
        name: "deep history of a parallel state restores regions in final children: the parallel done event fires again on restore",
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
                            onDone: { actions: lib.record("aDone", ({ event }) => event.type) },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { on: { B_DONE: "bFinal" } },
                                bFinal: { type: "final", entry: lib.record("bFinalIn") },
                            },
                            onDone: { actions: lib.record("bDone", ({ event }) => event.type) },
                        },
                        hist: { type: "history", history: "deep" },
                    },
                    onDone: { actions: lib.record("pDone", ({ event }) => event.type) },
                    on: { LEAVE: "away" },
                },
                away: { on: { BACK: "#m.p.hist" } },
            },
        }),
        events: [
            { type: "A_DONE" },
            { type: "LEAVE" },
            { type: "BACK" },
            { type: "B_DONE" },
            { type: "LEAVE" },
            { type: "BACK" },
        ],
    },
    {
        name: "history default target is a compound: targeted before any exit it enters the compound's initial child; recorded history wins afterwards",
        config: (lib) => ({
            id: "m",
            initial: "c",
            states: {
                c: {
                    initial: "c1",
                    states: {
                        c1: { entry: lib.record("c1In"), on: { NEXT: "c2", TO_HIST: "#m.c.hist" } },
                        c2: {
                            entry: lib.record("c2In"),
                            initial: "c2a",
                            states: {
                                c2a: { entry: lib.record("c2aIn"), on: { NEXT: "c2b" } },
                                c2b: { entry: lib.record("c2bIn") },
                            },
                        },
                        hist: { type: "history", history: "shallow", target: "c2" },
                    },
                    on: { LEAVE: "away" },
                },
                away: { on: { BACK: "#m.c.hist" } },
            },
        }),
        events: [
            { type: "TO_HIST" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK" },
            { type: "LEAVE" },
            { type: "BACK" },
        ],
    },
    {
        name: "history default target is a parallel state: targeted before any exit all regions start fresh; later shallow history restores p (regions fresh), deep history restores the leaves",
        config: (lib) => ({
            id: "m",
            initial: "c",
            states: {
                c: {
                    initial: "plain",
                    states: {
                        plain: {
                            entry: lib.record("plainIn"),
                            on: { TO_HIST: "#m.c.hist", TO_DEEP: "#m.c.deepHist" },
                        },
                        p: {
                            type: "parallel",
                            entry: lib.record("pIn"),
                            states: {
                                a: {
                                    initial: "a1",
                                    states: {
                                        a1: { entry: lib.record("a1In"), on: { NEXT: "a2" } },
                                        a2: { entry: lib.record("a2In") },
                                    },
                                },
                                b: {
                                    initial: "b1",
                                    states: { b1: { entry: lib.record("b1In") } },
                                },
                            },
                        },
                        hist: { type: "history", target: "p" },
                        deepHist: { type: "history", history: "deep", target: "p" },
                        reset: { entry: lib.record("resetIn"), on: { TO_DEEP: "#m.c.deepHist" } },
                    },
                    on: { LEAVE: "away" },
                },
                away: { on: { BACK: "#m.c.hist", BACK_DEEP: "#m.c.deepHist", TO_RESET: "#m.c.reset" } },
            },
        }),
        events: [
            { type: "TO_HIST" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK_DEEP" },
            { type: "LEAVE" },
            { type: "TO_RESET" },
            { type: "TO_DEEP" },
        ],
    },
    {
        name: "shallow and deep history nodes of the same parent are recorded on the same exit and restore differently",
        config: (lib) => ({
            id: "m",
            initial: "c",
            states: {
                c: {
                    initial: "c1",
                    states: {
                        c1: { on: { NEXT: "c2" } },
                        c2: {
                            initial: "c2a",
                            entry: lib.record("c2In"),
                            states: {
                                c2a: { entry: lib.record("c2aIn"), on: { NEXT: "c2b" } },
                                c2b: { entry: lib.record("c2bIn") },
                            },
                        },
                        shallow: { type: "history" },
                        deep: { type: "history", history: "deep" },
                    },
                    on: { LEAVE: "away" },
                },
                away: { on: { BACK_SHALLOW: "#m.c.shallow", BACK_DEEP: "#m.c.deep" } },
            },
        }),
        events: [
            { type: "NEXT" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK_SHALLOW" },
            { type: "LEAVE" },
            { type: "BACK_DEEP" },
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK_DEEP" },
        ],
    },
    {
        name: "history is not recorded when the parent is not exited: a region-internal transition after a restore keeps the old snapshot until the next exit",
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
                                a1: { entry: lib.record("a1In"), on: { NEXT: "a2" } },
                                a2: { entry: lib.record("a2In"), on: { NEXT: "a3" } },
                                a3: { entry: lib.record("a3In") },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    entry: lib.record("b1In"),
                                    on: { RESTORE_A: "#m.p.hist" },
                                },
                            },
                        },
                        hist: { type: "history", history: "deep" },
                    },
                    on: { LEAVE: "away" },
                },
                away: { on: { BACK: "p" } },
            },
        }),
        events: [
            { type: "NEXT" },
            { type: "LEAVE" },
            { type: "BACK" },
            { type: "RESTORE_A" },
            { type: "NEXT" },
            { type: "RESTORE_A" },
        ],
    },
];

describeScenarios("differential: adversarial history", scenarios);
