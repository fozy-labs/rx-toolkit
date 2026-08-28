/**
 * Round 1 differential scenarios: guards — string, `{ type, params }`, inline,
 * `and` / `or` / `not` / `stateIn`, guarded arrays and guard errors.
 */
import { describeScenarios, type Scenario } from "./harness";

const scenarios: Scenario[] = [
    {
        name: "string guard: taken only when the predicate passes, context-driven",
        config: (lib) => ({
            id: "m",
            context: { ready: false },
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: { target: "b", guard: "isReady", actions: lib.record("go") },
                        ARM: { actions: lib.assign({ ready: true }) },
                    },
                },
                b: {},
            },
        }),
        implementations: () => ({
            guards: { isReady: ({ context }: any) => context.ready },
        }),
        events: [{ type: "GO" }, { type: "ARM" }, { type: "GO" }],
    },
    {
        name: "guard params: static and dynamic params, params read alongside event",
        config: (lib) => ({
            id: "m",
            context: { limit: 3 },
            initial: "a",
            states: {
                a: {
                    on: {
                        CHECK: [
                            { target: "big", guard: { type: "gt", params: { than: 10 } } },
                            {
                                target: "medium",
                                guard: { type: "gt", params: ({ context }: any) => ({ than: context.limit }) },
                            },
                            { target: "small", actions: lib.record("fallback") },
                        ],
                    },
                },
                big: { on: { RESET: "a" } },
                medium: { on: { RESET: "a" } },
                small: { on: { RESET: "a" } },
            },
        }),
        implementations: (lib) => ({
            guards: {
                gt: ({ event }: any, params: any) => {
                    lib.record("gt", () => ({ value: event.value, params }))({}, undefined);
                    return event.value > params.than;
                },
            },
        }),
        events: [
            { type: "CHECK", value: 11 },
            { type: "RESET" },
            { type: "CHECK", value: 5 },
            { type: "RESET" },
            { type: "CHECK", value: 1 },
        ],
    },
    {
        name: "inline guard functions receive { context, event }",
        config: (lib) => ({
            id: "m",
            context: { min: 5 },
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            target: "b",
                            guard: ({ context, event }: any) => event.value >= context.min,
                            actions: lib.record("go"),
                        },
                    },
                },
                b: { on: { BACK: "a" } },
            },
        }),
        events: [{ type: "GO", value: 1 }, { type: "GO", value: 5 }, { type: "BACK" }, { type: "GO", value: 9 }],
    },
    {
        name: "guarded array: first enabled wins; a fully guarded array leaves the event unhandled by that node",
        config: (lib) => ({
            id: "m",
            context: { mode: "none" },
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: {
                            on: {
                                GO: [
                                    { target: "b", guard: "isB", actions: lib.record("toB") },
                                    { target: "c", guard: "isC", actions: lib.record("toC") },
                                ],
                                SET_B: { actions: lib.assign({ mode: "b" }) },
                                SET_C: { actions: lib.assign({ mode: "c" }) },
                            },
                        },
                        b: { on: { BACK: "a" } },
                        c: { on: { BACK: "a" } },
                    },
                    on: { GO: { target: "fallback", actions: lib.record("parentGo") } },
                },
                fallback: {},
            },
        }),
        implementations: () => ({
            guards: {
                isB: ({ context }: any) => context.mode === "b",
                isC: ({ context }: any) => context.mode === "c",
            },
        }),
        events: [
            { type: "SET_C" },
            { type: "GO" },
            { type: "BACK" },
            { type: "SET_B" },
            { type: "GO" },
            { type: "BACK" },
            { type: "SET_B" },
            { type: "SET_C" },
            { type: "GO" },
        ],
    },
    {
        name: "forbidden transition: an unguarded targetless, action-less child transition shadows the parent",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { EV: {}, NEXT: "b" } },
                        b: { on: { EV: { guard: () => false }, NEXT: "a" } },
                    },
                    on: { EV: { target: "out", actions: lib.record("parentEv") } },
                },
                out: {},
            },
        }),
        events: [{ type: "EV" }, { type: "NEXT" }, { type: "EV" }],
    },
    {
        name: "composite guards inline: and / or / not over strings, inline predicates and params",
        config: (lib) => ({
            id: "m",
            context: { a: true, b: false, n: 4 },
            initial: "idle",
            states: {
                idle: {
                    on: {
                        AND: { target: "hit", guard: lib.and(["isA", ({ context }: any) => context.n > 3]) },
                        AND_FAIL: { target: "hit", guard: lib.and(["isA", "isB"]) },
                        OR: { target: "hit", guard: lib.or(["isB", { type: "nAbove", params: { than: 3 } }]) },
                        OR_FAIL: { target: "hit", guard: lib.or(["isB", { type: "nAbove", params: { than: 10 } }]) },
                        NOT: { target: "hit", guard: lib.not("isB") },
                        NOT_FAIL: { target: "hit", guard: lib.not(lib.and(["isA", lib.not("isB")])) },
                        NESTED: {
                            target: "hit",
                            guard: lib.or([lib.and(["isB", "isA"]), lib.not(lib.or(["isB", () => false]))]),
                        },
                    },
                },
                hit: { on: { RESET: "idle" } },
            },
        }),
        implementations: (lib) => ({
            guards: {
                isA: ({ context }: any) => {
                    lib.record("isA")({}, undefined);
                    return context.a;
                },
                isB: ({ context }: any) => {
                    lib.record("isB")({}, undefined);
                    return context.b;
                },
                nAbove: ({ context }: any, params: any) => context.n > params.than,
            },
        }),
        events: [
            { type: "AND_FAIL" },
            { type: "AND" },
            { type: "RESET" },
            { type: "OR_FAIL" },
            { type: "OR" },
            { type: "RESET" },
            { type: "NOT_FAIL" },
            { type: "NOT" },
            { type: "RESET" },
            { type: "NESTED" },
        ],
    },
    {
        name: "composite guards from the implementation table: named guards implemented as and / or / not",
        config: {
            id: "m",
            context: { a: true, b: false },
            initial: "idle",
            states: {
                idle: {
                    on: {
                        BOTH: { target: "hit", guard: "both" },
                        EITHER: { target: "hit", guard: "either" },
                        NEITHER: { target: "hit", guard: "neither" },
                    },
                },
                hit: { on: { RESET: "idle" } },
            },
        },
        implementations: (lib) => ({
            guards: {
                isA: ({ context }: any) => context.a,
                isB: ({ context }: any) => context.b,
                both: lib.and(["isA", "isB"]),
                either: lib.or(["isA", "isB"]),
                neither: lib.not(lib.or(["isA", "isB"])),
            },
        }),
        events: [{ type: "BOTH" }, { type: "NEITHER" }, { type: "EITHER" }],
    },
    {
        name: "stateIn: '#id', string path and object value across parallel regions",
        config: (lib) => ({
            id: "m",
            type: "parallel",
            states: {
                left: {
                    initial: "l1",
                    states: {
                        l1: { on: { L: "l2" } },
                        l2: { on: { L: "l1" } },
                    },
                },
                right: {
                    initial: "r1",
                    states: {
                        r1: {
                            on: {
                                CHECK_ID: { target: "r2", guard: lib.stateIn("#m.left.l2") },
                                CHECK_PATH: { target: "r2", guard: lib.stateIn({ left: "l2" }) },
                                CHECK_NOT: { target: "r2", guard: lib.not(lib.stateIn("#m.left.l2")) },
                            },
                        },
                        r2: { on: { R: "r1" } },
                    },
                },
            },
        }),
        events: [
            { type: "CHECK_ID" },
            { type: "CHECK_PATH" },
            { type: "CHECK_NOT" },
            { type: "R" },
            { type: "L" },
            { type: "CHECK_NOT" },
            { type: "CHECK_ID" },
            { type: "R" },
            { type: "CHECK_PATH" },
        ],
    },
    {
        name: "stateIn inside a compound machine with string state paths",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { NEXT: "b" } },
                        b: { on: { NEXT: "a" } },
                    },
                    on: {
                        // XState resolves stateIn against the full state value.
                        CHECK: { target: "done", guard: lib.stateIn("p.b") },
                        CHECK_OBJ: { target: "done", guard: lib.stateIn({ p: "a" }) },
                    },
                },
                done: {},
            },
        }),
        events: [{ type: "CHECK" }, { type: "NEXT" }, { type: "CHECK_OBJ" }, { type: "CHECK" }],
    },
    {
        name: "guards evaluated in order: a guard sees context updated by earlier events, not by the same event",
        config: (lib) => ({
            id: "m",
            context: { count: 0 },
            initial: "a",
            states: {
                a: {
                    on: {
                        INC: {
                            actions: [
                                lib.assign({ count: ({ context }: any) => context.count + 1 }),
                                lib.record("inc"),
                            ],
                        },
                        GO: [
                            { target: "b", guard: ({ context }: any) => context.count >= 2 },
                            { actions: lib.assign({ count: ({ context }: any) => context.count + 1 }) },
                        ],
                    },
                },
                b: {},
            },
        }),
        events: [{ type: "GO" }, { type: "INC" }, { type: "GO" }, { type: "GO" }],
    },
    {
        name: "a throwing guard puts the machine into error status with XState's wrapper message",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        NAMED: { target: "b", guard: "boom" },
                        INLINE: {
                            target: "b",
                            guard: () => {
                                throw new Error("inline boom");
                            },
                        },
                        SAFE: { target: "b", actions: lib.record("safe") },
                    },
                },
                b: {},
            },
        }),
        implementations: () => ({
            guards: {
                boom: () => {
                    throw new Error("named boom");
                },
            },
        }),
        events: [{ type: "NAMED" }, { type: "SAFE" }],
    },
    {
        name: "a throwing inline guard: wrapper message without a guard name",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        INLINE: {
                            target: "b",
                            guard: () => {
                                throw new Error("inline boom");
                            },
                        },
                    },
                },
                b: {},
            },
        },
        events: [{ type: "INLINE" }, { type: "INLINE" }],
    },
    {
        name: "guard truthiness: non-boolean return values are coerced",
        config: {
            id: "m",
            context: { value: 0 },
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: { target: "b", guard: ({ event }: any) => event.value },
                    },
                },
                b: { on: { BACK: "a" } },
            },
        },
        events: [
            { type: "GO", value: 0 },
            { type: "GO", value: "" },
            { type: "GO", value: null },
            { type: "GO", value: "yes" },
            { type: "BACK" },
            { type: "GO", value: 1 },
        ],
    },
];

describeScenarios("differential: guards", scenarios);
