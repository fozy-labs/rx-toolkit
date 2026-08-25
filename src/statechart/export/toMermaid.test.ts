import { assign, cancel, log, raise } from "../actions";
import { createMachine } from "../createMachine";
import { and, not, or, stateIn } from "../guards";

import { toMermaid } from "./toMermaid";

function createTrafficLight() {
    return createMachine(
        {
            id: "trafficLight",
            initial: "green",
            context: { ready: false },
            states: {
                green: { after: { 3000: "yellow" } },
                yellow: { on: { TIMER: { target: "red", guard: "isReady", actions: "warn" } } },
                red: { on: { TIMER: "green" } },
            },
        },
        {
            actions: { warn: () => {} },
            guards: { isReady: ({ context }) => context.ready },
            delays: {},
        },
    );
}

describe("toMermaid", () => {
    it("renders the canonical traffic light exactly", () => {
        expect(toMermaid(createTrafficLight())).toBe(
            [
                "stateDiagram-v2",
                '    state "green" as trafficLight_green',
                '    state "yellow" as trafficLight_yellow',
                '    state "red" as trafficLight_red',
                "    [*] --> trafficLight_green",
                "    trafficLight_green --> trafficLight_yellow : after 3000",
                "    trafficLight_yellow --> trafficLight_red : TIMER [isReady] / warn",
                "    trafficLight_red --> trafficLight_green : TIMER",
                "",
            ].join("\n"),
        );
    });

    it("is deterministic and reachable through the definition", () => {
        const definition = createTrafficLight();
        expect(toMermaid(definition)).toBe(toMermaid(definition));
        expect(definition.toMermaid()).toBe(toMermaid(definition));
    });

    it("emits `direction LR` on request and rejects other directions", () => {
        const lines = toMermaid(createTrafficLight(), { direction: "LR" }).split("\n");
        expect(lines[0]).toBe("stateDiagram-v2");
        expect(lines[1]).toBe("    direction LR");
        expect(toMermaid(createTrafficLight(), { direction: "TB" })).not.toContain("direction");
        expect(() => toMermaid(createTrafficLight(), { direction: "RL" as "LR" })).toThrow(RangeError);
    });

    it("uses `(machine)` sanitized as the id prefix when the machine has no id", () => {
        const definition = createMachine({ initial: "a", states: { a: {} } });
        expect(toMermaid(definition)).toBe(
            ["stateDiagram-v2", '    state "a" as _machine__a', "    [*] --> _machine__a", ""].join("\n"),
        );
    });

    describe("structure", () => {
        it("nests compound states with their own initial marker and final states", () => {
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
                    '    state "idle" as m_idle',
                    '    state "work" as m_work',
                    "    state m_work {",
                    '        state "step1" as m_work_step1',
                    '        state "step2" as m_work_step2',
                    "        m_work_step2 --> [*]",
                    "        [*] --> m_work_step1",
                    "    }",
                    '    state "done" as m_done',
                    "    m_done --> [*]",
                    "    [*] --> m_idle",
                    "    m_idle --> m_work : START",
                    "    m_work --> m_done : done",
                    "    m_work_step1 --> m_work_step2 : NEXT",
                    "",
                ].join("\n"),
            );
        });

        it("separates parallel regions with `--`", () => {
            const definition = createMachine({
                id: "m",
                initial: "run",
                states: {
                    run: {
                        type: "parallel",
                        states: {
                            audio: { initial: "off", states: { off: { on: { TOGGLE: "on" } }, on: {} } },
                            video: { initial: "off", states: { off: { on: { TOGGLE: "on" } }, on: {} } },
                            flag: {},
                        },
                    },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    '    state "run" as m_run',
                    "    state m_run {",
                    '        state "audio" as m_run_audio',
                    "        state m_run_audio {",
                    '            state "off" as m_run_audio_off',
                    '            state "on" as m_run_audio_on',
                    "            [*] --> m_run_audio_off",
                    "        }",
                    "        --",
                    '        state "video" as m_run_video',
                    "        state m_run_video {",
                    '            state "off" as m_run_video_off',
                    '            state "on" as m_run_video_on',
                    "            [*] --> m_run_video_off",
                    "        }",
                    "        --",
                    '        state "flag" as m_run_flag',
                    "    }",
                    "    [*] --> m_run",
                    "    m_run_audio_off --> m_run_audio_on : TOGGLE",
                    "    m_run_video_off --> m_run_video_on : TOGGLE",
                    "",
                ].join("\n"),
            );
        });

        it("wraps a parallel root in a block of its own", () => {
            const definition = createMachine({
                id: "m",
                type: "parallel",
                states: {
                    a: { initial: "a1", states: { a1: {} } },
                    b: { initial: "b1", states: { b1: {} } },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    '    state "m" as m',
                    "    state m {",
                    '        state "a" as m_a',
                    "        state m_a {",
                    '            state "a1" as m_a_a1',
                    "            [*] --> m_a_a1",
                    "        }",
                    "        --",
                    '        state "b" as m_b',
                    "        state m_b {",
                    '            state "b1" as m_b_b1',
                    "            [*] --> m_b_b1",
                    "        }",
                    "    }",
                    "",
                ].join("\n"),
            );
        });

        it("wraps the root in a block when it owns transitions or entry/exit actions", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                entry: "boot",
                on: { RESET: ".a" },
                states: { a: { on: { NEXT: "b" } }, b: {} },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    '    state "m" as m',
                    "    state m {",
                    '        state "a" as m_a',
                    '        state "b" as m_b',
                    "        [*] --> m_a",
                    "    }",
                    "    m --> m_a : RESET",
                    "    m_a --> m_b : NEXT",
                    "    note right of m : entry / boot",
                    "",
                ].join("\n"),
            );
            // Without actions the entry note is the only reason for the block, so it disappears.
            expect(
                toMermaid(createMachine({ id: "m", initial: "a", entry: "boot", states: { a: {} } }), {
                    includeActions: false,
                }),
            ).toBe(["stateDiagram-v2", '    state "a" as m_a', "    [*] --> m_a", ""].join("\n"));
        });

        it("renders history states as H / H* with their default transition", () => {
            const definition = createMachine({
                id: "m",
                initial: "off",
                states: {
                    off: { on: { POWER: "on.hist" } },
                    on: {
                        initial: "low",
                        on: { POWER: "off" },
                        states: {
                            low: { on: { UP: "high" } },
                            high: {},
                            hist: { history: "shallow", target: "high" },
                            deepHist: { type: "history", history: "deep" },
                        },
                    },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    '    state "off" as m_off',
                    '    state "on" as m_on',
                    "    state m_on {",
                    '        state "low" as m_on_low',
                    '        state "high" as m_on_high',
                    '        state "H" as m_on_hist',
                    '        state "H*" as m_on_deepHist',
                    "        [*] --> m_on_low",
                    "    }",
                    "    [*] --> m_off",
                    "    m_off --> m_on_hist : POWER",
                    "    m_on --> m_off : POWER",
                    "    m_on_low --> m_on_high : UP",
                    "    m_on_hist --> m_on_high : default",
                    "",
                ].join("\n"),
            );
        });

        it("sanitizes ids and keeps them unique", () => {
            const definition = createMachine({
                id: "my machine",
                initial: "a",
                states: {
                    a: { id: "x y", on: { E: "b" } },
                    b: { id: "x_y", on: { E: "c" } },
                    c: { id: "x-y" },
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    '    state "a" as x_y',
                    '    state "b" as x_y_2',
                    '    state "c" as x_y_3',
                    "    [*] --> x_y",
                    "    x_y --> x_y_2 : E",
                    "    x_y_2 --> x_y_3 : E",
                    "",
                ].join("\n"),
            );
        });
    });

    describe("transitions", () => {
        it("labels always, done, wildcard and named-delay transitions", () => {
            const definition = createMachine(
                {
                    id: "m",
                    initial: "a",
                    states: {
                        a: {
                            always: { target: "b", guard: "ready" },
                            after: { SHORT: "c" },
                            on: { "*": "c", "user.*": { target: "b" } },
                        },
                        b: { initial: "b1", onDone: "c", states: { b1: { type: "final" } } },
                        c: {},
                    },
                },
                { guards: { ready: () => true }, delays: { SHORT: 10 } },
            );
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    '    state "a" as m_a',
                    '    state "b" as m_b',
                    "    state m_b {",
                    '        state "b1" as m_b_b1',
                    "        m_b_b1 --> [*]",
                    "        [*] --> m_b_b1",
                    "    }",
                    '    state "c" as m_c',
                    "    [*] --> m_a",
                    "    m_a --> m_c : *",
                    "    m_a --> m_b : user.*",
                    "    m_a --> m_c : after SHORT",
                    "    m_a --> m_b : always [ready]",
                    "    m_b --> m_c : done",
                    "",
                ].join("\n"),
            );
        });

        it("renders targetless transitions as self-loops and multiple targets as separate lines", () => {
            const definition = createMachine({
                id: "m",
                initial: "p",
                states: {
                    p: {
                        type: "parallel",
                        states: {
                            a: { initial: "a1", states: { a1: {}, a2: {} } },
                            b: {
                                initial: "b1",
                                states: {
                                    b1: { on: { PING: { actions: "pong" }, BOTH: ["#m.p.a.a2", "b2"] } },
                                    b2: {},
                                },
                            },
                        },
                    },
                },
            });
            const lines = toMermaid(definition).split("\n");
            expect(lines).toContain("    m_p_b_b1 --> m_p_b_b1 : PING / pong");
            expect(lines).toContain("    m_p_b_b1 --> m_p_a_a2 : BOTH");
            expect(lines).toContain("    m_p_b_b1 --> m_p_b_b2 : BOTH");
        });

        it("keeps candidates in config order (first enabled wins)", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        on: {
                            E: [{ target: "b", guard: "first" }, { target: "c", guard: "second" }, "a"],
                        },
                    },
                    b: {},
                    c: {},
                },
            });
            const lines = toMermaid(definition).split("\n");
            const indexes = ["m_a --> m_b : E [first]", "m_a --> m_c : E [second]", "m_a --> m_a : E"].map((line) =>
                lines.indexOf(`    ${line}`),
            );
            expect(indexes.every((index) => index >= 0)).toBe(true);
            expect(indexes).toEqual([...indexes].sort((x, y) => x - y));
        });
    });

    describe("guards and actions", () => {
        it("renders names, `{ type }` references, functions and builtins", () => {
            function checkIt(): boolean {
                return true;
            }
            const definition = createMachine({
                id: "m",
                initial: "a",
                context: { n: 0 },
                states: {
                    a: {
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
                                    raise({ type: "E1" }),
                                    raise(() => ({ type: "E1" })),
                                    cancel("id"),
                                    log("x"),
                                ],
                            },
                            E4: { target: "b", guard: ({ context }) => context.n > 0 },
                        },
                    },
                    b: {},
                },
            });
            const lines = toMermaid(definition).split("\n");
            expect(lines).toContain("    m_a --> m_b : E1 [hasParams] / doIt");
            expect(lines).toContain("    m_a --> m_b : E2 [checkIt] / checkIt, anonymous");
            expect(lines).toContain(
                "    m_a --> m_b : E3 [and(g1, not(g2), or(stateIn(#m.b), stateIn(a.x)))] / assign, raise E1, raise, cancel, log",
            );
            expect(lines).toContain("    m_a --> m_b : E4 [guard]");
        });

        it("renders entry/exit actions as notes, without the synthesized `after` bookkeeping", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: { entry: ["init", assign({ n: 1 })], exit: "cleanup", after: { 100: "b" } },
                    b: { exit: [log("bye")] },
                    c: {},
                },
            });
            expect(toMermaid(definition)).toBe(
                [
                    "stateDiagram-v2",
                    '    state "a" as m_a',
                    '    state "b" as m_b',
                    '    state "c" as m_c',
                    "    [*] --> m_a",
                    "    m_a --> m_b : after 100",
                    "    note right of m_a : entry / init, assign ; exit / cleanup",
                    "    note right of m_b : exit / log",
                    "",
                ].join("\n"),
            );
        });

        it("strips characters Mermaid cannot take in labels and notes", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: { entry: "ns:boot", on: { "E\nX": { actions: "multi\nline" } } },
                },
            });
            const lines = toMermaid(definition).split("\n");
            expect(lines).toContain("    m_a --> m_a : E X / multi line");
            expect(lines).toContain("    note right of m_a : entry / ns boot");
        });

        it("honours includeGuards / includeActions", () => {
            const definition = createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: { entry: "init", on: { E: { target: "b", guard: "g", actions: ["x", "y"] } } },
                    b: {},
                },
            });
            expect(toMermaid(definition, { includeGuards: false })).toContain("    m_a --> m_b : E / x, y\n");
            expect(toMermaid(definition, { includeActions: false })).toBe(
                [
                    "stateDiagram-v2",
                    '    state "a" as m_a',
                    '    state "b" as m_b',
                    "    [*] --> m_a",
                    "    m_a --> m_b : E [g]",
                    "",
                ].join("\n"),
            );
            expect(toMermaid(definition, { includeGuards: false, includeActions: false })).toContain(
                "    m_a --> m_b : E\n",
            );
        });
    });
});
