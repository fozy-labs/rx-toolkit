import { assign, cancel, log, mutate, raise } from "../actions";
import { unstable_createMachine as createMachine } from "../createMachine";
import { and, not, or, stateIn } from "../guards";
import type { EventObject, MachineConfig, MachineContext } from "../types";

import { toXStateSource } from "./toXStateSource";

interface TrafficContext {
    ready: boolean;
    count: number;
}

type TrafficEvent = { type: "TIMER" } | { type: "RESET" } | { type: "user.click"; x: number };

function warn(): void {}
function isReady({ context }: { context: TrafficContext }): boolean {
    return context.ready;
}

function createTrafficLight() {
    return createMachine(
        {
            id: "trafficLight",
            initial: "green",
            context: { ready: false, count: 0 },
            types: {} as { context: TrafficContext; events: TrafficEvent },
            states: {
                green: { after: { 3000: "yellow" } },
                yellow: { on: { TIMER: { target: "red", guard: "isReady", actions: "warn" } } },
                red: { on: { TIMER: "green" } },
            },
        },
        {
            actions: { warn },
            guards: { isReady },
            delays: {},
        },
    );
}

/**
 * Evaluates the generated module body as plain JavaScript: every free
 * identifier resolves through a `with` scope, `createMachine` and the builtin
 * creators are recorded as calls. Proves the output is syntactically valid and
 * round-trips the data.
 */
function evaluate(source: string): { config: unknown; implementations: unknown } {
    const body = source.replace(/^import [^\n]*\n\n/, "").replace(/^export const /, "const ");
    const exportName = /^const (\w+) =/.exec(body)?.[1];
    if (exportName === undefined) throw new Error(`No export in:\n${source}`);
    const creators = new Set(["assign", "raise", "cancel", "log", "and", "or", "not", "stateIn"]);
    const scope = new Proxy(
        {},
        {
            has: () => true,
            get: (_target, key) => {
                if (typeof key !== "string") return undefined;
                if (key === "createMachine") {
                    return (config: unknown, implementations: unknown) => ({ config, implementations });
                }
                if (creators.has(key)) return (...args: unknown[]) => ({ call: key, args });
                return { identifier: key };
            },
        },
    );
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- test-only: proves the output parses as JS
    const run = new Function("scope", `with (scope) { ${body} return ${exportName}; }`) as (scope: object) => {
        config: unknown;
        implementations: unknown;
    };
    return run(scope);
}

describe("toXStateSource", () => {
    it("renders the canonical traffic light exactly", () => {
        expect(toXStateSource(createTrafficLight())).toBe(
            [
                'import { createMachine } from "xstate";',
                "",
                "export const trafficLight = createMachine({",
                '    id: "trafficLight",',
                '    initial: "green",',
                "    context: {",
                "        ready: false,",
                "        count: 0,",
                "    },",
                "    states: {",
                "        green: {",
                "            after: {",
                '                3000: "yellow",',
                "            },",
                "        },",
                "        yellow: {",
                "            on: {",
                "                TIMER: {",
                '                    target: "red",',
                '                    guard: "isReady",',
                '                    actions: "warn",',
                "                },",
                "            },",
                "        },",
                "        red: {",
                "            on: {",
                '                TIMER: "green",',
                "            },",
                "        },",
                "    },",
                "});",
                "",
            ].join("\n"),
        );
    });

    it("is deterministic", () => {
        const definition = createTrafficLight();
        expect(toXStateSource(definition)).toBe(toXStateSource(definition));
        expect(definition.toXStateSource()).toBe(toXStateSource(definition));
    });

    it("drops `types`, skips `undefined` properties and never emits `satisfies`", () => {
        const source = toXStateSource(createTrafficLight());
        expect(source).not.toContain("types");
        expect(source).not.toContain("satisfies");
        const withUndefined = createMachine({
            id: "u",
            initial: "a",
            states: { a: { description: undefined, on: { E: { target: undefined, actions: "x" } } } },
        });
        expect(toXStateSource(withUndefined, { includeImport: false })).toBe(
            [
                "export const u = createMachine({",
                '    id: "u",',
                '    initial: "a",',
                "    states: {",
                "        a: {",
                "            on: {",
                "                E: {",
                '                    actions: "x",',
                "                },",
                "            },",
                "        },",
                "    },",
                "});",
                "",
            ].join("\n"),
        );
    });

    it("evaluates as JavaScript back to the config", () => {
        const definition = createTrafficLight();
        const { config, implementations } = evaluate(toXStateSource(definition, { includeImplementations: true }));
        expect(config).toEqual({
            id: "trafficLight",
            initial: "green",
            context: { ready: false, count: 0 },
            states: {
                green: { after: { 3000: "yellow" } },
                yellow: { on: { TIMER: { target: "red", guard: "isReady", actions: "warn" } } },
                red: { on: { TIMER: "green" } },
            },
        });
        expect(implementations).toEqual({
            actions: { warn: { identifier: "warn" } },
            guards: { isReady: { identifier: "isReady" } },
        });
    });

    describe("import line", () => {
        it("lists only the builtins actually used, in a fixed order", () => {
            const definition = createMachine({
                initial: "a",
                states: {
                    a: {
                        entry: [log("hi"), assign({ n: 1 })],
                        on: { E: { guard: not("g"), target: "b" } },
                    },
                    b: {},
                },
            });
            expect(toXStateSource(definition).split("\n")[0]).toBe(
                'import { createMachine, assign, log, not } from "xstate";',
            );
        });

        it("counts builtins used inside the implementation table only when it is rendered", () => {
            const definition = createMachine(
                { initial: "a", states: { a: { on: { E: { actions: "bump" } } } } },
                { actions: { bump: assign({ n: 1 }) } },
            );
            expect(toXStateSource(definition).split("\n")[0]).toBe('import { createMachine } from "xstate";');
            expect(toXStateSource(definition, { includeImplementations: true }).split("\n")[0]).toBe(
                'import { createMachine, assign } from "xstate";',
            );
        });

        it("imports mutate() from this package on a second line, as it has no XState counterpart", () => {
            const definition = createMachine(
                { initial: "a", states: { a: { entry: mutate(function bump() {}), on: { E: { actions: "reset" } } } } },
                { actions: { reset: mutate(() => undefined) } },
            );
            const source = toXStateSource(definition, { includeImplementations: true });
            expect(source.split("\n").slice(0, 3)).toEqual([
                'import { createMachine } from "xstate";',
                'import { mutate } from "@fozy-labs/rx-toolkit";',
                "",
            ]);
            expect(source).toContain("entry: mutate(bump),");
            expect(source).toContain("reset: mutate(anonymous),");
            expect(toXStateSource(createMachine({ initial: "a", states: { a: {} } }))).not.toContain("rx-toolkit");
        });

        it("drops `source` (the .mmd text) like `types`", () => {
            const definition = createMachine({
                initial: "a",
                source: "stateDiagram-v2\n    [*] --> a\n",
                types: {},
                states: { a: {} },
            });
            expect(toXStateSource(definition, { includeImport: false })).toBe(
                [
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    states: {",
                    "        a: {},",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("can be omitted", () => {
            const source = toXStateSource(createTrafficLight(), { includeImport: false });
            expect(source.startsWith("export const trafficLight = createMachine({")).toBe(true);
            expect(source).not.toContain("import");
        });
    });

    describe("export name", () => {
        function firstLine(config: MachineConfig<MachineContext, EventObject>, exportName?: string) {
            return toXStateSource(createMachine(config), { includeImport: false, exportName }).split("\n")[0];
        }

        it("defaults to the machine id turned into an identifier", () => {
            expect(firstLine({ id: "trafficLight", initial: "a", states: { a: {} } })).toBe(
                "export const trafficLight = createMachine({",
            );
            expect(firstLine({ id: "my-machine v2", initial: "a", states: { a: {} } })).toBe(
                "export const my_machine_v2 = createMachine({",
            );
            expect(firstLine({ id: "1st", initial: "a", states: { a: {} } })).toBe(
                "export const _1st = createMachine({",
            );
            expect(firstLine({ id: "default", initial: "a", states: { a: {} } })).toBe(
                "export const _default = createMachine({",
            );
        });

        it("falls back to `machine` when the id is missing or unusable", () => {
            expect(firstLine({ initial: "a", states: { a: {} } })).toBe("export const machine = createMachine({");
            expect(firstLine({ id: "()", initial: "a", states: { a: {} } })).toBe(
                "export const machine = createMachine({",
            );
        });

        it("uses (and sanitizes) an explicit name", () => {
            expect(firstLine({ id: "x", initial: "a", states: { a: {} } }, "lightMachine")).toBe(
                "export const lightMachine = createMachine({",
            );
            expect(firstLine({ id: "x", initial: "a", states: { a: {} } }, "light machine")).toBe(
                "export const light_machine = createMachine({",
            );
        });
    });

    describe("keys and scalars", () => {
        it("quotes keys that are not identifiers, keeps canonical integers bare", () => {
            const definition = createMachine({
                initial: "a",
                states: {
                    a: {
                        on: { "user.*": "b", "*": "a", E: "b" },
                        after: { 3000: "b", 0: "b", SHORT: "b", "01": "b" },
                        meta: { "with space": 1, $ok: 2, _ok: 3 },
                    },
                    b: {},
                },
            });
            expect(toXStateSource(definition, { includeImport: false })).toBe(
                [
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    states: {",
                    "        a: {",
                    "            on: {",
                    '                "user.*": "b",',
                    '                "*": "a",',
                    '                E: "b",',
                    "            },",
                    "            after: {",
                    '                0: "b",',
                    '                3000: "b",',
                    '                SHORT: "b",',
                    '                "01": "b",',
                    "            },",
                    "            meta: {",
                    '                "with space": 1,',
                    "                $ok: 2,",
                    "                _ok: 3,",
                    "            },",
                    "        },",
                    "        b: {},",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("renders strings with escapes and every scalar literally", () => {
            const definition = createMachine({
                initial: "a",
                context: { s: 'say "hi"\n', n: -1.5, big: 10n, t: true, nothing: null },
                states: { a: { description: "line 1\\line 2" } },
            });
            expect(toXStateSource(definition, { includeImport: false })).toBe(
                [
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    context: {",
                    '        s: "say \\"hi\\"\\n",',
                    "        n: -1.5,",
                    "        big: 10n,",
                    "        t: true,",
                    "        nothing: null,",
                    "    },",
                    "    states: {",
                    "        a: {",
                    '            description: "line 1\\\\line 2",',
                    "        },",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("keeps short scalar arrays on one line and breaks long or nested ones", () => {
            const definition = createMachine({
                initial: "a",
                states: {
                    a: {
                        tags: ["x", "y"],
                        entry: ["a", { type: "b", params: { level: 1 } }],
                        on: { E: ["b", { target: "a", guard: "g" }] },
                        meta: {
                            long: Array.from({ length: 12 }, (_, index) => `item-${index}`),
                            nested: [[1, 2], []],
                        },
                    },
                    b: {},
                },
            });
            expect(toXStateSource(definition, { includeImport: false })).toBe(
                [
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    states: {",
                    "        a: {",
                    '            tags: ["x", "y"],',
                    "            entry: [",
                    '                "a",',
                    "                {",
                    '                    type: "b",',
                    "                    params: {",
                    "                        level: 1,",
                    "                    },",
                    "                },",
                    "            ],",
                    "            on: {",
                    "                E: [",
                    '                    "b",',
                    "                    {",
                    '                        target: "a",',
                    '                        guard: "g",',
                    "                    },",
                    "                ],",
                    "            },",
                    "            meta: {",
                    "                long: [",
                    '                    "item-0",',
                    '                    "item-1",',
                    '                    "item-2",',
                    '                    "item-3",',
                    '                    "item-4",',
                    '                    "item-5",',
                    '                    "item-6",',
                    '                    "item-7",',
                    '                    "item-8",',
                    '                    "item-9",',
                    '                    "item-10",',
                    '                    "item-11",',
                    "                ],",
                    "                nested: [[1, 2], []],",
                    "            },",
                    "        },",
                    "        b: {},",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("honours a custom indent", () => {
            expect(toXStateSource(createTrafficLight(), { includeImport: false, indent: 2 })).toContain(
                '  states: {\n    green: {\n      after: {\n        3000: "yellow",\n      },\n    },',
            );
        });

        it("rejects an invalid indent", () => {
            expect(() => toXStateSource(createTrafficLight(), { indent: -1 })).toThrow(RangeError);
            expect(() => toXStateSource(createTrafficLight(), { indent: 1.5 })).toThrow(RangeError);
        });
    });

    describe("functions and builtins", () => {
        it("renders functions as their names and nameless ones as `anonymous`", () => {
            const definition = createMachine(
                {
                    initial: "a",
                    context: () => ({ n: 0 }),
                    states: {
                        a: {
                            entry: warn,
                            exit: [() => {}, function named() {}],
                            on: { E: { guard: ({ context }) => context.n > 0, actions: () => {} } },
                        },
                    },
                },
                {
                    guards: {
                        anon: (
                            () => () =>
                                true
                        )(),
                    },
                },
            );
            expect(toXStateSource(definition, { includeImport: false, includeImplementations: true })).toBe(
                [
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    context: context,",
                    "    states: {",
                    "        a: {",
                    "            entry: warn,",
                    "            exit: [anonymous, named],",
                    "            on: {",
                    "                E: {",
                    "                    guard: guard,",
                    "                    actions: actions,",
                    "                },",
                    "            },",
                    "        },",
                    "    },",
                    "}, {",
                    "    guards: {",
                    "        anon: anonymous,",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("sanitizes function names that are not identifiers", () => {
            const bound = warn.bind(null);
            const definition = createMachine({ initial: "a", states: { a: { entry: bound } } });
            expect(toXStateSource(definition, { includeImport: false })).toContain("entry: bound_warn,");
        });

        it("renders every builtin action in its call form", () => {
            const definition = createMachine({
                initial: "a",
                context: { n: 0 },
                states: {
                    a: {
                        entry: [
                            assign({ n: 1 }),
                            assign(({ context }) => ({ n: context.n + 1 })),
                            assign({ n: ({ context }) => context.n * 2 }),
                            raise({ type: "E" }),
                            raise({ type: "E" }, { delay: 100 }),
                            raise({ type: "E" }, { id: "later", delay: "SHORT" }),
                            raise(() => ({ type: "E" }), { delay: ({ context }) => context.n }),
                            cancel("later"),
                            cancel(() => "later"),
                            log("hello"),
                            log("hello", "label"),
                            log(({ context }) => context.n),
                        ],
                        on: { E: {} },
                    },
                },
            });
            expect(toXStateSource(definition)).toBe(
                [
                    'import { createMachine, assign, raise, cancel, log } from "xstate";',
                    "",
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    context: {",
                    "        n: 0,",
                    "    },",
                    "    states: {",
                    "        a: {",
                    "            entry: [",
                    "                assign({",
                    "                    n: 1,",
                    "                }),",
                    "                assign(anonymous),",
                    "                assign({",
                    "                    n: n,",
                    "                }),",
                    "                raise({",
                    '                    type: "E",',
                    "                }),",
                    "                raise({",
                    '                    type: "E",',
                    "                }, {",
                    "                    delay: 100,",
                    "                }),",
                    "                raise({",
                    '                    type: "E",',
                    "                }, {",
                    '                    id: "later",',
                    '                    delay: "SHORT",',
                    "                }),",
                    "                raise(anonymous, {",
                    "                    delay: delay,",
                    "                }),",
                    '                cancel("later"),',
                    "                cancel(anonymous),",
                    '                log("hello"),',
                    '                log("hello", "label"),',
                    "                log(anonymous),",
                    "            ],",
                    "            on: {",
                    "                E: {},",
                    "            },",
                    "        },",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("renders every builtin guard in its call form", () => {
            const definition = createMachine({
                id: "machine",
                initial: "a",
                states: {
                    a: {
                        on: {
                            E: [
                                { target: "b", guard: and(["g1", { type: "g2", params: { x: 1 } }]) },
                                { target: "b", guard: or(["g1", not("g2")]) },
                                { target: "b", guard: stateIn("#machine.b") },
                                { target: "b", guard: stateIn({ b: "c" }) },
                                { target: "b", guard: not(({ context }) => context.ok === true) },
                            ],
                        },
                    },
                    b: {},
                },
            });
            expect(toXStateSource(definition)).toBe(
                [
                    'import { createMachine, and, or, not, stateIn } from "xstate";',
                    "",
                    "export const machine = createMachine({",
                    '    id: "machine",',
                    '    initial: "a",',
                    "    states: {",
                    "        a: {",
                    "            on: {",
                    "                E: [",
                    "                    {",
                    '                        target: "b",',
                    "                        guard: and([",
                    '                            "g1",',
                    "                            {",
                    '                                type: "g2",',
                    "                                params: {",
                    "                                    x: 1,",
                    "                                },",
                    "                            },",
                    "                        ]),",
                    "                    },",
                    "                    {",
                    '                        target: "b",',
                    '                        guard: or(["g1", not("g2")]),',
                    "                    },",
                    "                    {",
                    '                        target: "b",',
                    '                        guard: stateIn("#machine.b"),',
                    "                    },",
                    "                    {",
                    '                        target: "b",',
                    "                        guard: stateIn({",
                    '                            b: "c",',
                    "                        }),",
                    "                    },",
                    "                    {",
                    '                        target: "b",',
                    "                        guard: not(anonymous),",
                    "                    },",
                    "                ],",
                    "            },",
                    "        },",
                    "        b: {},",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("round-trips builtins through evaluation", () => {
            const definition = createMachine({
                initial: "a",
                states: { a: { entry: raise({ type: "E" }, { delay: 10 }), on: { E: { guard: and(["g"]) } } } },
            });
            const { config } = evaluate(toXStateSource(definition));
            expect(config).toEqual({
                initial: "a",
                states: {
                    a: {
                        entry: { call: "raise", args: [{ type: "E" }, { delay: 10 }] },
                        on: { E: { guard: { call: "and", args: [["g"]] } } },
                    },
                },
            });
        });
    });

    describe("implementations", () => {
        it("are omitted by default", () => {
            expect(toXStateSource(createTrafficLight())).not.toContain("guards");
        });

        it("render only the non-empty tables, functions as identifiers and builtins as calls", () => {
            const definition = createMachine(
                {
                    initial: "a",
                    context: { ready: false, count: 0 },
                    states: { a: { on: { E: { actions: ["warn", "bump"], guard: "isReady" } } } },
                },
                {
                    actions: { warn, bump: assign({ count: 1 }) },
                    guards: { isReady },
                    delays: {},
                },
            );
            expect(toXStateSource(definition, { includeImport: false, includeImplementations: true })).toBe(
                [
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    context: {",
                    "        ready: false,",
                    "        count: 0,",
                    "    },",
                    "    states: {",
                    "        a: {",
                    "            on: {",
                    "                E: {",
                    '                    actions: ["warn", "bump"],',
                    '                    guard: "isReady",',
                    "                },",
                    "            },",
                    "        },",
                    "    },",
                    "}, {",
                    "    actions: {",
                    "        warn: warn,",
                    "        bump: assign({",
                    "            count: 1,",
                    "        }),",
                    "    },",
                    "    guards: {",
                    "        isReady: isReady,",
                    "    },",
                    "});",
                    "",
                ].join("\n"),
            );
        });

        it("render as `{}` when every table is empty", () => {
            const definition = createMachine({ initial: "a", states: { a: {} } });
            expect(toXStateSource(definition, { includeImport: false, includeImplementations: true })).toBe(
                [
                    "export const machine = createMachine({",
                    '    initial: "a",',
                    "    states: {",
                    "        a: {},",
                    "    },",
                    "}, {});",
                    "",
                ].join("\n"),
            );
        });

        it("include implementations added through `provide()`", () => {
            const definition = createTrafficLight().provide({ delays: { SHORT: 5, LONG: () => 10 } });
            const source = toXStateSource(definition, { includeImport: false, includeImplementations: true });
            expect(source).toContain("    delays: {\n        SHORT: 5,\n        LONG: LONG,\n    },");
        });
    });
});
