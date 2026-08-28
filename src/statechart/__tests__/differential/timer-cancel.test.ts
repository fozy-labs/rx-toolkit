/**
 * Round 2 differential scenarios: delayed `raise` cancelled before delivery
 * (from an initial entry, across transitions, dynamic ids, unknown ids, two ids,
 * same-list raise + cancel) and `after` timers cancelled by leaving the state
 * (directly, through an ancestor, restarting from zero, by the after event name).
 *
 * Ids are never reused without a cancel in between (spec 11.11).
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "delayed raise scheduled by an initial entry action, cancelled by the first event before delivery",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.raise({ type: "TICK" }, { delay: 20, id: "tick" }),
            states: {
                a: {
                    on: {
                        CANCEL: { actions: lib.cancel("tick") },
                        TICK: { target: "ticked", actions: lib.record("tick") },
                    },
                },
                ticked: {},
            },
        }),
        events: [{ advance: 10 }, { type: "CANCEL" }, { advance: 20 }],
    },
    {
        name: "delayed raise survives a transition and is cancelled from another state's entry action by a dynamic id",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { jobId: "job-1" },
            states: {
                a: {
                    on: {
                        START: {
                            target: "b",
                            actions: lib.raise({ type: "DONE" }, { delay: 30, id: "job-1" }),
                        },
                    },
                },
                b: {
                    on: { ABORT: "c", DONE: { target: "finished", actions: lib.record("doneInB") } },
                },
                c: {
                    entry: lib.cancel(({ context }: any) => context.jobId),
                    on: { DONE: { target: "finished", actions: lib.record("doneInC") } },
                },
                finished: {},
            },
        }),
        events: [{ type: "START" }, { advance: 10 }, { type: "ABORT" }, { advance: 30 }],
    },
    {
        name: "delayed raise not cancelled: the same machine delivers it in the state reached meanwhile",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        START: {
                            target: "b",
                            actions: lib.raise({ type: "DONE" }, { delay: 30, id: "job" }),
                        },
                    },
                },
                b: { on: { MOVE: "c", DONE: { target: "finished", actions: lib.record("doneInB") } } },
                c: { on: { DONE: { target: "finished", actions: lib.record("doneInC") } } },
                finished: {},
            },
        }),
        events: [{ type: "START" }, { advance: 10 }, { type: "MOVE" }, { advance: 20 }],
    },
    {
        name: "cancel of an unknown id is a no-op; the pending delayed raise still fires",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: lib.raise({ type: "PING" }, { delay: 10, id: "p" }),
                    on: {
                        NOPE: { actions: lib.cancel("does-not-exist") },
                        PING: { target: "b", actions: lib.record("ping") },
                    },
                },
                b: {},
            },
        }),
        events: [{ type: "NOPE" }, { advance: 10 }],
    },
    {
        name: "two delayed raises with distinct ids: cancelling one leaves the other",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: [
                        lib.raise({ type: "A" }, { delay: 10, id: "ta" }),
                        lib.raise({ type: "B" }, { delay: 10, id: "tb" }),
                    ],
                    on: {
                        CANCEL_A: { actions: lib.cancel("ta") },
                        A: { actions: lib.record("a") },
                        B: { target: "b", actions: lib.record("b") },
                    },
                },
                b: {},
            },
        }),
        events: [{ type: "CANCEL_A" }, { advance: 10 }],
    },
    {
        name: "raise then cancel in the same action list: nothing fires; cancel then raise under the same id: fires",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        RAISE_CANCEL: {
                            actions: [lib.raise({ type: "X" }, { delay: 10, id: "x" }), lib.cancel("x")],
                        },
                        CANCEL_RAISE: {
                            actions: [lib.cancel("x"), lib.raise({ type: "X" }, { delay: 10, id: "x" })],
                        },
                        X: { actions: lib.record("x") },
                    },
                },
            },
        }),
        events: [{ type: "RAISE_CANCEL" }, { advance: 10 }, { type: "CANCEL_RAISE" }, { advance: 10 }],
    },
    {
        name: "after is cancelled by leaving the state and restarts from zero on return",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { 10: { target: "timedOut", actions: lib.record("aAfter") } },
                    on: { OUT: "b" },
                },
                b: { on: { BACK: "a" } },
                timedOut: {},
            },
        }),
        events: [{ advance: 6 }, { type: "OUT" }, { type: "BACK" }, { advance: 6 }, { advance: 4 }],
    },
    {
        name: "after on a child is cancelled when an ancestor's transition exits it",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    states: {
                        x: { after: { 10: { target: "y", actions: lib.record("xAfter") } } },
                        y: {},
                    },
                    on: { LEAVE: "q" },
                },
                q: {},
            },
        }),
        events: [{ advance: 5 }, { type: "LEAVE" }, { advance: 10 }],
    },
    {
        name: "after on a parent and its child: leaving the parent cancels both, re-entering re-arms both",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    after: { 30: { target: "q", actions: lib.record("pAfter") } },
                    states: {
                        x: { after: { 20: { target: "y", actions: lib.record("xAfter") } } },
                        y: {},
                    },
                    on: { LEAVE: "q" },
                },
                q: { on: { BACK: "p" } },
            },
        }),
        events: [
            { advance: 15 },
            { type: "LEAVE" },
            { advance: 30 },
            { type: "BACK" },
            { advance: 20 },
            { advance: 10 },
        ],
    },
    {
        name: "cancel() with the after event name cancels the after timer (xstate.after.<delay>.<stateId>)",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { 10: { target: "b", actions: lib.record("aAfter") } },
                    on: { STOP_TIMER: { actions: lib.cancel("xstate.after.10.m.a") } },
                },
                b: {},
            },
        }),
        events: [{ type: "STOP_TIMER" }, { advance: 10 }],
    },
    {
        name: "cancel() of an after timer by a named delay's event name",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { SLOW: { target: "b", actions: lib.record("aAfter") } },
                    on: { STOP_TIMER: { actions: lib.cancel("xstate.after.SLOW.m.a") } },
                },
                b: {},
            },
        }),
        implementations: () => ({ delays: { SLOW: 10 } }),
        events: [{ type: "STOP_TIMER" }, { advance: 10 }],
    },
];

describeScenarios("differential: cancelling delayed raises and after timers", scenarios);
