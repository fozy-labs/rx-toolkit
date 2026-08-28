/**
 * Round 2 differential scenarios: targetless transitions — pure internal
 * transitions with actions on ancestors / the root, `reenter: true` without a
 * target, targetless arrays with mixed guards (including bare guarded entries
 * that block ancestors), and action ordering with assign on a state whose
 * after timer keeps running.
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "pure internal transition on a compound ancestor: the active leaf is untouched, assign is visible",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { pings: 0 },
            states: {
                p: {
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    initial: "x",
                    on: {
                        PING: {
                            actions: [
                                lib.assign({ pings: ({ context }: any) => context.pings + 1 }),
                                lib.record("ping", ({ context }) => context.pings),
                            ],
                        },
                    },
                    states: {
                        x: { entry: lib.record("xIn"), exit: lib.record("xOut"), on: { NEXT: "y" } },
                        y: { entry: lib.record("yIn"), exit: lib.record("yOut") },
                    },
                },
            },
        }),
        events: [{ type: "PING" }, { type: "NEXT" }, { type: "PING" }],
        probes: { can: [{ type: "PING" }, { type: "NEXT" }] },
    },
    {
        name: "targetless transition with reenter: true is still internal (no exit / entry)",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    initial: "x",
                    on: { PARENT_PING: { reenter: true, actions: lib.record("parentPing") } },
                    states: {
                        x: {
                            entry: lib.record("xIn"),
                            exit: lib.record("xOut"),
                            on: { PING: { reenter: true, actions: lib.record("ping") } },
                        },
                    },
                },
            },
        }),
        events: [{ type: "PING" }, { type: "PARENT_PING" }],
    },
    {
        name: "targetless array with mixed guards: first enabled wins, a bare guarded entry blocks the parent, the unguarded tail is the fallback",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { mode: "none" },
            states: {
                p: {
                    initial: "x",
                    on: {
                        EV: { actions: lib.record("parentEv") },
                        SET: { actions: lib.assign({ mode: ({ event }: any) => event.mode }) },
                    },
                    states: {
                        x: {
                            entry: lib.record("xIn"),
                            exit: lib.record("xOut"),
                            on: {
                                EV: [
                                    { guard: ({ context }: any) => context.mode === "act", actions: lib.record("act") },
                                    { guard: ({ context }: any) => context.mode === "block" },
                                    {
                                        guard: ({ context }: any) => context.mode === "move",
                                        target: "y",
                                        actions: lib.record("move"),
                                    },
                                    { actions: lib.record("fallback") },
                                ],
                            },
                        },
                        y: { entry: lib.record("yIn") },
                    },
                },
            },
        }),
        events: [
            { type: "EV" },
            { type: "SET", mode: "act" },
            { type: "EV" },
            { type: "SET", mode: "block" },
            { type: "EV" },
            { type: "SET", mode: "move" },
            { type: "EV" },
            { type: "EV" },
        ],
        probes: { can: [{ type: "EV" }] },
    },
    {
        name: "targetless transitions on the root while in a nested leaf: no exit / entry anywhere",
        config: (lib) => ({
            id: "m",
            initial: "p",
            entry: lib.record("rootIn"),
            exit: lib.record("rootOut"),
            on: { LOG: { actions: lib.record("log", ({ event }) => event.payload) } },
            states: {
                p: {
                    entry: lib.record("pIn"),
                    exit: lib.record("pOut"),
                    initial: "x",
                    states: { x: { entry: lib.record("xIn"), exit: lib.record("xOut") } },
                },
            },
        }),
        events: [
            { type: "LOG", payload: 1 },
            { type: "LOG", payload: 2 },
        ],
    },
    {
        name: "a targetless guarded child transition does not shadow the parent's targeted transition when its guard fails",
        config: (lib) => ({
            id: "m",
            initial: "p",
            context: { childHandles: false },
            states: {
                p: {
                    initial: "x",
                    on: {
                        EV: { target: "q", actions: lib.record("parent") },
                        TOGGLE: { actions: lib.assign({ childHandles: true }) },
                    },
                    states: {
                        x: {
                            on: {
                                EV: { guard: ({ context }: any) => context.childHandles, actions: lib.record("child") },
                            },
                        },
                    },
                },
                q: { entry: lib.record("qIn"), on: { BACK: "p" } },
            },
        }),
        events: [
            { type: "TOGGLE" },
            { type: "EV" },
            { type: "TOGGLE" },
            { type: "EV" },
            { type: "BACK" },
            { type: "EV" },
        ],
    },
    {
        name: "targetless transition actions run in list order with assign interleaved; the state's after timer keeps running",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { n: 0 },
            states: {
                a: {
                    after: { 10: { target: "b", actions: lib.record("aAfter", ({ context }) => context.n) } },
                    on: {
                        PING: {
                            actions: [
                                lib.record("p1", ({ context }) => context.n),
                                lib.assign({ n: ({ context }: any) => context.n + 1 }),
                                lib.record("p2", ({ context }) => context.n),
                            ],
                        },
                    },
                },
                b: {},
            },
        }),
        events: [{ type: "PING" }, { advance: 5 }, { type: "PING" }, { advance: 5 }],
    },
    {
        name: "targetless transition in a parallel region and a targetless transition on the parallel parent for the same event",
        config: (lib) => ({
            id: "m",
            initial: "par",
            states: {
                par: {
                    type: "parallel",
                    on: { EV: { actions: lib.record("parEv") } },
                    states: {
                        r1: {
                            initial: "a",
                            states: { a: { on: { EV: { actions: lib.record("r1Ev") } } } },
                        },
                        r2: {
                            initial: "x",
                            states: { x: { on: { OTHER: { actions: lib.record("r2Other") } } } },
                        },
                    },
                },
            },
        }),
        events: [{ type: "EV" }, { type: "OTHER" }],
        probes: { can: [{ type: "EV" }, { type: "OTHER" }] },
    },
];

describeScenarios("differential: targetless transitions", scenarios);
