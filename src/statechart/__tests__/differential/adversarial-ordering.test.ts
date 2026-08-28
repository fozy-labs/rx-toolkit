/**
 * Round 3 (adversarial) differential scenarios: document order derived from
 * JavaScript object key order (integer-like keys iterate first), which drives
 * region entry order, conflict resolution and `always` selection in parallel
 * states; plus action list ordering across exit / transition / entry when
 * several regions transition at once.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "integer-like region keys iterate first: entry order, exit order and value shape follow JS key order, not declaration order",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        zeta: { entry: lib.record("zetaIn"), exit: lib.record("zetaOut") },
                        10: { entry: lib.record("10In"), exit: lib.record("10Out") },
                        alpha: { entry: lib.record("alphaIn"), exit: lib.record("alphaOut") },
                        2: { entry: lib.record("2In"), exit: lib.record("2Out") },
                    },
                    on: { LEAVE: "out" },
                },
                out: {},
            },
        }),
        probes: { matches: [{ p: { 2: {}, 10: {} } }, { p: { zeta: {}, alpha: {} } }, "p.2", "p.10"] },
        events: [{ type: "LEAVE" }],
    },
    {
        name: "integer-like state keys as targets and initial: '1' -> '2' -> '10' with document order deciding conflicting always transitions",
        config: (lib) => ({
            id: "m",
            context: { go: false },
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        b: {
                            initial: "1",
                            states: {
                                1: {
                                    entry: lib.record("b1In"),
                                    on: { NEXT: "2" },
                                    always: {
                                        guard: ({ context }: { context: { go: boolean } }) => context.go,
                                        target: "#m.outFromB",
                                        actions: lib.record("bAlways"),
                                    },
                                },
                                2: { entry: lib.record("b2In"), on: { NEXT: "10" } },
                                10: { entry: lib.record("b10In") },
                            },
                        },
                        3: {
                            initial: "x",
                            states: {
                                x: {
                                    entry: lib.record("3xIn"),
                                    always: {
                                        guard: ({ context }: { context: { go: boolean } }) => context.go,
                                        target: "#m.outFrom3",
                                        actions: lib.record("3Always"),
                                    },
                                },
                            },
                        },
                    },
                    on: { GO: { actions: lib.assign({ go: true }) } },
                },
                outFromB: { entry: lib.record("outFromBIn") },
                outFrom3: { entry: lib.record("outFrom3In") },
            },
        }),
        events: [{ type: "NEXT" }, { type: "NEXT" }, { type: "GO" }],
    },
    {
        name: "one event transitions in three regions: all exits (document order of exiting nodes, deepest first), then all transition actions, then all entries",
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
                                a1: {
                                    exit: lib.record("a1Out"),
                                    on: { TICK: { target: "a2", actions: lib.record("aTrans") } },
                                },
                                a2: { entry: lib.record("a2In") },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    initial: "deep",
                                    exit: lib.record("b1Out"),
                                    states: {
                                        deep: {
                                            exit: lib.record("deepOut"),
                                            on: { TICK: { target: "#m.p.b.b2", actions: lib.record("bTrans") } },
                                        },
                                    },
                                },
                                b2: { entry: lib.record("b2In") },
                            },
                        },
                        c: {
                            initial: "c1",
                            states: {
                                c1: {
                                    exit: lib.record("c1Out"),
                                    on: { TICK: { target: "c2", actions: lib.record("cTrans") } },
                                },
                                c2: {
                                    entry: lib.record("c2In"),
                                    initial: "c2deep",
                                    states: { c2deep: { entry: lib.record("c2deepIn") } },
                                },
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "TICK" }],
    },
    {
        name: "transition arrays and the `on` object mix: exact descriptor declared after '*' still wins; among wildcards the longer wins",
        config: (lib) => ({
            id: "m",
            initial: "s",
            states: {
                s: {
                    on: {
                        "*": { actions: lib.record("star") },
                        "user.*": { actions: lib.record("user*") },
                        "user.click": { actions: lib.record("user.click") },
                        "user.click.*": { actions: lib.record("user.click.*") },
                    },
                },
            },
        }),
        events: [{ type: "user.click" }, { type: "user.click.left" }, { type: "user.hover" }, { type: "system" }],
    },
    {
        name: "guard evaluation order across regions: guards of every region run before any action, so a throwing second-region guard blocks the first region's transition",
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
                                a1: { on: { TICK: { target: "a2", actions: lib.record("aTrans") } } },
                                a2: {},
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    on: {
                                        TICK: {
                                            guard: () => {
                                                throw new Error("boom in b");
                                            },
                                            target: "b2",
                                        },
                                    },
                                },
                                b2: {},
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "TICK" }],
    },
    {
        name: "parallel regions with the same child key: value shape and targets by relative path stay within the region",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        left: {
                            initial: "idle",
                            states: {
                                idle: { on: { GO: { target: "busy", actions: lib.record("leftGo") } } },
                                busy: { entry: lib.record("leftBusyIn"), on: { DONE: "idle" } },
                            },
                        },
                        right: {
                            initial: "idle",
                            states: {
                                idle: { on: { GO_RIGHT: { target: "busy", actions: lib.record("rightGo") } } },
                                busy: { entry: lib.record("rightBusyIn"), on: { DONE: "idle" } },
                            },
                        },
                    },
                    on: { RESET_BOTH: { target: [".left.idle", ".right.idle"], reenter: true } },
                },
            },
        }),
        probes: { matches: [{ p: { left: "busy" } }, { p: { right: "busy" } }, "p.left.idle", "p.right.idle"] },
        events: [{ type: "GO" }, { type: "GO_RIGHT" }, { type: "DONE" }, { type: "GO" }, { type: "RESET_BOTH" }],
    },
];

describeScenarios("differential: adversarial ordering", scenarios);
