/**
 * Round 3 (adversarial) differential scenarios: zero delays (`after: { 0 }`,
 * `raise(..., { delay: 0 })`), timers due at the same instant across parallel
 * regions (delivery order and cancellation within one tick), key-order of
 * `after` (integer-like keys iterate first), and self-transitions that do or
 * do not re-arm `after` timers depending on `reenter`.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "after 0 vs immediate raise vs external send: raise first (same macrostep), external send next, after 0 only at advance(0)",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: [lib.raise({ type: "IMMEDIATE" }), lib.record("aIn")],
                    after: { 0: { target: "timedOut", actions: lib.record("after0", ({ event }) => event.type) } },
                    on: {
                        IMMEDIATE: { actions: lib.record("immediate") },
                        EXTERNAL: { actions: lib.record("external") },
                    },
                },
                timedOut: { entry: lib.record("timedOutIn") },
            },
        }),
        events: [{ type: "EXTERNAL" }, { advance: 0 }, { type: "EXTERNAL" }],
    },
    {
        name: "raise with delay 0 is asynchronous: not handled in the macrostep, delivered at advance(0), cancellable by id before that",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: [
                        lib.raise({ type: "ZERO", n: 1 }, { delay: 0, id: "zero1" }),
                        lib.raise({ type: "ZERO", n: 2 }, { delay: 0, id: "zero2" }),
                        lib.record("aIn"),
                    ],
                    on: {
                        ZERO: { actions: lib.record("zero", ({ event }) => event) },
                        CANCEL_FIRST: { actions: lib.cancel("zero1") },
                    },
                },
            },
        }),
        events: [{ type: "CANCEL_FIRST" }, { advance: 0 }, { advance: 0 }],
    },
    {
        name: "delayed raise 0 scheduled in entry and after 0 on the same state: entry raise fires first and its transition cancels the after timer",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: lib.raise({ type: "LEAVE" }, { delay: 0 }),
                    after: { 0: { target: "byAfter", actions: lib.record("byAfter") } },
                    on: { LEAVE: { target: "byRaise", actions: lib.record("byRaise") } },
                },
                byRaise: {},
                byAfter: {},
            },
        }),
        events: [{ advance: 0 }, { advance: 0 }],
    },
    {
        name: "after 0 declared before an entry raise 0 still fires second: after raises are appended after the user's entry actions",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { 0: { actions: lib.record("byAfter", ({ event }) => event.type) } },
                    entry: lib.raise({ type: "ENTRY_ZERO" }, { delay: 0 }),
                    on: { ENTRY_ZERO: { actions: lib.record("byRaise") } },
                },
            },
        }),
        events: [{ advance: 0 }],
    },
    {
        name: "equal delays across regions: region order decides delivery; the first region's timer transition leaves p and cancels the second's",
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
                            states: {
                                a1: {
                                    after: {
                                        100: {
                                            target: "#m.out",
                                            actions: lib.record("aFired", ({ event }) => event.type),
                                        },
                                    },
                                },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    after: {
                                        100: { target: "b2", actions: lib.record("bFired", ({ event }) => event.type) },
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
        events: [{ advance: 100 }, { advance: 100 }],
    },
    {
        name: "equal delays across regions: the second region's timer transition leaves p; the first region's internal timer transition ran before",
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
                            states: {
                                a1: { after: { 100: { target: "a2", actions: lib.record("aFired") } } },
                                a2: { entry: lib.record("a2In") },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { after: { 100: { target: "#m.out", actions: lib.record("bFired") } } },
                            },
                        },
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ advance: 100 }],
    },
    {
        name: "equal delays across regions where the first timer re-enters p: the old second timer is cancelled and both are re-armed",
        config: (lib) => ({
            id: "m",
            context: { fired: [] as string[] },
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
                                a1: {
                                    after: {
                                        100: {
                                            target: "#m.p",
                                            reenter: true,
                                            actions: [
                                                lib.assign({
                                                    fired: ({ context }: { context: { fired: string[] } }) => [
                                                        ...context.fired,
                                                        "a",
                                                    ],
                                                }),
                                                lib.record("aFired"),
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    after: {
                                        100: {
                                            target: "b2",
                                            actions: [
                                                lib.assign({
                                                    fired: ({ context }: { context: { fired: string[] } }) => [
                                                        ...context.fired,
                                                        "b",
                                                    ],
                                                }),
                                                lib.record("bFired"),
                                            ],
                                        },
                                    },
                                },
                                b2: { entry: lib.record("b2In") },
                            },
                        },
                    },
                    on: { STOP: "idle" },
                },
                idle: {},
            },
        }),
        events: [{ advance: 100 }, { advance: 50 }, { type: "STOP" }, { advance: 100 }],
    },
    {
        name: "equal delays: the first region's timer finishes the machine (top-level final), the second region's timer never fires",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        a: {
                            initial: "a1",
                            states: { a1: { after: { 50: { target: "#m.end", actions: lib.record("aFired") } } } },
                        },
                        b: {
                            initial: "b1",
                            states: { b1: { after: { 50: { target: "b2", actions: lib.record("bFired") } } }, b2: {} },
                        },
                    },
                },
                end: { type: "final", entry: lib.record("endIn") },
            },
        }),
        events: [{ advance: 50 }, { advance: 50 }],
    },
    {
        name: "after keys: integer-like keys iterate first; numeric-looking strings ('050', '1e2') are coerced to numbers and shadow same-named delays",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: {
                        NAMED: { target: "byNamed", actions: lib.record("byNamed", ({ event }) => event.type) },
                        100: { target: "byNumber", actions: lib.record("byNumber", ({ event }) => event.type) },
                    },
                    on: { RESET: "b" },
                },
                b: {
                    after: {
                        "1e2": { target: "byExponent", actions: lib.record("byExponent", ({ event }) => event.type) },
                        "050": { target: "byPaddedString", actions: lib.record("byPadded", ({ event }) => event.type) },
                    },
                },
                c: {
                    after: {
                        "1e2": { target: "byExponent", actions: lib.record("byExponent", ({ event }) => event.type) },
                    },
                },
                byNamed: { on: { RESET: "b" } },
                byNumber: { on: { RESET: "b" } },
                byExponent: {},
                byPaddedString: { on: { RESET: "c" } },
            },
        }),
        implementations: () => ({ delays: { NAMED: 100, "050": 500, "1e2": 5 } }),
        events: [
            { advance: 100 },
            { type: "RESET" },
            { advance: 5 },
            { advance: 45 },
            { type: "RESET" },
            { advance: 5 },
            { advance: 95 },
        ],
    },
    {
        name: "after self-transition without reenter on an atomic state fires once and is not re-armed",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: lib.record("aIn"),
                    exit: lib.record("aOut"),
                    after: { 100: { target: "a", actions: lib.record("tick") } },
                },
            },
        }),
        events: [{ advance: 100 }, { advance: 100 }, { advance: 100 }],
    },
    {
        name: "compound self-transition without reenter: the child's after is re-armed (child re-entered), the parent's after keeps its original schedule",
        config: (lib) => ({
            id: "m",
            initial: "parent",
            states: {
                parent: {
                    entry: lib.record("parentIn"),
                    exit: lib.record("parentOut"),
                    initial: "child",
                    after: { 150: { target: "parentTimedOut", actions: lib.record("parentTimer") } },
                    on: {
                        SELF: { target: "parent", actions: lib.record("self") },
                        SELF_REENTER: { target: "parent", reenter: true, actions: lib.record("selfReenter") },
                    },
                    states: {
                        child: {
                            entry: lib.record("childIn"),
                            exit: lib.record("childOut"),
                            after: { 100: { target: "childTimedOut", actions: lib.record("childTimer") } },
                        },
                        childTimedOut: { entry: lib.record("childTimedOutIn") },
                    },
                },
                parentTimedOut: { entry: lib.record("parentTimedOutIn") },
            },
        }),
        events: [{ advance: 60 }, { type: "SELF" }, { advance: 60 }, { advance: 40 }, { advance: 100 }],
    },
    {
        name: "compound self-transition with reenter: both after timers restart from zero",
        config: (lib) => ({
            id: "m",
            initial: "parent",
            states: {
                parent: {
                    entry: lib.record("parentIn"),
                    exit: lib.record("parentOut"),
                    initial: "child",
                    after: { 150: { target: "parentTimedOut", actions: lib.record("parentTimer") } },
                    on: { SELF_REENTER: { target: "parent", reenter: true, actions: lib.record("selfReenter") } },
                    states: {
                        child: {
                            entry: lib.record("childIn"),
                            exit: lib.record("childOut"),
                            after: { 100: { target: "childTimedOut", actions: lib.record("childTimer") } },
                        },
                        childTimedOut: {},
                    },
                },
                parentTimedOut: { entry: lib.record("parentTimedOutIn") },
            },
        }),
        events: [{ advance: 60 }, { type: "SELF_REENTER" }, { advance: 100 }, { advance: 50 }],
    },
    {
        name: "parent's after transition to its own child (no reenter): the parent timer is not re-armed, the child's is",
        config: (lib) => ({
            id: "m",
            initial: "parent",
            states: {
                parent: {
                    entry: lib.record("parentIn"),
                    exit: lib.record("parentOut"),
                    initial: "child",
                    after: { 100: { target: ".child", actions: lib.record("parentTimer") } },
                    states: {
                        child: {
                            entry: lib.record("childIn"),
                            exit: lib.record("childOut"),
                            after: { 70: { target: "other", actions: lib.record("childTimer") } },
                        },
                        other: { entry: lib.record("otherIn") },
                    },
                },
            },
        }),
        events: [{ advance: 70 }, { advance: 30 }, { advance: 70 }, { advance: 100 }],
    },
    {
        name: "delayed raise 0 survives a synchronous state change and a timer of 0 in the new state is delivered after it",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: lib.raise({ type: "LATE" }, { delay: 0 }),
                    on: { GO: "b", LATE: { actions: lib.record("lateInA") } },
                },
                b: {
                    entry: lib.record("bIn"),
                    after: { 0: { target: "c", actions: lib.record("bAfter0") } },
                    on: { LATE: { actions: lib.record("lateInB") } },
                },
                c: { on: { LATE: { actions: lib.record("lateInC") } } },
            },
        }),
        events: [{ type: "GO" }, { advance: 0 }],
    },
    {
        name: "delay expression evaluated once at entry: a later context change does not reschedule the timer",
        config: (lib) => ({
            id: "m",
            context: { ms: 100 },
            initial: "a",
            states: {
                a: {
                    after: { DYNAMIC: { target: "b", actions: lib.record("fired") } },
                    on: { SHORTEN: { actions: lib.assign({ ms: 10 }) } },
                },
                b: {},
            },
        }),
        implementations: () => ({ delays: { DYNAMIC: ({ context }: { context: { ms: number } }) => context.ms } }),
        events: [{ type: "SHORTEN" }, { advance: 10 }, { advance: 90 }],
    },
];

describeScenarios("differential: adversarial timers", scenarios);
