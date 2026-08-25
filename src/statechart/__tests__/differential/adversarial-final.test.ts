/**
 * Round 3 (adversarial) differential scenarios: nested final states in
 * parallel regions where one region finishes first, both regions finishing in
 * one microstep, done events carried through history, and the exact shape of
 * done events (`output` key present with `undefined`).
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "one region finishes first: its own done event fires, the parallel done waits for the other region (finished by a timer)",
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
                                aFinal: { type: "final", output: { region: "a" }, entry: lib.record("aFinalIn") },
                            },
                            onDone: { actions: lib.record("aDone", ({ event }) => event) },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { after: { 100: "bFinal" }, on: { A_DONE: { actions: lib.record("bSawADone") } } },
                                bFinal: { type: "final", output: { region: "b" }, entry: lib.record("bFinalIn") },
                            },
                            onDone: { actions: lib.record("bDone", ({ event }) => event) },
                        },
                    },
                    onDone: {
                        target: "finished",
                        actions: lib.record("pDone", ({ event }) => ({
                            ...event,
                            hasOutputKey: "output" in event,
                        })),
                    },
                },
                finished: { type: "final", output: ({ event }: { event: unknown }) => event },
            },
        }),
        events: [{ type: "A_DONE" }, { advance: 99 }, { advance: 1 }],
    },
    {
        name: "both regions reach final in one microstep via multiple targets: each region's done event and one parallel done event, in order",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        a: {
                            initial: "a1",
                            states: { a1: {}, aFinal: { type: "final", entry: lib.record("aFinalIn") } },
                            onDone: { actions: lib.record("aDone", ({ event }) => event.type) },
                        },
                        b: {
                            initial: "b1",
                            states: { b1: {}, bFinal: { type: "final", entry: lib.record("bFinalIn") } },
                            onDone: { actions: lib.record("bDone", ({ event }) => event.type) },
                        },
                    },
                    on: { FINISH_ALL: { target: [".a.aFinal", ".b.bFinal"], actions: lib.record("finishAll") } },
                    onDone: { target: "finished", actions: lib.record("pDone", ({ event }) => event.type) },
                },
                finished: { entry: lib.record("finishedIn") },
            },
        }),
        events: [{ type: "FINISH_ALL" }],
    },
    {
        name: "region finished first, then the finished region is re-entered via a p-level transition while the other finishes: parallel done only when both are final again",
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
                                aFinal: { type: "final" },
                            },
                            onDone: { actions: lib.record("aDone") },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { on: { B_DONE: "bFinal" } },
                                bFinal: { type: "final" },
                            },
                            onDone: { actions: lib.record("bDone") },
                        },
                    },
                    on: { REOPEN_A: { target: ".a.a1", actions: lib.record("reopenA") } },
                    onDone: { actions: lib.record("pDone") },
                },
            },
        }),
        events: [{ type: "A_DONE" }, { type: "REOPEN_A" }, { type: "B_DONE" }, { type: "A_DONE" }],
    },
    {
        name: "parallel state whose regions all start in final states: the region done events and the parallel done fire at initialization",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    entry: lib.record("pIn"),
                    states: {
                        a: {
                            initial: "aFinal",
                            entry: lib.record("aIn"),
                            states: { aFinal: { type: "final", entry: lib.record("aFinalIn"), output: { a: 1 } } },
                            onDone: { actions: lib.record("aDone", ({ event }) => event) },
                        },
                        b: {
                            initial: "bFinal",
                            entry: lib.record("bIn"),
                            states: { bFinal: { type: "final", entry: lib.record("bFinalIn") } },
                            onDone: { actions: lib.record("bDone", ({ event }) => event) },
                        },
                    },
                    onDone: { target: "next", actions: lib.record("pDone", ({ event }) => event) },
                },
                next: { entry: lib.record("nextIn") },
            },
        }),
        events: [{ type: "NOOP" }],
    },
    {
        name: "nested parallel inside a region: the inner parallel completes first, then the outer one; done events bubble in order",
        config: (lib) => ({
            id: "m",
            initial: "outer",
            states: {
                outer: {
                    type: "parallel",
                    states: {
                        x: {
                            initial: "inner",
                            states: {
                                inner: {
                                    type: "parallel",
                                    states: {
                                        i1: {
                                            initial: "w",
                                            states: { w: { on: { I1: "f" } }, f: { type: "final" } },
                                        },
                                        i2: {
                                            initial: "w",
                                            states: { w: { on: { I2: "f" } }, f: { type: "final" } },
                                        },
                                    },
                                    onDone: {
                                        target: "xFinal",
                                        actions: lib.record("innerDone", ({ event }) => event.type),
                                    },
                                },
                                xFinal: { type: "final", entry: lib.record("xFinalIn") },
                            },
                            onDone: { actions: lib.record("xDone", ({ event }) => event.type) },
                        },
                        y: {
                            initial: "w",
                            states: { w: { on: { Y: "f" } }, f: { type: "final", entry: lib.record("yFinalIn") } },
                        },
                    },
                    onDone: { target: "end", actions: lib.record("outerDone", ({ event }) => event.type) },
                },
                end: { type: "final", entry: lib.record("endIn") },
            },
        }),
        events: [{ type: "I1" }, { type: "Y" }, { type: "I2" }],
    },
    {
        name: "spoofed done event sent from outside is treated like any other event: onDone fires without any final state",
        config: (lib) => ({
            id: "m",
            initial: "c",
            states: {
                c: {
                    initial: "c1",
                    states: { c1: { entry: lib.record("c1In") }, cFinal: { type: "final" } },
                    onDone: { target: "next", actions: lib.record("cDone", ({ event }) => event) },
                },
                next: { entry: lib.record("nextIn") },
            },
        }),
        events: [{ type: "xstate.done.state.m.c", output: { spoofed: true } }],
    },
    {
        name: "a final child with an exit action inside a region: leaving p after the region finished runs the final child's exit",
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
                                aFinal: { type: "final", entry: lib.record("aFinalIn"), exit: lib.record("aFinalOut") },
                            },
                        },
                        b: { initial: "b1", states: { b1: { exit: lib.record("b1Out") } } },
                    },
                    on: { LEAVE: "out" },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ type: "A_DONE" }, { type: "LEAVE" }],
    },
    {
        name: "top-level final reached from inside a parallel state: exit actions of every active node run deepest-first, machine output uses the final's output",
        config: (lib) => ({
            id: "m",
            initial: "p",
            output: ({ event }: { event: { output: unknown } }) => ({ wrapped: event.output }),
            states: {
                p: {
                    type: "parallel",
                    exit: lib.record("pOut"),
                    states: {
                        a: {
                            initial: "a1",
                            exit: lib.record("aOut"),
                            states: { a1: { exit: lib.record("a1Out"), on: { END: "#m.end" } } },
                        },
                        b: {
                            initial: "b1",
                            exit: lib.record("bOut"),
                            states: {
                                b1: {
                                    exit: lib.record("b1Out"),
                                    initial: "deep",
                                    states: { deep: { exit: lib.record("deepOut") } },
                                },
                            },
                        },
                    },
                },
                end: { type: "final", entry: lib.record("endIn"), exit: lib.record("endOut"), output: { ok: true } },
            },
        }),
        events: [{ type: "END" }],
    },
];

describeScenarios("differential: adversarial final", scenarios);
