/**
 * Round 1 differential scenarios: `after` transitions with numeric and named
 * delays, delayed `raise` and `cancel`, timer cancellation on exit / stop.
 * Driven by fake timers (`{ advance: ms }` steps).
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "after with a numeric delay: fires exactly at the delay, the after event type is visible to actions",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { after: { 100: { target: "b", actions: lib.record("timeout", ({ event }) => event.type) } } },
                b: {},
            },
        }),
        events: [{ advance: 99 }, { advance: 1 }, { advance: 1000 }],
    },
    {
        name: "after is cancelled when the state is exited before the delay elapses",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { 100: { target: "timedOut", actions: lib.record("timeout") } },
                    on: { GO: "b" },
                },
                b: { entry: lib.record("bIn") },
                timedOut: {},
            },
        }),
        events: [{ advance: 50 }, { type: "GO" }, { advance: 100 }],
    },
    {
        name: "named delays: a number and a function of { context, event } from the delays table",
        config: (lib) => ({
            id: "m",
            context: { factor: 3 },
            initial: "a",
            states: {
                a: { after: { SHORT: { target: "b", actions: lib.record("short", ({ event }) => event.type) } } },
                b: {
                    after: { COMPUTED: { target: "c", actions: lib.record("computed", ({ event }) => event.type) } },
                },
                c: {},
            },
        }),
        implementations: () => ({
            delays: {
                SHORT: 20,
                COMPUTED: ({ context }: any) => context.factor * 10,
            },
        }),
        events: [{ advance: 19 }, { advance: 1 }, { advance: 29 }, { advance: 1 }],
    },
    {
        name: "several after keys on one state: the shortest wins and cancels the others",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: {
                        300: { target: "slow", actions: lib.record("slow") },
                        100: { target: "fast", actions: lib.record("fast") },
                    },
                },
                fast: { on: { BACK: "a" } },
                slow: {},
            },
        }),
        events: [{ advance: 100 }, { advance: 300 }, { type: "BACK" }, { advance: 100 }],
    },
    {
        name: "after with a guarded transition array: falls through to the next candidate",
        config: (lib) => ({
            id: "m",
            context: { allow: false },
            initial: "a",
            states: {
                a: {
                    on: { ALLOW: { actions: lib.assign({ allow: true }) } },
                    after: {
                        50: [
                            { target: "allowed", guard: ({ context }: any) => context.allow },
                            { target: "denied", actions: lib.record("denied") },
                        ],
                    },
                },
                allowed: {},
                denied: { on: { RETRY: "a" } },
            },
        }),
        events: [{ advance: 50 }, { type: "RETRY" }, { type: "ALLOW" }, { advance: 50 }],
    },
    {
        name: "after timer restarts when the state is re-entered (reenter: true) and keeps running on internal transitions",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { 100: { target: "b", actions: lib.record("timeout") } },
                    on: {
                        RESTART: { target: "a", reenter: true, actions: lib.record("restart") },
                        TOUCH: { actions: lib.record("touch") },
                    },
                },
                b: {},
            },
        }),
        events: [{ advance: 60 }, { type: "RESTART" }, { advance: 60 }, { type: "TOUCH" }, { advance: 40 }],
    },
    {
        name: "after on a compound parent survives child transitions and fires from the parent",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    after: { 100: { target: "out", actions: lib.record("parentTimeout") } },
                    states: {
                        x: { on: { NEXT: "y" } },
                        y: { after: { 30: { target: "x", actions: lib.record("childTimeout") } } },
                    },
                },
                out: { entry: lib.record("outIn") },
            },
        }),
        events: [{ advance: 50 }, { type: "NEXT" }, { advance: 30 }, { advance: 20 }, { advance: 100 }],
    },
    {
        name: "after with delay 0 fires on the next timer tick, not synchronously",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { after: { 0: { target: "b", actions: lib.record("zero") } } },
                b: {},
            },
        }),
        events: [{ advance: 0 }],
    },
    {
        name: "delayed raise with an id, cancelled by cancel(id) before it fires",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        ARM: { actions: lib.raise({ type: "TICK" }, { delay: 50, id: "tick" }) },
                        DISARM: { actions: lib.cancel("tick") },
                        TICK: { target: "ticked", actions: lib.record("tick", ({ event }) => event.type) },
                    },
                },
                ticked: { on: { RESET: "a" } },
            },
        }),
        events: [
            { type: "ARM" },
            { advance: 20 },
            { type: "DISARM" },
            { advance: 100 },
            { type: "ARM" },
            { advance: 50 },
            { type: "RESET" },
        ],
    },
    {
        name: "delayed raise with a named delay and a delay expression",
        config: (lib) => ({
            id: "m",
            context: { wait: 40 },
            initial: "a",
            states: {
                a: {
                    on: {
                        NAMED: { actions: lib.raise({ type: "PING" }, { delay: "NAMED_DELAY" }) },
                        EXPR: { actions: lib.raise({ type: "PING" }, { delay: ({ context }: any) => context.wait }) },
                        PING: { actions: lib.record("ping") },
                    },
                },
            },
        }),
        implementations: () => ({ delays: { NAMED_DELAY: 25 } }),
        events: [{ type: "NAMED" }, { advance: 24 }, { advance: 1 }, { type: "EXPR" }, { advance: 39 }, { advance: 1 }],
    },
    {
        name: "delayed raise is not cancelled by a transition (unlike after)",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        ARM: { actions: lib.raise({ type: "TICK" }, { delay: 50, id: "tick" }) },
                        GO: "b",
                    },
                },
                b: { on: { TICK: { target: "c", actions: lib.record("tickInB") } } },
                c: {},
            },
        }),
        events: [{ type: "ARM" }, { type: "GO" }, { advance: 50 }],
    },
    {
        name: "stop() cancels pending timers; events after stop are ignored",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    exit: lib.record("aExit"),
                    after: { 100: { target: "b", actions: lib.record("timeout") } },
                    on: { GO: "b" },
                },
                b: {},
            },
        }),
        events: [{ advance: 50 }, { stop: true }, { advance: 100 }, { type: "GO" }],
    },
    {
        name: "reaching a top-level final state cancels pending timers",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { 100: { target: "b", actions: lib.record("timeout") } },
                    on: { FINISH: "done" },
                },
                b: {},
                done: { type: "final" },
            },
        }),
        events: [{ advance: 50 }, { type: "FINISH" }, { advance: 100 }],
    },
    {
        name: "after inside parallel regions: each region's timer fires independently",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            states: {
                left: {
                    initial: "l1",
                    states: {
                        l1: { after: { 30: { target: "l2", actions: lib.record("leftTimeout") } } },
                        l2: {},
                    },
                },
                right: {
                    initial: "r1",
                    states: {
                        r1: { after: { 60: { target: "r2", actions: lib.record("rightTimeout") } } },
                        r2: {},
                    },
                },
            },
        }),
        events: [{ advance: 30 }, { advance: 30 }],
    },
    {
        name: "after transition with actions only (targetless) re-arms nothing: fires once",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { after: { 10: { actions: lib.record("tick") } } },
            },
        }),
        events: [{ advance: 10 }, { advance: 10 }, { advance: 100 }],
    },
];

describeScenarios("differential: timers", scenarios);
