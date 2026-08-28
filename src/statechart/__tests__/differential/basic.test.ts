/**
 * Round 1 differential scenarios: atomic / compound states, initial state
 * resolution, target forms, self-transitions, reenter and the
 * exit → transition → entry action order.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "atomic states: sibling targets, unhandled events are no-ops",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: "b" } },
                b: { on: { GO: "c", BACK: "a" } },
                c: {},
            },
        },
        events: [{ type: "GO" }, { type: "NOPE" }, { type: "BACK" }, { type: "GO" }, { type: "GO" }, { type: "GO" }],
    },
    {
        name: "compound: nested initial resolution and entry order root → parent → child",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.record("rootIn"),
            states: {
                a: {
                    entry: lib.record("aIn"),
                    exit: lib.record("aOut"),
                    initial: "a1",
                    states: {
                        a1: {
                            entry: lib.record("a1In"),
                            exit: lib.record("a1Out"),
                            initial: "a1x",
                            states: {
                                a1x: { entry: lib.record("a1xIn"), exit: lib.record("a1xOut"), on: { NEXT: "a1y" } },
                                a1y: { entry: lib.record("a1yIn"), exit: lib.record("a1yOut") },
                            },
                            on: { UP: "a2" },
                        },
                        a2: { entry: lib.record("a2In"), exit: lib.record("a2Out") },
                    },
                    on: { LEAVE: "b" },
                },
                b: { entry: lib.record("bIn"), exit: lib.record("bOut"), on: { BACK: "a" } },
            },
        }),
        events: [{ type: "NEXT" }, { type: "UP" }, { type: "LEAVE" }, { type: "BACK" }],
    },
    {
        name: "targets: sibling, #id, #id.child.path, .child (relative to the source)",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: {
                    initial: "a1",
                    states: {
                        a1: { on: { TO_B_BY_ID: "#bee", TO_B2: "#bee.b2", TO_A2: "a2" } },
                        a2: { on: { TO_A1: "a1" } },
                    },
                    on: { DOT_A2: ".a2", DOT_A1: ".a1" },
                },
                b: {
                    id: "bee",
                    initial: "b1",
                    states: {
                        b1: { on: { TO_A_LEAF: "#m.a.a2" } },
                        b2: { on: { TO_A: "#m.a" } },
                    },
                    on: { SIB: "a" },
                },
            },
        },
        events: [
            { type: "TO_A2" },
            { type: "TO_A1" },
            { type: "DOT_A2" },
            { type: "DOT_A1" },
            { type: "TO_B_BY_ID" },
            { type: "TO_A_LEAF" },
            { type: "TO_A1" },
            { type: "TO_B2" },
            { type: "TO_A" },
            { type: "TO_B_BY_ID" },
            { type: "SIB" },
        ],
    },
    {
        name: "action order: exit (deepest first) → transition → entry (outermost first) across levels",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: [lib.record("aIn1"), lib.record("aIn2")],
                    exit: [lib.record("aOut1"), lib.record("aOut2")],
                    initial: "a1",
                    states: {
                        a1: {
                            entry: lib.record("a1In"),
                            exit: lib.record("a1Out"),
                            on: { CROSS: { target: "#m.b.b1.b1x", actions: [lib.record("t1"), lib.record("t2")] } },
                        },
                    },
                },
                b: {
                    entry: lib.record("bIn"),
                    exit: lib.record("bOut"),
                    initial: "b1",
                    states: {
                        b1: {
                            entry: lib.record("b1In"),
                            exit: lib.record("b1Out"),
                            initial: "b1x",
                            states: {
                                b1x: {
                                    entry: lib.record("b1xIn"),
                                    exit: lib.record("b1xOut"),
                                    on: { BACK: { target: "#m.a", actions: lib.record("back") } },
                                },
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "CROSS" }, { type: "BACK" }],
    },
    {
        name: "self-transitions: external target = self re-enters, targetless stays (no exit/entry)",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: lib.record("aIn"),
                    exit: lib.record("aOut"),
                    initial: "a1",
                    states: {
                        a1: { entry: lib.record("a1In"), exit: lib.record("a1Out"), on: { NEXT: "a2" } },
                        a2: { entry: lib.record("a2In"), exit: lib.record("a2Out") },
                    },
                    on: {
                        SELF: { target: "a", actions: lib.record("self") },
                        INTERNAL: { actions: lib.record("internal") },
                        SELF_REENTER: { target: "a", reenter: true, actions: lib.record("selfReenter") },
                    },
                },
            },
        }),
        events: [{ type: "NEXT" }, { type: "INTERNAL" }, { type: "SELF" }, { type: "NEXT" }, { type: "SELF_REENTER" }],
    },
    {
        name: "reenter: false keeps the parent when targeting a descendant, reenter: true exits and re-enters it",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    initial: "x",
                    states: {
                        x: { entry: lib.record("xIn"), exit: lib.record("xOut") },
                        y: { entry: lib.record("yIn"), exit: lib.record("yOut") },
                    },
                    on: {
                        TO_Y: { target: ".y", actions: lib.record("toY") },
                        TO_Y_REENTER: { target: ".y", reenter: true, actions: lib.record("toYReenter") },
                        TO_X: { target: ".x" },
                        TO_X_REENTER: { target: ".x", reenter: true },
                    },
                },
            },
        }),
        events: [
            { type: "TO_Y" },
            { type: "TO_Y" },
            { type: "TO_Y_REENTER" },
            { type: "TO_X" },
            { type: "TO_X_REENTER" },
        ],
    },
    {
        name: "root reenter transition: root exit / entry actions run",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.record("rootIn"),
            exit: lib.record("rootOut"),
            on: {
                RESET: { target: ".a", reenter: true, actions: lib.record("reset") },
                SOFT_RESET: { target: ".a", actions: lib.record("softReset") },
            },
            states: {
                a: { entry: lib.record("aIn"), exit: lib.record("aOut"), on: { GO: "b" } },
                b: { entry: lib.record("bIn"), exit: lib.record("bOut") },
            },
        }),
        events: [{ type: "GO" }, { type: "RESET" }, { type: "GO" }, { type: "SOFT_RESET" }, { type: "SOFT_RESET" }],
    },
    {
        name: "transitions to an ancestor and from an ancestor: child transitions shadow parent transitions",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: lib.record("aIn"),
                    exit: lib.record("aOut"),
                    initial: "a1",
                    states: {
                        a1: {
                            entry: lib.record("a1In"),
                            exit: lib.record("a1Out"),
                            on: { EV: { target: "a2", actions: lib.record("childHandled") }, TO_PARENT: "#m.a" },
                        },
                        a2: { entry: lib.record("a2In"), exit: lib.record("a2Out") },
                    },
                    on: { EV: { target: "b", actions: lib.record("parentHandled") } },
                },
                b: { entry: lib.record("bIn"), on: { BACK: "a" } },
            },
        }),
        events: [{ type: "EV" }, { type: "EV" }, { type: "BACK" }, { type: "TO_PARENT" }, { type: "EV" }],
    },
    {
        name: "context: object context and factory context are visible from the initial snapshot",
        config: (lib) => ({
            id: "m",
            context: { count: 1, list: ["x"] },
            initial: "a",
            entry: lib.record("init", ({ context }) => context),
            states: { a: {} },
        }),
        events: [],
    },
    {
        name: "context: factory",
        config: (lib) => ({
            id: "m",
            context: () => ({ created: true }),
            initial: "a",
            entry: lib.record("init", ({ context }) => context),
            states: { a: {} },
        }),
        events: [],
    },
    {
        name: "state node types: explicit atomic / compound and the value shape with nested compound states",
        config: {
            id: "m",
            type: "compound",
            initial: "a",
            states: {
                a: { type: "atomic", on: { GO: "b" } },
                b: {
                    type: "compound",
                    initial: "b1",
                    states: {
                        b1: { initial: "deep", states: { deep: { on: { GO: "#m.b.b2" } } } },
                        b2: { on: { GO: "#m.a" } },
                    },
                },
            },
        },
        events: [{ type: "GO" }, { type: "GO" }, { type: "GO" }],
    },
    {
        name: "actions: named, { type, params } with static and dynamic params, inline functions in one list",
        config: (lib) => ({
            id: "m",
            context: { n: 2 },
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            target: "b",
                            actions: [
                                "plain",
                                { type: "withParams", params: { by: 3 } },
                                {
                                    type: "withParams",
                                    params: ({ context, event }: any) => ({ by: context.n + event.extra }),
                                },
                                lib.record("inline", ({ event }) => event.type),
                            ],
                        },
                    },
                },
                b: {},
            },
        }),
        implementations: (lib) => ({
            actions: {
                plain: lib.record("plain"),
                withParams: lib.record("withParams", (_args, params) => params),
            },
        }),
        events: [{ type: "GO", extra: 5 }],
    },
    {
        name: "wildcard descriptors: '*' and 'prefix.*' with specificity order",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        "*": { actions: lib.record("any", ({ event }) => event.type) },
                        "user.*": { actions: lib.record("user", ({ event }) => event.type) },
                        "user.login": { target: "b", actions: lib.record("login") },
                    },
                },
                b: { on: { "*": "a" } },
            },
        }),
        events: [
            { type: "random" },
            { type: "user.logout" },
            { type: "user" },
            { type: "user.login" },
            { type: "whatever" },
            { type: "user.login.extra" },
        ],
    },
];

describeScenarios("differential: basic", scenarios);
