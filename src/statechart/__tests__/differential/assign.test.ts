/**
 * Round 1 differential scenarios: `assign` — object form, function form,
 * ordering relative to other actions, params, initial context.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "assign object form: static values and per-property functions of { context, event }",
        config: (lib) => ({
            id: "m",
            context: { count: 0, label: "", last: null },
            initial: "a",
            states: {
                a: {
                    on: {
                        SET: {
                            actions: lib.assign({
                                count: ({ context }: any) => context.count + 1,
                                label: "static",
                                last: ({ event }: any) => event.payload,
                            }),
                        },
                    },
                },
            },
        }),
        events: [
            { type: "SET", payload: "x" },
            { type: "SET", payload: { nested: true } },
        ],
    },
    {
        name: "assign function form: returns a partial that is shallow-merged",
        config: (lib) => ({
            id: "m",
            context: { a: 1, b: { deep: 1 }, c: "keep" },
            initial: "s",
            states: {
                s: {
                    on: {
                        GO: {
                            actions: lib.assign(({ context, event }: any) => ({
                                a: context.a + event.by,
                                b: { deep: context.b.deep + 1 },
                            })),
                        },
                    },
                },
            },
        }),
        events: [
            { type: "GO", by: 10 },
            { type: "GO", by: 1 },
        ],
    },
    {
        name: "assign ordering: later actions in the same list see the assigned context; exits see the old one",
        config: (lib) => ({
            id: "m",
            context: { n: 0 },
            initial: "a",
            states: {
                a: {
                    exit: [lib.record("aExit", ({ context }) => context.n), lib.assign({ n: 100 })],
                    on: {
                        GO: {
                            target: "b",
                            actions: [
                                lib.record("before", ({ context }) => context.n),
                                lib.assign({ n: ({ context }: any) => context.n + 1 }),
                                lib.record("between", ({ context }) => context.n),
                                lib.assign({ n: ({ context }: any) => context.n * 2 }),
                                lib.record("after", ({ context }) => context.n),
                            ],
                        },
                    },
                },
                b: {
                    entry: [lib.record("bEntry", ({ context }) => context.n), lib.assign({ n: -1 })],
                },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "assign with params through the implementation table",
        config: {
            id: "m",
            context: { total: 0 },
            initial: "a",
            states: {
                a: {
                    entry: { type: "add", params: { by: 5 } },
                    on: {
                        ADD: { actions: { type: "add", params: ({ event }: any) => ({ by: event.by }) } },
                        ADD_TWICE: {
                            actions: [
                                { type: "add", params: { by: 1 } },
                                { type: "add", params: { by: 2 } },
                            ],
                        },
                    },
                },
            },
        },
        implementations: (lib) => ({
            actions: {
                add: lib.assign(({ context }: any, params: any) => ({ total: context.total + params.by })),
            },
        }),
        events: [{ type: "ADD", by: 7 }, { type: "ADD_TWICE" }],
    },
    {
        name: "assign in initial entry actions: the initial snapshot already holds the assigned context",
        config: (lib) => ({
            id: "m",
            context: { init: false, nested: 0 },
            initial: "a",
            entry: lib.assign({ init: true }),
            states: {
                a: {
                    initial: "a1",
                    entry: lib.assign({ nested: ({ context }: any) => context.nested + 1 }),
                    states: {
                        a1: { entry: lib.assign({ nested: ({ context }: any) => context.nested + 10 }) },
                    },
                },
            },
        }),
        events: [],
    },
    {
        name: "assign never mutates the previous context object; unchanged context after a no-op event",
        config: (lib) => ({
            id: "m",
            context: { items: [] as string[] },
            initial: "a",
            states: {
                a: {
                    on: {
                        PUSH: {
                            actions: lib.assign({ items: ({ context, event }: any) => [...context.items, event.item] }),
                        },
                        NOOP: { actions: lib.record("noop", ({ context }) => context.items) },
                    },
                },
            },
        }),
        events: [{ type: "PUSH", item: "x" }, { type: "NOOP" }, { type: "PUSH", item: "y" }],
    },
    {
        name: "assign interleaved with raise: the raised event's handlers see the assigned context",
        config: (lib) => ({
            id: "m",
            context: { step: 0 },
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            actions: [
                                lib.assign({ step: 1 }),
                                lib.raise({ type: "NEXT" }),
                                lib.assign({ step: 2 }),
                                lib.record("goDone", ({ context }) => context.step),
                            ],
                        },
                        NEXT: {
                            target: "b",
                            actions: [
                                lib.record("nextSeen", ({ context }) => context.step),
                                lib.assign({ step: ({ context }: any) => context.step + 10 }),
                            ],
                        },
                    },
                },
                b: { entry: lib.record("bEntry", ({ context }) => context.step) },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "assign object form with a property returning undefined keeps the key",
        config: (lib) => ({
            id: "m",
            context: { a: 1, b: 2 },
            initial: "s",
            states: {
                s: { on: { CLEAR: { actions: lib.assign({ a: () => undefined }) } } },
            },
        }),
        events: [{ type: "CLEAR" }],
    },
];

describeScenarios("differential: assign", scenarios);
