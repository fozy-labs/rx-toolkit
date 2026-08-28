/**
 * `toMermaid` renders the converter's dialect (`apps/converter`). Every
 * expected text here was also fed to mermaid 11.17.2 (`getDiagramFromText`
 * with jsdom, the harness of `.tmp/mermaid-validate`) to check that it
 * parses and that every state lands in the right block.
 */
import { assign, cancel, log, mutate, raise } from "../actions";
import { createMachine } from "../createMachine";
import { and, not, or, stateIn } from "../guards";

import { toMermaid } from "./toMermaid";

/** The proposal's `trafficLight` (section «Конвертер»): `$final` + `onDone`, `after`, guard and actions by name. */
function createTrafficLight() {
    return createMachine(
        {
            id: "trafficLight",
            context: { power: true, retries: 0 },
            initial: "off",
            states: {
                off: { on: { POWER_ON: { target: "working", guard: "hasPower", actions: ["logStart"] } } },
                working: {
                    initial: "green",
                    on: { POWER_OFF: "off" },
                    onDone: "broken",
                    states: {
                        green: { after: { 3000: "yellow" } },
                        yellow: { after: { 1000: { target: "red", actions: ["warn"] } } },
                        red: { after: { 3000: "green" }, on: { FAULT: "$final" } },
                        $final: { type: "final" },
                    },
                },
                broken: { on: { RESET: { target: "off", actions: ["retry"] } } },
            },
        },
        {
            guards: { hasPower: ({ context }) => context.power },
            actions: {
                logStart: () => {},
                retry: mutate(({ context }) => {
                    context.retries += 1;
                }),
                warn: () => {},
            },
        },
    );
}

const TRAFFIC_LIGHT_BODY = [
    "    [*] --> off",
    "    off --> working: POWER_ON [hasPower] / logStart",
    "    working --> off: POWER_OFF",
    "    working --> broken: done",
    "    state working {",
    "        [*] --> green",
    "        green --> yellow: after 3000",
    "        yellow --> red: after 1000 / warn",
    "        red --> green: after 3000",
    "        red --> [*]: FAULT",
    "    }",
    "    broken --> off: RESET / retry",
];

describe("toMermaid", () => {
    it("renders the proposal's traffic light exactly", () => {
        expect(toMermaid(createTrafficLight())).toBe(
            [
                "stateDiagram-v2",
                "    %% @machine trafficLight",
                '    %% @context initial: {"power":true,"retries":0}',
                ...TRAFFIC_LIGHT_BODY,
                "",
            ].join("\n"),
        );
    });

    it("renders the proposal's square example exactly (candidates in source order)", () => {
        const square = createMachine({
            id: "square",
            context: { result: null as number | null, error: null as string | null },
            initial: "idle",
            states: {
                idle: {
                    on: {
                        SQUARE: [
                            { target: "done", guard: "isFinite", actions: ["square"] },
                            { target: "error", actions: ["reject"] },
                        ],
                    },
                },
                done: { on: { RESET: { target: "idle", actions: ["clear"] } } },
                error: { on: { RESET: { target: "idle", actions: ["clear"] } } },
            },
        });
        expect(toMermaid(square)).toBe(
            [
                "stateDiagram-v2",
                "    %% @machine square",
                '    %% @context initial: {"result":null,"error":null}',
                "    [*] --> idle",
                "    idle --> done: SQUARE [isFinite] / square",
                "    idle --> error: SQUARE / reject",
                "    done --> idle: RESET / clear",
                "    error --> idle: RESET / clear",
                "",
            ].join("\n"),
        );
    });

    it("is deterministic and reachable through the definition", () => {
        const definition = createTrafficLight();
        expect(toMermaid(definition)).toBe(toMermaid(definition));
        expect(definition.toMermaid()).toBe(toMermaid(definition));
    });

    it("emits `direction LR` after the directives and rejects other directions", () => {
        const lines = toMermaid(createTrafficLight(), { direction: "LR" }).split("\n");
        expect(lines.slice(0, 4)).toEqual([
            "stateDiagram-v2",
            "    %% @machine trafficLight",
            '    %% @context initial: {"power":true,"retries":0}',
            "    direction LR",
        ]);
        expect(toMermaid(createTrafficLight(), { direction: "TB" })).not.toContain("direction");
        expect(() => toMermaid(createTrafficLight(), { direction: "RL" as "LR" })).toThrow(RangeError);
    });

    describe("directives", () => {
        it("omits `%% @machine` for a machine without an id", () => {
            expect(toMermaid(createMachine({ initial: "a", states: { a: {} } }))).toBe(
                ["stateDiagram-v2", "    [*] --> a", ""].join("\n"),
            );
        });

        it("emits `%% @context initial` as JSON for a JSON-serializable context", () => {
            const render = (context: Record<string, unknown>) =>
                toMermaid(createMachine({ id: "m", context, initial: "a", states: { a: {} } })).split("\n")[2];
            expect(render({})).toBe("    %% @context initial: {}");
            expect(render({ list: [1, "two", null, { deep: false }], s: "a\nb" })).toBe(
                '    %% @context initial: {"list":[1,"two",null,{"deep":false}],"s":"a\\nb"}',
            );
        });

        it("omits `%% @context initial` for factories and non-JSON values", () => {
            const cyclic: Record<string, unknown> = {};
            cyclic.self = cyclic;
            const contexts: (Record<string, unknown> | (() => Record<string, unknown>))[] = [
                () => ({ n: 1 }),
                { d: new Date(0) },
                { u: undefined },
                { x: NaN },
                { f: () => 1 },
                cyclic,
            ];
            for (const context of contexts) {
                expect(toMermaid(createMachine({ id: "m", context, initial: "a", states: { a: {} } }))).toBe(
                    ["stateDiagram-v2", "    %% @machine m", "    [*] --> a", ""].join("\n"),
                );
            }
            expect(toMermaid(createMachine({ id: "m", initial: "a", states: { a: {} } }))).not.toContain("@context");
        });
    });

    describe("structure", () => {
        it("nests compound states with their own initial marker; finals other than `$final` keep their id", () => {
            const definition = createMachine({
                id: "m",
                initial: "idle",
                states: {
                    idle: { on: { START: "work" } },
                    work: {
                        initial: "step1",
                        onDone: "done",
                        states: {
                            step1: { on: { NEXT: "step2" } },
                            step2: { type: "final", output: { ok: true } },
                        },
                    },
                    done: { type: "final" },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> idle",
                    "    idle --> work: START",
                    "    work --> done: done",
                    "    state work {",
                    "        [*] --> step1",
                    "        step1 --> step2: NEXT",
                    "        step2 --> [*]",
                    "    }",
                    "    done --> [*]",
                    "",
                ].join("\n"),
            );
        });

        it("renders `$final` as `[*]` only when siblings alone reach a plain final; otherwise it keeps an id", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: { on: { JUMP: "#m.w.$final", END: "$final" } },
                    // entered from outside its scope -> explicit
                    w: { initial: "b", onDone: "a", states: { b: { on: { X: "$final" } }, $final: { type: "final" } } },
                    // the initial state -> explicit
                    v: { initial: "$final", states: { $final: { type: "final" } } },
                    // entry actions -> explicit (a note needs the id)
                    u: {
                        initial: "b",
                        states: { b: { on: { X: "$final" } }, $final: { type: "final", entry: "cheer" } },
                    },
                    // description -> explicit
                    t: {
                        initial: "b",
                        states: { b: { on: { X: "$final" } }, $final: { type: "final", description: "fin" } },
                    },
                    $final: { type: "final" },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> a",
                    "    a --> [*]: END",
                    "    w --> a: done",
                    "    state w {",
                    "        [*] --> b",
                    "        b --> _final: X",
                    "        _final --> [*]",
                    "    }",
                    "    state v {",
                    "        [*] --> v__final",
                    "        v__final --> [*]",
                    "    }",
                    "    state u {",
                    "        [*] --> u_b",
                    "        u_b --> u__final: X",
                    "        u__final --> [*]",
                    "    }",
                    "    state t {",
                    "        [*] --> t_b",
                    "        t_b --> t__final: X",
                    '        state "fin" as t__final',
                    "        t__final --> [*]",
                    "    }",
                    "    a --> _final: JUMP",
                    "    note right of u__final",
                    "        entry / cheer",
                    "    end note",
                    "",
                ].join("\n"),
            );
            // Without actions the entry note is gone and `u.$final` collapses into `[*]`.
            expect(toMermaid(definition, { includeActions: false })).toContain("        u_b --> [*]: X\n");
        });

        it("keeps an unreachable `$final` visible", () => {
            expect(
                toMermaid(createMachine({ id: "m", initial: "a", states: { a: {}, $final: { type: "final" } } })),
            ).toBe(["stateDiagram-v2", "    %% @machine m", "    [*] --> a", "    _final --> [*]", ""].join("\n"));
        });

        it("renders parallel regions as anonymous `--` sections unless a region needs an id of its own", () => {
            const definition = createMachine({
                id: "m",
                initial: "run",
                states: {
                    run: {
                        type: "parallel",
                        onDone: "finished",
                        states: {
                            audio: {
                                initial: "off",
                                states: { off: { on: { TOGGLE: "on" } }, on: { on: { MUTE: "#m.run.video.off" } } },
                            },
                            video: {
                                initial: "off",
                                states: {
                                    off: { on: { TOGGLE: "on" } },
                                    on: { on: { STOP: "$final" } },
                                    $final: { type: "final" },
                                },
                            },
                            flag: {},
                            net: { initial: "up", on: { OFFLINE: ".down" }, states: { up: {}, down: {} } },
                        },
                    },
                    finished: { type: "final" },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> run",
                    "    run --> finished: done",
                    "    state run {",
                    "        [*] --> off",
                    "        off --> on: TOGGLE",
                    "        --",
                    "        [*] --> run_video_off",
                    "        run_video_off --> run_video_on: TOGGLE",
                    "        run_video_on --> [*]: STOP",
                    "        --",
                    "        flag",
                    "        --",
                    "        state net {",
                    "            [*] --> up",
                    "            down",
                    "        }",
                    "    }",
                    "    finished --> [*]",
                    "    net --> down: OFFLINE",
                    "    on --> run_video_off: MUTE",
                    "",
                ].join("\n"),
            );
        });

        it("wraps the root in a block when it owns transitions or entry/exit actions", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                context: { n: 0 },
                entry: "boot",
                on: { RESET: { target: ".a", actions: assign({ n: 0 }) } },
                states: { a: { on: { GO: "b" } }, b: {} },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    '    %% @context initial: {"n":0}',
                    "    state m {",
                    "        [*] --> a",
                    "        a --> b: GO",
                    "    }",
                    "    m --> a: RESET / assign",
                    "    note right of m",
                    "        entry / boot",
                    "    end note",
                    "",
                ].join("\n"),
            );
        });

        it("renders history states as H / H* with their default transition (documented degradation)", () => {
            const definition = createMachine({
                id: "m",
                initial: "off",
                states: {
                    off: { on: { RESUME: "#m.on.hist", DEEP: "#m.on.deep", POWER: "on" } },
                    on: {
                        initial: "a",
                        on: { POWER: "off" },
                        states: {
                            a: { on: { NEXT: "b" } },
                            b: {},
                            hist: { history: "shallow", target: "b" },
                            deep: { history: "deep" },
                        },
                    },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> off",
                    "    off --> on: POWER",
                    "    on --> off: POWER",
                    "    state on {",
                    "        [*] --> a",
                    "        a --> b: NEXT",
                    '        state "H" as hist',
                    "        hist --> b: default",
                    '        state "H*" as deep',
                    "    }",
                    "    off --> hist: RESUME",
                    "    off --> deep: DEEP",
                    "",
                ].join("\n"),
            );
        });

        it("uses state keys as ids, sanitized; a duplicate key falls back to the `_`-joined path", () => {
            const definition = createMachine({
                id: "m",
                initial: "p1",
                states: {
                    p1: {
                        initial: "idle",
                        on: { GO: "p2" },
                        states: { idle: { on: { A: "a-b" } }, "a-b": {}, a_b: {} },
                    },
                    p2: { initial: "idle", states: { idle: { on: { B: "x" } }, x: {} } },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> p1",
                    "    p1 --> p2: GO",
                    "    state p1 {",
                    "        [*] --> idle",
                    "        idle --> a_b: A",
                    "        p1_a_b",
                    "    }",
                    "    state p2 {",
                    "        [*] --> p2_idle",
                    "        p2_idle --> x: B",
                    "    }",
                    "",
                ].join("\n"),
            );
        });

        it("hoists transitions that cross scopes to the top level and declares otherwise unmentioned states by id", () => {
            const definition = createMachine({
                id: "m",
                initial: "off",
                states: {
                    off: { on: { JUMP: "#m.w.b", GO: "w" } },
                    w: {
                        initial: "a",
                        states: { a: { on: { OUT: "#m.off", IN: "#m.v.c" } }, b: {}, lonely: {} },
                    },
                    v: { initial: "c", states: { c: { on: { BACK: "#m.w.a" } } } },
                    isolated: {},
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> off",
                    "    off --> w: GO",
                    "    state w {",
                    "        [*] --> a",
                    "        b",
                    "        lonely",
                    "    }",
                    "    state v {",
                    "        [*] --> c",
                    "    }",
                    "    isolated",
                    "    off --> b: JUMP",
                    "    a --> off: OUT",
                    "    a --> c: IN",
                    "    c --> a: BACK",
                    "",
                ].join("\n"),
            );
        });

        it('declares described states with `state "…" as id` (quotes and line breaks normalized)', () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: { description: 'Say "hi"\nthen go', on: { GO: "w" } },
                    w: { description: "Working", initial: "b", states: { b: { description: "Inner" } } },
                    end: { type: "final", description: "The end" },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> a",
                    "    state \"Say 'hi' then go\" as a",
                    "    a --> w: GO",
                    '    state "Working" as w',
                    "    state w {",
                    "        [*] --> b",
                    '        state "Inner" as b',
                    "    }",
                    '    state "The end" as end',
                    "    end --> [*]",
                    "",
                ].join("\n"),
            );
        });
    });

    describe("transitions", () => {
        it("labels events, guards, actions, `after`, `done`, wildcards; `always` has no trigger; slots keep config order", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        on: {
                            "*": "b",
                            E: [{ target: "b", guard: "g1" }, { target: "c", guard: "g2", actions: ["x", "y"] }, "d"],
                            SELF: { actions: "tick" },
                        },
                        after: { SHORT: "b" },
                        always: [
                            { target: "c", guard: "ready" },
                            { target: "d", actions: "log" },
                        ],
                    },
                    b: { always: "c" },
                    c: { on: { GO: { target: ["#m.p.r1.y", "#m.p.r2.z"] } } },
                    d: { after: { 500: "a" }, on: { HOP: "a" } },
                    p: {
                        type: "parallel",
                        onDone: "a",
                        states: {
                            r1: { initial: "x", states: { x: {}, y: { type: "final" } } },
                            r2: { initial: "w", states: { w: {}, z: { type: "final" } } },
                        },
                    },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    "    [*] --> a",
                    "    a --> b: *",
                    "    a --> b: E [g1]",
                    "    a --> c: E [g2] / x, y",
                    "    a --> d: E",
                    "    a --> a: SELF / tick",
                    "    a --> b: after SHORT",
                    "    a --> c: [ready]",
                    "    a --> d: / log",
                    "    b --> c",
                    "    d --> a: after 500",
                    "    d --> a: HOP",
                    "    p --> a: done",
                    "    state p {",
                    "        [*] --> x",
                    "        y --> [*]",
                    "        --",
                    "        [*] --> w",
                    "        z --> [*]",
                    "    }",
                    "    c --> y: GO",
                    "    c --> z: GO",
                    "",
                ].join("\n"),
            );
        });
    });

    describe("guards and actions", () => {
        it("renders names, `{ type }` references, functions and builtins; entry/exit as multi-line notes", () => {
            function checkIt(): boolean {
                return true;
            }
            const definition = createMachine({
                id: "m",
                initial: "a",
                context: { n: 0 },
                states: {
                    a: {
                        entry: ["init", assign({ n: 1 })],
                        exit: mutate(() => {}),
                        on: {
                            E1: {
                                target: "b",
                                guard: { type: "hasParams", params: { x: 1 } },
                                actions: { type: "doIt" },
                            },
                            E2: { target: "b", guard: checkIt, actions: [checkIt, () => {}] },
                            E3: {
                                target: "b",
                                guard: and(["g1", not("g2"), or([stateIn("#m.b"), stateIn({ a: "x" })])]),
                                actions: [
                                    assign({ n: 1 }),
                                    mutate(() => {}),
                                    raise({ type: "E1" }),
                                    raise(() => ({ type: "E1" })),
                                    cancel("id"),
                                    log("x"),
                                ],
                            },
                            E4: { target: "b", guard: ({ context }) => context.n > 0 },
                            "E\nX": { actions: "multi\nline" },
                        },
                        after: { 100: "b" },
                    },
                    b: { exit: [log("bye")], entry: "ns:boot" },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine m",
                    '    %% @context initial: {"n":0}',
                    "    [*] --> a",
                    "    a --> b: E1 [hasParams] / doIt",
                    "    a --> b: E2 [checkIt] / checkIt, anonymous",
                    "    a --> b: E3 [and(g1, not(g2), or(stateIn(#m.b), stateIn(a.x)))] / assign, mutate, raise E1, raise, cancel, log",
                    "    a --> b: E4 [guard]",
                    "    a --> a: E X / multi line",
                    "    a --> b: after 100",
                    "    note right of a",
                    "        entry / init, assign",
                    "        exit / mutate",
                    "    end note",
                    "    note right of b",
                    "        entry / ns:boot",
                    "        exit / log",
                    "    end note",
                    "",
                ].join("\n"),
            );
        });

        it("honours includeGuards / includeActions", () => {
            expect(toMermaid(createTrafficLight(), { includeGuards: false })).toContain(
                "    off --> working: POWER_ON / logStart\n",
            );
            expect(toMermaid(createTrafficLight(), { direction: "LR", includeActions: false })).toBe(
                [
                    "stateDiagram-v2",
                    "    %% @machine trafficLight",
                    '    %% @context initial: {"power":true,"retries":0}',
                    "    direction LR",
                    "    [*] --> off",
                    "    off --> working: POWER_ON [hasPower]",
                    "    working --> off: POWER_OFF",
                    "    working --> broken: done",
                    "    state working {",
                    "        [*] --> green",
                    "        green --> yellow: after 3000",
                    "        yellow --> red: after 1000",
                    "        red --> green: after 3000",
                    "        red --> [*]: FAULT",
                    "    }",
                    "    broken --> off: RESET",
                    "",
                ].join("\n"),
            );
            expect(toMermaid(createTrafficLight(), { includeGuards: false, includeActions: false })).toContain(
                "    off --> working: POWER_ON\n",
            );
        });
    });
});
