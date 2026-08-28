/**
 * Round 2 differential scenarios: transitions defined on final states —
 * `always` / `after` / `on` on a nested final child, self re-entry of a final
 * child, leaving a final child across the compound boundary, and the dead
 * transitions of a top-level final state.
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "final child with an enabled always leaves immediately, yet the parent's onDone still fires from the queued done event",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { entry: lib.record("aIn"), on: { FINISH: "f" } },
                        f: {
                            type: "final",
                            entry: lib.record("fIn"),
                            exit: lib.record("fOut"),
                            always: { target: "a", actions: lib.record("fAlways") },
                        },
                    },
                    onDone: { target: "done", actions: lib.record("pDone", ({ event }) => event.type) },
                },
                done: { entry: lib.record("doneIn") },
            },
        }),
        events: [{ type: "FINISH" }],
        probes: { matches: ["p", "done", { p: "a" }] },
    },
    {
        name: "final child with an after transition: the timer fires while the parent's onDone is disabled and is cancelled once onDone leaves",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { allowDone: false },
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: {
                            on: { FINISH: "f", ALLOW: { actions: lib.assign({ allowDone: true }) } },
                        },
                        f: {
                            type: "final",
                            after: { 10: { target: "a", actions: lib.record("fAfter") } },
                        },
                    },
                    onDone: {
                        target: "done",
                        guard: ({ context }: any) => context.allowDone,
                        actions: lib.record("pDone"),
                    },
                },
                done: {},
            },
        }),
        events: [{ type: "FINISH" }, { advance: 10 }, { type: "ALLOW" }, { type: "FINISH" }, { advance: 10 }],
    },
    {
        name: "self-transition on a final child: reenter: true re-queues the parent's done event, a plain self-target does not",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { hits: 0 },
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { FINISH: "f" } },
                        f: {
                            type: "final",
                            entry: [
                                lib.assign({ hits: ({ context }: any) => context.hits + 1 }),
                                lib.record("fIn", ({ context }) => context.hits),
                            ],
                            exit: lib.record("fOut"),
                            on: {
                                AGAIN: { target: "f", reenter: true, actions: lib.record("again") },
                                SAME: { target: "f", actions: lib.record("same") },
                            },
                        },
                    },
                    onDone: {
                        target: "done",
                        guard: ({ context }: any) => context.hits >= 2,
                        actions: lib.record("pDone"),
                    },
                },
                done: {},
            },
        }),
        events: [{ type: "FINISH" }, { type: "SAME" }, { type: "AGAIN" }],
    },
    {
        name: "transition out of a final child across the compound boundary: parent exit runs, re-entering the parent starts fresh and re-arms onDone",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    states: {
                        a: { entry: lib.record("aIn"), on: { FINISH: "f" } },
                        f: {
                            type: "final",
                            entry: lib.record("fIn"),
                            exit: lib.record("fOut"),
                            on: { OUT: "#m.q" },
                        },
                    },
                    onDone: { actions: lib.record("pDone") },
                },
                q: { entry: lib.record("qIn"), on: { BACK: "p" } },
            },
        }),
        events: [{ type: "FINISH" }, { type: "OUT" }, { type: "BACK" }, { type: "FINISH" }],
        probes: { matches: [{ p: "f" }, "q"] },
    },
    {
        name: "a final child's guarded transition array falls through to a candidate that leaves the final state",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { retry: false },
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { FINISH: "f", ALLOW_RETRY: { actions: lib.assign({ retry: true }) } } },
                        f: {
                            type: "final",
                            on: {
                                RETRY: [
                                    {
                                        target: "a",
                                        guard: ({ context }: any) => context.retry,
                                        actions: lib.record("retried"),
                                    },
                                    { actions: lib.record("retryDenied") },
                                ],
                                ALLOW_RETRY: { actions: lib.assign({ retry: true }) },
                            },
                        },
                    },
                    onDone: { actions: lib.record("pDone") },
                },
            },
        }),
        events: [{ type: "FINISH" }, { type: "RETRY" }, { type: "ALLOW_RETRY" }, { type: "RETRY" }, { type: "FINISH" }],
    },
    {
        name: "on / after transitions of a top-level final state never fire: the machine is done",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { FINISH: "f" } },
                f: {
                    type: "final",
                    entry: lib.record("fIn"),
                    exit: lib.record("fOut"),
                    on: { BACK: { target: "a", actions: lib.record("back") } },
                    after: { 10: { target: "a", actions: lib.record("fAfter") } },
                },
            },
        }),
        events: [{ type: "FINISH" }, { type: "BACK" }, { advance: 10 }],
        probes: { matches: ["a", "f"] },
    },
];

describeScenarios("differential: transitions on final states", scenarios);
