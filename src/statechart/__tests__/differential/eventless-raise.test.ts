/**
 * Round 1 differential scenarios: `always` (eventless) transitions, immediate
 * `raise` and the internal queue, re-entrant sends from actions.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "always with guards: routing state picks the first enabled eventless transition",
        config: (lib) => ({
            id: "m",
            context: { value: 0 },
            initial: "idle",
            states: {
                idle: {
                    on: { CHECK: { target: "check", actions: lib.assign({ value: ({ event }: any) => event.value }) } },
                },
                check: {
                    entry: lib.record("checkEntry"),
                    exit: lib.record("checkExit"),
                    always: [
                        {
                            target: "big",
                            guard: ({ context }: any) => context.value > 10,
                            actions: lib.record("toBig"),
                        },
                        { target: "small", guard: "isPositive", actions: lib.record("toSmall") },
                        { target: "zero", actions: lib.record("toZero") },
                    ],
                },
                big: { on: { RESET: "idle" } },
                small: { on: { RESET: "idle" } },
                zero: { on: { RESET: "idle" } },
            },
        }),
        implementations: () => ({ guards: { isPositive: ({ context }: any) => context.value > 0 } }),
        events: [
            { type: "CHECK", value: 42 },
            { type: "RESET" },
            { type: "CHECK", value: 3 },
            { type: "RESET" },
            { type: "CHECK", value: 0 },
        ],
    },
    {
        name: "always chain: several eventless hops inside one macrostep, entry/exit actions in order",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { entry: lib.record("aIn"), exit: lib.record("aOut"), on: { GO: "b" } },
                b: {
                    entry: lib.record("bIn"),
                    exit: lib.record("bOut"),
                    always: { target: "c", actions: lib.record("bc") },
                },
                c: { entry: lib.record("cIn"), exit: lib.record("cOut"), always: "d" },
                d: { entry: lib.record("dIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "always at initialization: the initial snapshot is already past the eventless states",
        config: (lib) => ({
            id: "m",
            context: { skip: true },
            initial: "a",
            states: {
                a: {
                    entry: lib.record("aIn"),
                    always: [{ target: "b", guard: ({ context }: any) => context.skip }],
                },
                b: { entry: lib.record("bIn"), always: "c" },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [],
    },
    {
        name: "always re-evaluated after a targetless transition changed the context",
        config: (lib) => ({
            id: "m",
            context: { count: 0 },
            initial: "counting",
            states: {
                counting: {
                    on: { INC: { actions: lib.assign({ count: ({ context }: any) => context.count + 1 }) } },
                    always: { target: "done", guard: ({ context }: any) => context.count >= 2 },
                },
                done: { entry: lib.record("doneIn", ({ context }) => context.count) },
            },
        }),
        events: [{ type: "INC" }, { type: "INC" }, { type: "INC" }],
    },
    {
        name: "targetless always with a guard: runs its actions until the guard fails",
        config: (lib) => ({
            id: "m",
            context: { pending: 0 },
            initial: "a",
            states: {
                a: {
                    on: { LOAD: { actions: lib.assign({ pending: 3 }) } },
                    always: {
                        guard: ({ context }: any) => context.pending > 0,
                        actions: [
                            lib.record("drain", ({ context }) => context.pending),
                            lib.assign({ pending: ({ context }: any) => context.pending - 1 }),
                        ],
                    },
                },
            },
        }),
        events: [{ type: "LOAD" }],
    },
    {
        name: "always on a parent is evaluated for the active leaf; child always wins over parent always",
        config: (lib) => ({
            id: "m",
            context: { flag: false },
            initial: "p",
            states: {
                p: {
                    initial: "x",
                    states: {
                        x: { on: { NEXT: "y" } },
                        y: {
                            always: {
                                target: "z",
                                guard: ({ context }: any) => context.flag,
                                actions: lib.record("childAlways"),
                            },
                        },
                        z: {},
                    },
                    on: { FLAG: { actions: lib.assign({ flag: true }) } },
                    always: {
                        target: "out",
                        guard: ({ context }: any) => context.flag,
                        actions: lib.record("parentAlways"),
                    },
                },
                out: {},
            },
        }),
        events: [{ type: "NEXT" }, { type: "FLAG" }],
    },
    {
        name: "raise immediate: processed after the current macrostep's actions, before externally queued events",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            actions: [lib.record("goStart"), lib.raise({ type: "RAISED" }), lib.record("goEnd")],
                        },
                        RAISED: { target: "b", actions: lib.record("raisedHandled") },
                    },
                },
                b: { entry: lib.record("bIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "raise chain: a raised event raises another; value and actions settle within one send",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", actions: lib.raise({ type: "B_DONE" }) } } },
                b: {
                    entry: lib.record("bIn"),
                    on: { B_DONE: { target: "c", actions: [lib.record("bDone"), lib.raise({ type: "C_DONE" })] } },
                },
                c: { entry: lib.record("cIn"), on: { C_DONE: { target: "d", actions: lib.record("cDone") } } },
                d: { entry: lib.record("dIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "raise with an event expression sees the causing event and context",
        config: (lib) => ({
            id: "m",
            context: { tag: "ctx" },
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            actions: lib.raise(({ context, event }: any) => ({
                                type: "ECHO",
                                from: event.type,
                                tag: context.tag,
                            })),
                        },
                        ECHO: { target: "b", actions: lib.record("echo", ({ event }) => event) },
                    },
                },
                b: {},
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "raise in entry actions: the entered state immediately moves on",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: "b" } },
                b: {
                    entry: [lib.record("bIn"), lib.raise({ type: "AUTO" })],
                    exit: lib.record("bOut"),
                    on: { AUTO: "c" },
                },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "raise from the implementation table with params",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: { actions: { type: "notify", params: { kind: "PING" } } },
                        PING: "b",
                    },
                },
                b: {},
            },
        },
        implementations: (lib) => ({
            actions: { notify: lib.raise((_args: any, params: any) => ({ type: params.kind })) },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "raise at initialization: an initial entry raise is processed before the first snapshot",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: lib.raise({ type: "BOOT" }),
            states: {
                a: { entry: lib.record("aIn"), on: { BOOT: { target: "b", actions: lib.record("boot") } } },
                b: { entry: lib.record("bIn") },
            },
        }),
        events: [],
    },
    {
        name: "re-entrant send from an action is queued behind the current macrostep and behind raised events",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            actions: [
                                () => lib.send({ type: "EXTERNAL" }),
                                lib.raise({ type: "RAISED" }),
                                lib.record("goDone"),
                            ],
                        },
                        RAISED: { target: "b", actions: lib.record("raised") },
                        EXTERNAL: { actions: lib.record("externalInA") },
                    },
                },
                b: { on: { EXTERNAL: { target: "c", actions: lib.record("externalInB") } } },
                c: {},
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "an initial entry action sends an event; later initial entry actions run before it is processed",
        config: (lib) => ({
            id: "m",
            initial: "a",
            entry: [() => lib.send({ type: "KICK" }), lib.record("rootEntryAfterSend")],
            states: {
                a: {
                    entry: lib.record("aIn"),
                    on: { KICK: { target: "b", actions: lib.record("kick") } },
                },
                b: { entry: lib.record("bIn") },
            },
        }),
        events: [],
    },
    {
        name: "raised event with no matching transition is dropped silently",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", actions: lib.raise({ type: "UNKNOWN" }) } } },
                b: { entry: lib.record("bIn"), on: { NEXT: "c" } },
                c: {},
            },
        }),
        events: [{ type: "GO" }, { type: "NEXT" }],
    },
];

describeScenarios("differential: always & raise", scenarios);
