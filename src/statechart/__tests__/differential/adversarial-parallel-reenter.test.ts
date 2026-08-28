/**
 * Round 3 (adversarial) differential scenarios: transitions from inside a
 * parallel state that target one of its ancestors (the parallel state itself,
 * the region, a compound above it) with and without `reenter`, plus the
 * conflict-resolution rules when several regions react to one event.
 *
 * XState behaviour under test: the transition domain is the least common
 * ancestor computed from the *target's* proper ancestors, so targeting an
 * ancestor exits and re-enters that ancestor (LCA is its parent), and
 * targeting the region you are in re-initializes *every* region (the domain
 * is the parallel state). A parallel state's own self-transition without
 * `reenter` keeps the parallel state and re-initializes its regions.
 */
import { describeScenarios, type Scenario, type ScenarioLib } from "./harness";

type Transitions = Record<string, unknown>;

interface ParallelOptions {
    /** `on` maps of the leaves / the region `a` / the parallel state. */
    a1?: Transitions;
    a2?: Transitions;
    regionA?: Transitions;
    p?: Transitions;
}

/** Parallel state `p` with two compound regions (a: a1 → a2, b: b1 → b2 on NEXT), entry / exit recorded on every node. */
function recordedParallel(lib: ScenarioLib, options: ParallelOptions = {}) {
    return {
        type: "parallel",
        entry: lib.record("pIn"),
        exit: lib.record("pOut"),
        states: {
            a: {
                id: "regionA",
                initial: "a1",
                entry: lib.record("aIn"),
                exit: lib.record("aOut"),
                ...(options.regionA ? { on: options.regionA } : {}),
                states: {
                    a1: { entry: lib.record("a1In"), exit: lib.record("a1Out"), on: { NEXT: "a2", ...options.a1 } },
                    a2: {
                        entry: lib.record("a2In"),
                        exit: lib.record("a2Out"),
                        ...(options.a2 ? { on: options.a2 } : {}),
                    },
                },
            },
            b: {
                initial: "b1",
                entry: lib.record("bIn"),
                exit: lib.record("bOut"),
                states: {
                    b1: { entry: lib.record("b1In"), exit: lib.record("b1Out"), on: { NEXT: "b2" } },
                    b2: { entry: lib.record("b2In"), exit: lib.record("b2Out") },
                },
            },
        },
        ...(options.p ? { on: options.p } : {}),
    };
}

const scenarios: Scenario[] = [
    {
        name: "region leaf targets the parallel state itself: with or without reenter p is exited and re-entered (its LCA is the root)",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: recordedParallel(lib, {
                    a2: {
                        UP: { target: "#m.p", actions: lib.record("up") },
                        UP_REENTER: { target: "#m.p", reenter: true, actions: lib.record("upReenter") },
                    },
                }),
            },
        }),
        events: [{ type: "NEXT" }, { type: "UP" }, { type: "NEXT" }, { type: "UP_REENTER" }],
    },
    {
        name: "region leaf targets its own region node: every region re-initializes (domain is p), the region entry runs without p exit",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: recordedParallel(lib, {
                    a2: {
                        RESET_A: { target: "#regionA", actions: lib.record("resetA") },
                        RESET_A_REENTER: { target: "#regionA", reenter: true, actions: lib.record("resetAReenter") },
                    },
                }),
            },
        }),
        events: [{ type: "NEXT" }, { type: "RESET_A" }, { type: "NEXT" }, { type: "RESET_A_REENTER" }],
    },
    {
        name: "region node targets itself from its own `on`: without reenter only the region's children re-initialize, with reenter the region exits too",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: recordedParallel(lib, {
                    regionA: {
                        SELF_A: { target: "#regionA", actions: lib.record("selfA") },
                        SELF_A_REENTER: { target: "#regionA", reenter: true, actions: lib.record("selfAReenter") },
                    },
                }),
            },
        }),
        events: [{ type: "NEXT" }, { type: "SELF_A" }, { type: "NEXT" }, { type: "SELF_A_REENTER" }],
    },
    {
        name: "region leaf targets the compound above the parallel state: the compound is exited and re-entered with every descendant",
        config: (lib) => ({
            id: "m",
            initial: "outer",
            states: {
                outer: {
                    entry: lib.record("outerIn"),
                    exit: lib.record("outerOut"),
                    initial: "p",
                    states: {
                        p: recordedParallel(lib, {
                            a2: {
                                UP: { target: "#m.outer", actions: lib.record("up") },
                            },
                            a1: {
                                UP_REENTER: { target: "#m.outer", reenter: true, actions: lib.record("upReenter") },
                            },
                        }),
                    },
                },
            },
        }),
        events: [{ type: "NEXT" }, { type: "UP" }, { type: "UP_REENTER" }],
    },
    {
        name: "parallel state's own self-transition: without reenter the regions re-initialize and p keeps its entry/exit; with reenter p exits and enters",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: recordedParallel(lib, {
                    p: {
                        SELF: { target: "p", actions: lib.record("self") },
                        SELF_REENTER: { target: "p", reenter: true, actions: lib.record("selfReenter") },
                        SELF_ID: { target: "#m.p", actions: lib.record("selfId") },
                    },
                }),
            },
        }),
        events: [{ type: "NEXT" }, { type: "SELF" }, { type: "NEXT" }, { type: "SELF_REENTER" }, { type: "SELF_ID" }],
    },
    {
        name: "multi-target from a region leaf into its own region and a sibling region: the whole parallel state is re-entered",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: recordedParallel(lib, {
                    a1: { BOTH: { target: ["#m.p.a.a2", "#m.p.b.b2"], actions: lib.record("both") } },
                }),
            },
        }),
        events: [{ type: "BOTH" }],
    },
    {
        name: "region leaf targets a sibling region's leaf with reenter: true: both regions are exited and re-entered",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: recordedParallel(lib, {
                    a1: { JUMP: { target: "#m.p.b.b2", reenter: true, actions: lib.record("jump") } },
                }),
            },
        }),
        events: [{ type: "JUMP" }],
    },
    {
        name: "conflict: the first region's internal transition preempts the second region's transition that would leave the parallel state",
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
                                a1: { on: { TICK: { target: "a2", actions: lib.record("aTick") } } },
                                a2: { on: { TICK: { target: "a1", actions: lib.record("aTick") } } },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { on: { TICK: { target: "#m.out", actions: lib.record("bLeave") } } },
                            },
                        },
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ type: "TICK" }, { type: "TICK" }],
    },
    {
        name: "conflict: the first region's transition leaves the parallel state and drops the second region's internal transition",
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
                                a1: { on: { TICK: { target: "#m.out", actions: lib.record("aLeave") } } },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { on: { TICK: { target: "b2", actions: lib.record("bTick") } } },
                                b2: {},
                            },
                        },
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ type: "TICK" }],
    },
    {
        name: "conflict: a deeper region transition preempts a shallower one of the same region, a sibling region still fires",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        a: {
                            initial: "inner",
                            on: { TICK: { target: ".inner", reenter: true, actions: lib.record("aShallow") } },
                            states: {
                                inner: {
                                    initial: "i1",
                                    states: {
                                        i1: { on: { TICK: { target: "i2", actions: lib.record("aDeep") } } },
                                        i2: {},
                                    },
                                },
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: { on: { TICK: { target: "b2", actions: lib.record("bTick") } } },
                                b2: {},
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "TICK" }, { type: "TICK" }],
    },
    {
        name: "cross-region guard in the same event: stateIn and context guards see the pre-transition configuration and context",
        config: (lib) => ({
            id: "m",
            context: { n: 0 },
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        a: {
                            initial: "a1",
                            states: {
                                a1: {
                                    on: {
                                        TICK: {
                                            target: "a2",
                                            actions: [lib.assign({ n: 1 }), lib.record("aTick")],
                                        },
                                    },
                                },
                                a2: {},
                            },
                        },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    on: {
                                        TICK: [
                                            {
                                                target: "bByState",
                                                guard: lib.stateIn("#m.p.a.a2"),
                                                actions: lib.record("bByState"),
                                            },
                                            {
                                                target: "bByContext",
                                                guard: ({ context }: { context: { n: number } }) => context.n === 1,
                                                actions: lib.record("bByContext"),
                                            },
                                            { actions: lib.record("bStay", ({ context }) => context) },
                                        ],
                                    },
                                },
                                bByState: {},
                                bByContext: {},
                            },
                        },
                    },
                },
            },
        }),
        events: [{ type: "TICK" }, { type: "TICK" }],
    },
];

describeScenarios("differential: adversarial parallel reenter", scenarios);
