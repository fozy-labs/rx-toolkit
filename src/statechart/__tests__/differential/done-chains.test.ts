/**
 * Round 2 differential scenarios: onDone chains — a compound reaching a final
 * child triggers the parent's transition, which may finish the grandparent,
 * and so on within one macrostep; targetless onDone; onDone restarting its own
 * compound; onDone with no enabled candidate; onDone of a region compound.
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "three-level done chain in one macrostep: every onDone sees its own done event and the final child's output",
        config: (lib) => ({
            id: "m",
            initial: "outer",
            states: {
                outer: {
                    initial: "mid",
                    entry: lib.record("outerIn"),
                    exit: lib.record("outerOut"),
                    states: {
                        mid: {
                            initial: "inner",
                            entry: lib.record("midIn"),
                            exit: lib.record("midOut"),
                            states: {
                                inner: {
                                    initial: "w",
                                    entry: lib.record("innerIn"),
                                    exit: lib.record("innerOut"),
                                    states: {
                                        w: { on: { FINISH: "innerDone" } },
                                        innerDone: {
                                            type: "final",
                                            output: ({ event }: any) => ({ from: "inner", via: event.type }),
                                        },
                                    },
                                    onDone: {
                                        target: "midDone",
                                        actions: lib.record("innerOnDone", ({ event }) => [event.type, event.output]),
                                    },
                                },
                                midDone: { type: "final", output: { from: "mid" } },
                            },
                            onDone: {
                                target: "outerDone",
                                actions: lib.record("midOnDone", ({ event }) => [event.type, event.output]),
                            },
                        },
                        outerDone: { type: "final", entry: lib.record("outerDoneIn") },
                    },
                    onDone: {
                        target: "settled",
                        actions: lib.record("outerOnDone", ({ event }) => [event.type, event.output]),
                    },
                },
                settled: { entry: lib.record("settledIn") },
            },
        }),
        events: [{ type: "FINISH" }],
        probes: { matches: ["settled", "outer"] },
    },
    {
        name: "targetless onDone: the compound stays in its final child and keeps handling its own events",
        config: (lib) => ({
            id: "m",
            initial: "p",
            on: { PING: { actions: lib.record("ping") } },
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { entry: lib.record("aIn"), on: { FINISH: "f" } },
                        f: { type: "final", entry: lib.record("fIn"), on: { RESET: "a" } },
                    },
                    onDone: { actions: lib.record("pDone", ({ event }) => event.type) },
                },
            },
        }),
        events: [{ type: "FINISH" }, { type: "PING" }, { type: "RESET" }, { type: "FINISH" }],
        probes: { matches: [{ p: "f" }] },
    },
    {
        name: "onDone targeting a child of the same compound restarts it: only the final child is exited, the parent stays",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { rounds: 0 },
            states: {
                p: {
                    initial: "a",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        a: { entry: lib.record("aIn"), on: { FINISH: "f" } },
                        f: { type: "final", entry: lib.record("fIn"), exit: lib.record("fOut") },
                    },
                    onDone: [
                        {
                            target: "#m.out",
                            guard: ({ context }: any) => context.rounds >= 2,
                            actions: lib.record("leave"),
                        },
                        {
                            target: ".a",
                            actions: [
                                lib.assign({ rounds: ({ context }: any) => context.rounds + 1 }),
                                lib.record("restart", ({ context }) => context.rounds),
                            ],
                        },
                    ],
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ type: "FINISH" }, { type: "FINISH" }, { type: "FINISH" }],
    },
    {
        name: "guarded onDone with no enabled candidate: the done event is dropped; re-entering the compound re-arms it",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { ok: false },
            on: { OK: { actions: lib.assign({ ok: true }) } },
            states: {
                p: {
                    initial: "a",
                    entry: lib.record("pIn"),
                    states: {
                        a: { on: { FINISH: "f" } },
                        f: { type: "final", entry: lib.record("fIn") },
                    },
                    on: { RETRY: { target: "p", reenter: true, actions: lib.record("retry") } },
                    onDone: {
                        target: "out",
                        guard: ({ context }: any) => context.ok,
                        actions: lib.record("pDone"),
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ type: "FINISH" }, { type: "OK" }, { type: "RETRY" }, { type: "FINISH" }],
        probes: { matches: [{ p: "f" }, "out"] },
    },
    {
        name: "onDone of a compound region inside a parallel state fires without finishing the parallel state",
        config: (lib) => ({
            id: "m",
            initial: "par",
            states: {
                par: {
                    type: "parallel",
                    states: {
                        r1: {
                            initial: "a",
                            states: {
                                a: { on: { FINISH: "f" } },
                                f: { type: "final", output: { r1: true } },
                                done: { entry: lib.record("r1DoneIn") },
                            },
                            onDone: { target: ".done", actions: lib.record("r1OnDone", ({ event }) => event.output) },
                        },
                        r2: {
                            initial: "x",
                            states: { x: { on: { PING: { actions: lib.record("xPing") } } } },
                        },
                    },
                    onDone: { target: "end", actions: lib.record("parDone") },
                },
                end: { type: "final" },
            },
        }),
        events: [{ type: "FINISH" }, { type: "PING" }],
        probes: { matches: [{ par: { r1: "done" } }, "end"] },
    },
    {
        name: "onDone actions and a raise in the same list: the raised event is handled after the onDone transition completes",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { FINISH: "f" } },
                        f: { type: "final" },
                    },
                    onDone: {
                        target: "q",
                        actions: [lib.raise({ type: "AFTER_DONE" }), lib.record("pDone")],
                    },
                },
                q: {
                    entry: lib.record("qIn"),
                    on: { AFTER_DONE: { target: "r", actions: lib.record("afterDone") } },
                },
                r: { entry: lib.record("rIn") },
            },
        }),
        events: [{ type: "FINISH" }],
    },
];

describeScenarios("differential: onDone chains", scenarios);
