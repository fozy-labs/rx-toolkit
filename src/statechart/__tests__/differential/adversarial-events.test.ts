/**
 * Round 3 (adversarial) differential scenarios: the exact event objects seen
 * by guards / actions / assign (identity, extra keys, non-JSON values,
 * mutation), the `xstate.init` event shape, system events sent from outside
 * (`xstate.init`, `xstate.stop`, `*`), and partial-wildcard descriptors
 * against system events and same-length event types.
 */
import { describeScenarios, type Scenario, type ScenarioEvent } from "./harness";

/**
 * Shared event objects: the harness sends the very same object to both
 * libraries, so identity checks (`event === payloadEvent`) are meaningful.
 * Scenarios mutating an event set fixed values so both runs observe the same.
 */
const payloadEvent: ScenarioEvent = {
    type: "PAYLOAD",
    nested: { list: [1, { deep: true }], text: "x" },
    count: 0,
    flag: false,
    nothing: null,
    fn: () => 42,
    when: new Date(0),
    target: "looksLikeATarget",
    delay: 500,
};

const describeEvent = ({ event }: { event: Record<string, unknown> }) => ({
    same: event === payloadEvent,
    keys: Object.keys(event),
    fnType: typeof event.fn,
    fnResult: typeof event.fn === "function" ? (event.fn as () => number)() : undefined,
    whenIsDate: event.when instanceof Date,
    nested: event.nested,
});

const scenarios: Scenario[] = [
    {
        name: "event payload reaches guards, transition actions, assign, entry actions and raise expressions as the same object",
        config: (lib) => ({
            id: "m",
            context: { fromEvent: undefined as unknown },
            initial: "a",
            states: {
                a: {
                    on: {
                        PAYLOAD: {
                            guard: ({ event }: { event: Record<string, unknown> }) => event === payloadEvent,
                            target: "b",
                            actions: [
                                lib.record("transition", describeEvent),
                                lib.assign({
                                    fromEvent: ({ event }: { event: Record<string, unknown> }) => event.nested,
                                }),
                                lib.raise(({ event }: { event: Record<string, unknown> }) => ({
                                    type: "ECHO",
                                    original: event,
                                })),
                            ],
                        },
                    },
                },
                b: {
                    entry: lib.record("bIn", describeEvent),
                    on: {
                        ECHO: {
                            actions: lib.record("echo", ({ event }) => ({
                                type: event.type,
                                sameOriginal: event.original === payloadEvent,
                                keys: Object.keys(event),
                            })),
                        },
                    },
                },
            },
        }),
        events: [payloadEvent],
    },
    {
        name: "an action mutating the event object: later actions of the same list and of the next microstep see the mutation",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        MUTATE: {
                            target: "b",
                            actions: [
                                ({ event }: { event: Record<string, unknown> }) => {
                                    event.stamp = "stamped";
                                },
                                lib.record("afterMutation", ({ event }) => event.stamp),
                            ],
                        },
                    },
                },
                b: {
                    entry: lib.record("bIn", ({ event }) => event.stamp),
                    always: { target: "c", actions: lib.record("always", ({ event }) => event.stamp) },
                },
                c: {},
            },
        }),
        events: [{ type: "MUTATE" }],
    },
    {
        name: "xstate.init event shape: only `type` matters to actions (JSON view); the initial event never reaches later transitions",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.record("rootIn", ({ event }) => event),
            states: {
                a: {
                    entry: lib.record("aIn", ({ event }) => ({
                        type: event.type,
                        isInit: event.type === "xstate.init",
                    })),
                    on: { GO: "b" },
                },
                b: {},
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "xstate.init event keys: the init event carries an `input` key (undefined), exactly like XState",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.record("rootIn", ({ event }) => ({ keys: Object.keys(event), hasInput: "input" in event })),
            states: { a: {} },
        }),
        events: [],
    },
    {
        name: "xstate.init sent from outside: no transition is selected, not even a wildcard; always transitions are re-evaluated with it",
        config: (lib) => ({
            id: "m",
            context: { n: 0 },
            initial: "a",
            states: {
                a: {
                    // An explicit `"xstate.init"` handler would be just as dead in XState
                    // (no transition is selected for init); createMachine rejects it.
                    on: {
                        "*": { actions: lib.record("wildcard", ({ event }) => event.type) },
                        BUMP: { actions: lib.assign({ n: 1 }) },
                    },
                    always: {
                        guard: ({ context }: { context: { n: number } }) => context.n === 1,
                        target: "c",
                        actions: lib.record("alwaysToC", ({ event }) => event.type),
                    },
                },
                b: {},
                c: {},
            },
        }),
        events: [{ type: "xstate.init" }, { type: "OTHER" }, { type: "BUMP" }],
    },
    {
        name: "xstate.stop sent from outside stops the machine: no exit actions, later events ignored",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    exit: lib.record("aOut"),
                    on: {
                        "*": { actions: lib.record("wildcard", ({ event }) => event.type) },
                        GO: "b",
                    },
                },
                b: {},
            },
        }),
        events: [{ type: "xstate.stop" }, { type: "GO" }],
    },
    {
        name: "an event of type '*' puts the machine into error status with XState's message",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { "*": { actions: lib.record("wildcard") }, GO: "b" } },
                b: {},
            },
        }),
        events: [{ type: "*" }, { type: "GO" }],
    },
    {
        name: "partial wildcards against system events: root xstate.after.* / xstate.done.state.* catch timer and done events the states let through",
        config: (lib) => ({
            id: "m",
            initial: "c",
            on: {
                "xstate.after.*": { actions: lib.record("anyAfter", ({ event }) => event.type) },
                "xstate.done.state.*": { actions: lib.record("anyDone", ({ event }) => event) },
                "xstate.*": { actions: lib.record("anyXstate", ({ event }) => event.type) },
                "*": { actions: lib.record("star", ({ event }) => event.type) },
            },
            states: {
                c: {
                    initial: "c1",
                    states: {
                        c1: {
                            after: {
                                10: { guard: () => false, target: "cFinal", actions: lib.record("guardedAfter") },
                            },
                            on: { FINISH: "cFinal" },
                        },
                        cFinal: { type: "final", output: { fromFinal: true } },
                    },
                    onDone: { guard: () => false, actions: lib.record("guardedDone") },
                },
            },
        }),
        events: [{ advance: 10 }, { type: "FINISH" }, { type: "xstate.custom" }],
    },
    {
        name: "partial wildcard with as many tokens as the event: 'a.b.*' matches 'a.b' itself, 'a.*' matches 'a.b.c', 'ab' is not 'a.*'",
        config: (lib) => ({
            id: "m",
            initial: "s",
            states: {
                s: {
                    on: {
                        "a.b.*": { actions: lib.record("ab*", ({ event }) => event.type) },
                        "a.*": { actions: lib.record("a*", ({ event }) => event.type) },
                        "*": { actions: lib.record("*", ({ event }) => event.type) },
                    },
                },
            },
        }),
        events: [{ type: "a.b" }, { type: "a.b.c" }, { type: "a.x.c" }, { type: "a" }, { type: "ab" }],
    },
    {
        name: "empty-string event type is a plain event: matched by '*' only, never by an eventless transition slot",
        config: (lib) => ({
            id: "m",
            initial: "s",
            states: {
                s: {
                    on: { "*": { actions: lib.record("star", ({ event }) => JSON.stringify(event.type)) } },
                    always: { guard: () => false, target: "never" },
                },
                never: {},
            },
        }),
        events: [{ type: "" }],
    },
    {
        name: "can() with system event types: after / done event names are ordinary transitions, xstate.init and xstate.stop are never 'handled'",
        config: {
            id: "m",
            initial: "c",
            states: {
                c: {
                    initial: "c1",
                    states: {
                        c1: { after: { 100: "c2" }, on: { "*": "c2" } },
                        c2: { on: { FINISH: "cFinal" } },
                        cFinal: { type: "final" },
                    },
                    onDone: "done",
                },
                done: {},
            },
        },
        probes: {
            can: [
                { type: "xstate.after.100.m.c.c1" },
                { type: "xstate.done.state.m.c" },
                { type: "xstate.init" },
                { type: "xstate.stop" },
                { type: "anything" },
            ],
        },
        events: [{ type: "GO" }, { type: "FINISH" }],
    },
    {
        name: "params of a named action / guard are resolved per invocation from the current event and context",
        config: (lib) => ({
            id: "m",
            context: { base: 10 },
            initial: "s",
            states: {
                s: {
                    on: {
                        ADD: {
                            guard: {
                                type: "atLeast",
                                params: ({ event }: { event: { amount: number } }) => ({ min: event.amount }),
                            },
                            actions: [
                                {
                                    type: "recordSum",
                                    params: ({
                                        context,
                                        event,
                                    }: {
                                        context: { base: number };
                                        event: { amount: number };
                                    }) => ({
                                        sum: context.base + event.amount,
                                    }),
                                },
                                lib.assign({ base: ({ context }: { context: { base: number } }) => context.base + 1 }),
                                { type: "recordSum", params: { sum: "static" } },
                            ],
                        },
                    },
                },
            },
        }),
        implementations: (lib) => ({
            actions: { recordSum: lib.record("recordSum", (_args, params) => params) },
            guards: { atLeast: (_args: unknown, params: { min: number }) => params.min >= 5 },
        }),
        events: [
            { type: "ADD", amount: 3 },
            { type: "ADD", amount: 7 },
        ],
    },
];

describeScenarios("differential: adversarial events", scenarios);
