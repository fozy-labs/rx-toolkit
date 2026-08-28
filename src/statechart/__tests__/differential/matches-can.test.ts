/**
 * Round 1 differential scenarios: `matches()` and `can()` probed after every
 * step on compound and parallel machines.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "matches: string paths and object values on a nested compound machine",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: {
                    initial: "a1",
                    states: {
                        a1: { on: { NEXT: "a2" } },
                        a2: { initial: "deep", states: { deep: {} }, on: { OUT: "#m.b" } },
                    },
                },
                b: { on: { BACK: "a" } },
            },
        },
        events: [{ type: "NEXT" }, { type: "OUT" }, { type: "BACK" }],
        probes: {
            matches: [
                "a",
                "b",
                "a.a1",
                "a.a2",
                "a.a2.deep",
                { a: "a1" },
                { a: "a2" },
                { a: { a2: "deep" } },
                { a: {} },
                "a1",
                "deep",
            ],
        },
    },
    {
        name: "matches on a parallel machine: partial object values and dotted paths",
        config: {
            id: "m",
            initial: "p",
            states: {
                p: {
                    type: "parallel",
                    states: {
                        x: { initial: "x1", states: { x1: { on: { X: "x2" } }, x2: {} } },
                        y: { initial: "y1", states: { y1: { on: { Y: "y2" } }, y2: {} } },
                    },
                    on: { LEAVE: "q" },
                },
                q: {},
            },
        },
        events: [{ type: "X" }, { type: "Y" }, { type: "LEAVE" }],
        probes: {
            matches: [
                "p",
                "q",
                "p.x",
                "p.x.x1",
                "p.x.x2",
                { p: { x: "x1" } },
                { p: { x: "x2", y: "y2" } },
                { p: { x: "x1", y: "y2" } },
                { p: {} },
            ],
        },
    },
    {
        name: "can: guarded, forbidden, targetless-with-actions, unknown events and parent transitions",
        config: (lib) => ({
            id: "m",
            context: { ok: false },
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: {
                            on: {
                                GUARDED: { target: "b", guard: ({ context }: any) => context.ok },
                                FORBIDDEN: {},
                                ACTION_ONLY: { actions: lib.record("actionOnly") },
                                ENABLE: { actions: lib.assign({ ok: true }) },
                                NEXT: "b",
                            },
                        },
                        b: { on: { FINISH: "#m.done" } },
                    },
                    on: { FORBIDDEN: "q", PARENT: "q" },
                },
                q: {},
                done: { type: "final" },
            },
        }),
        events: [{ type: "GUARDED" }, { type: "ENABLE" }, { type: "GUARDED" }, { type: "FINISH" }],
        probes: {
            can: [
                { type: "GUARDED" },
                { type: "FORBIDDEN" },
                { type: "ACTION_ONLY" },
                { type: "ENABLE" },
                { type: "NEXT" },
                { type: "PARENT" },
                { type: "FINISH" },
                { type: "UNKNOWN" },
            ],
            matches: ["p", "p.a", "p.b", "done"],
        },
    },
    {
        name: "can with event payloads: the guard sees the probed event",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", guard: ({ event }: any) => event.value > 1 } } },
                b: {},
            },
        },
        events: [
            { type: "GO", value: 1 },
            { type: "GO", value: 2 },
        ],
        probes: {
            can: [
                { type: "GO", value: 0 },
                { type: "GO", value: 5 },
            ],
        },
    },
    {
        name: "can on a parallel machine: any region accepting the event counts",
        config: {
            id: "m",
            type: "parallel",
            states: {
                x: { initial: "x1", states: { x1: { on: { X: "x2" } }, x2: {} } },
                y: { initial: "y1", states: { y1: { on: { Y: "y2", X: {} } }, y2: {} } },
            },
        },
        events: [{ type: "X" }, { type: "Y" }],
        probes: { can: [{ type: "X" }, { type: "Y" }, { type: "Z" }] },
    },
];

describeScenarios("differential: matches & can", scenarios);
