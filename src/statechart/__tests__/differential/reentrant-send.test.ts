/**
 * Round 2 differential scenarios: re-entrant `send()` from inside actions —
 * from entry / exit actions, chained sends, a send dropped by the machine
 * finishing in the same macrostep, a send from a timer-driven transition, and a
 * queued event whose guard reads the context committed by the sending action.
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "re-entrant send from an entry action of the target state is processed after the current macrostep",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", actions: lib.record("go") } } },
                b: {
                    entry: [() => lib.send({ type: "NEXT" }), lib.record("bIn")],
                    exit: lib.record("bOut"),
                    on: { NEXT: { target: "c", actions: lib.record("next") } },
                },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "re-entrant send from an exit action is handled by the state reached after the current macrostep",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    exit: [() => lib.send({ type: "NEXT" }), lib.record("aOut")],
                    on: { GO: "b", NEXT: { target: "wrong", actions: lib.record("nextInA") } },
                },
                b: { entry: lib.record("bIn"), on: { NEXT: { target: "c", actions: lib.record("nextInB") } } },
                c: { entry: lib.record("cIn") },
                wrong: {},
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "chained re-entrant sends: each handler sends the next event, all settle within one external send",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { S1: { target: "b", actions: [lib.record("s1"), () => lib.send({ type: "S2" })] } } },
                b: { on: { S2: { target: "c", actions: [lib.record("s2"), () => lib.send({ type: "S3" })] } } },
                c: { on: { S3: { target: "d", actions: lib.record("s3") } } },
                d: { entry: lib.record("dIn") },
            },
        }),
        events: [{ type: "S1" }],
    },
    {
        name: "two re-entrant sends from one action list keep their order and interleave after raised events",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            actions: [
                                () => lib.send({ type: "FIRST" }),
                                lib.raise({ type: "RAISED" }),
                                () => lib.send({ type: "SECOND" }),
                                lib.record("go"),
                            ],
                        },
                        RAISED: { actions: lib.record("raised") },
                        FIRST: { actions: lib.record("first") },
                        SECOND: { target: "b", actions: lib.record("second") },
                    },
                },
                b: { entry: lib.record("bIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "re-entrant send is dropped when the same macrostep finishes the machine",
        config: (lib) => ({
            id: "m",
            initial: "a",
            on: { AFTER: { actions: lib.record("after") } },
            states: {
                a: { on: { GO: { target: "f", actions: [() => lib.send({ type: "AFTER" }), lib.record("go")] } } },
                f: { type: "final", entry: lib.record("fIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "re-entrant send from a timer-driven transition's action is processed after the after macrostep",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: {
                        10: {
                            target: "b",
                            actions: [
                                () => lib.send({ type: "NEXT" }),
                                lib.raise({ type: "RAISED" }),
                                lib.record("afterAction"),
                            ],
                        },
                    },
                },
                b: {
                    entry: lib.record("bIn"),
                    on: {
                        RAISED: { actions: lib.record("raised") },
                        NEXT: { target: "c", actions: lib.record("next") },
                    },
                },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ advance: 10 }],
    },
    {
        name: "a re-entrant send's guard sees the context assigned by the sending action list",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { n: 0 },
            states: {
                a: {
                    on: {
                        GO: { actions: [lib.assign({ n: 5 }), () => lib.send({ type: "CHECK" }), lib.record("go")] },
                        CHECK: [
                            { target: "big", guard: ({ context }: any) => context.n >= 5, actions: lib.record("big") },
                            { target: "small", actions: lib.record("small") },
                        ],
                    },
                },
                big: {},
                small: {},
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "re-entrant send from an entry action reached through an always transition",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: "route" } },
                route: { always: { target: "b", actions: lib.record("routed") } },
                b: {
                    entry: [() => lib.send({ type: "NEXT" }), lib.record("bIn")],
                    on: { NEXT: { target: "c", actions: lib.record("next") } },
                },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
];

describeScenarios("differential: re-entrant send from actions", scenarios);
