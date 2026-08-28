import { describe, expect, it } from "vitest";

import { parse } from "../parse/parse.js";
import { StatechartParseError } from "../StatechartParseError.js";

import { analyzeBodyUsage } from "./bodyUsage.js";
import { emit } from "./emit.js";
import { printValue } from "./printConfig.js";

function mmd(...lines: string[]): string {
    return `${lines.join("\n")}\n`;
}

function failing(fn: () => unknown): StatechartParseError {
    try {
        fn();
    } catch (error) {
        if (error instanceof StatechartParseError) return error;
        throw error;
    }
    throw new Error("expected a StatechartParseError");
}

const HEADER = ["stateDiagram-v2", "%% @machine m"];
const TYPED = ["%% @context type: { n: number }", "%% @context initial: { n: 0 }"];

function importLine(code: string): string {
    return code.split("\n").find((line) => line.startsWith("import "))!;
}

describe("emit: header and imports", () => {
    const parsed = parse(mmd(...HEADER, "[*] --> a"));

    it("writes the base name of the file into the header", () => {
        expect(emit(parsed, { fileName: "a/b/c/x.mmd" }).split("\n")[0]).toBe(
            "// AUTO-GENERATED from x.mmd — do not edit",
        );
        expect(emit(parsed, { fileName: "C:\\dir\\y.mmd" }).split("\n")[0]).toBe(
            "// AUTO-GENERATED from y.mmd — do not edit",
        );
    });

    it("omits the file name when unknown", () => {
        expect(emit(parsed).split("\n")[0]).toBe("// AUTO-GENERATED — do not edit");
    });

    it("imports from @fozy-labs/rx-toolkit by default and from `importFrom` when given", () => {
        expect(importLine(emit(parsed))).toBe('import { createMachine } from "@fozy-labs/rx-toolkit";');
        expect(importLine(emit(parsed, { importFrom: "../lib" }))).toBe('import { createMachine } from "../lib";');
    });

    it("imports only what is used: no args → createMachine only", () => {
        const code = emit(parse(mmd(...HEADER, '%% @action log: console.log("x")', "[*] --> a", "a --> b: X / log")));
        expect(importLine(code)).toBe('import { createMachine } from "@fozy-labs/rx-toolkit";');
        expect(code).not.toContain("mutate");
    });

    it("imports ActionArgs without mutate for an event-only action", () => {
        const code = emit(
            parse(mmd(...HEADER, "%% @action log: console.log(event.type)", "[*] --> a", "a --> b: X / log")),
        );
        expect(importLine(code)).toBe('import { createMachine, type ActionArgs } from "@fozy-labs/rx-toolkit";');
    });

    it("imports GuardArgs only when a guard destructures, MachineEvent only for system triggers", () => {
        const narrowed = emit(
            parse(mmd(...HEADER, ...TYPED, "%% @guard g: context.n > 0", "[*] --> a", "a --> b: X [g]")),
        );
        expect(importLine(narrowed)).toBe('import { createMachine, type GuardArgs } from "@fozy-labs/rx-toolkit";');
        const always = emit(parse(mmd(...HEADER, ...TYPED, "%% @guard g: context.n > 0", "[*] --> a", "a --> b: [g]")));
        expect(importLine(always)).toBe(
            'import { createMachine, type GuardArgs, type MachineEvent } from "@fozy-labs/rx-toolkit";',
        );
        const constant = emit(parse(mmd(...HEADER, "%% @guard g: true", "[*] --> a", "a --> b: [g]")));
        expect(importLine(constant)).toBe('import { createMachine } from "@fozy-labs/rx-toolkit";');
    });

    it("orders the import names createMachine, mutate, type ActionArgs, type GuardArgs, type MachineEvent", () => {
        const code = emit(
            parse(
                mmd(
                    ...HEADER,
                    ...TYPED,
                    "%% @guard g: context.n > 0",
                    "%% @action inc: context.n += 1",
                    "%% @delay slow: context.n",
                    "[*] --> a",
                    "a --> b: [g] / inc",
                    "b --> a: after slow",
                ),
            ),
        );
        expect(importLine(code)).toBe(
            'import { createMachine, mutate, type ActionArgs, type GuardArgs, type MachineEvent } from "@fozy-labs/rx-toolkit";',
        );
    });
});

describe("emit: context", () => {
    it("emits Context = {} and context: {} when both directives are absent", () => {
        const code = emit(parse(mmd(...HEADER, "[*] --> a")));
        expect(code).toContain("export type Context = {};");
        expect(code).toContain("        context: {},");
    });

    it("rejects @context type without @context initial at the line of the type", () => {
        const error = failing(() => emit(parse(mmd(...HEADER, "", "%% @context type: { a: number }", "[*] --> a"))));
        expect(error.message).toBe("`@context type` requires `@context initial`");
        expect(error.line).toBe(4);
    });

    it("rejects @context initial without @context type at the line of the initial", () => {
        const error = failing(() => emit(parse(mmd(...HEADER, "%% @context initial: { a: 1 }", "[*] --> a"))));
        expect(error.message).toBe("`@context initial` requires `@context type`: the generated file must be typed");
        expect(error.line).toBe(3);
    });

    it("re-indents multi-line type and initial bodies", () => {
        const code = emit(
            parse(
                mmd(
                    ...HEADER,
                    "%% @context type:",
                    "%%     {",
                    "%%         a: number;",
                    "%%     }",
                    "%% @context initial:",
                    "%%     {",
                    "%%         a: 1,",
                    "%%     }",
                    "[*] --> a",
                ),
            ),
        );
        expect(code).toContain("export type Context = {\n    a: number;\n};");
        expect(code).toContain("        context: {\n            a: 1,\n        },");
    });
});

describe("emit: events and state ids", () => {
    it("emits Events = never without events", () => {
        expect(emit(parse(mmd(...HEADER, "[*] --> a", "a --> b")))).toContain("export type Events = never;");
    });

    it("emits the union one member per line, payloads intersected", () => {
        const code = emit(
            parse(mmd(...HEADER, "%% @event SQUARE: { value: number }", "[*] --> a", "a --> b: A", "b --> a: SQUARE")),
        );
        expect(code).toContain(
            'export type Events =\n    | { type: "A" }\n    | ({ type: "SQUARE" } & { value: number });',
        );
    });

    it("emits StateId over every path, regions included", () => {
        const code = emit(
            parse(
                mmd(
                    ...HEADER,
                    "[*] --> p",
                    "state p {",
                    "    [*] --> a",
                    "    --",
                    "    [*] --> b",
                    "}",
                    "p --> [*]: X",
                ),
            ),
        );
        expect(code).toContain('export type StateId = "p" | "p.$0" | "p.$0.a" | "p.$1" | "p.$1.b";');
    });
});

describe("emit: source literal", () => {
    it("escapes backticks, ${ and backslashes so that the literal evaluates to the original text", () => {
        const text = mmd(
            ...HEADER,
            '%% @action act: console.log(`a${1}\\n`, "b\\\\c")',
            "[*] --> a",
            "a --> a: X / act",
        );
        const code = emit(parse(text));
        const literal = /export const source = (`[\s\S]*?`);\n\nexport const definition/.exec(code)?.[1];
        expect(literal).toBeDefined();
        expect(literal).toContain("\\`a\\${1}\\\\n\\`");
        expect(new Function(`return ${literal};`)()).toBe(text);
    });
});

describe("emit: implementations", () => {
    it("emits a narrowed guard with the referenced event types", () => {
        const code = emit(
            parse(
                mmd(...HEADER, ...TYPED, "%% @guard g: context.n > 0", "[*] --> a", "a --> b: A [g]", "b --> a: B [g]"),
            ),
        );
        expect(code).toContain(
            '            g: ({ context }: GuardArgs<Context, Extract<Events, { type: "A" | "B" }>>) => (context.n > 0),',
        );
    });

    it("types the event as MachineEvent<Events> for system triggers and unreferenced guards", () => {
        const always = emit(parse(mmd(...HEADER, ...TYPED, "%% @guard g: context.n > 0", "[*] --> a", "a --> b: [g]")));
        expect(always).toContain(
            "            g: ({ context }: GuardArgs<Context, MachineEvent<Events>>) => (context.n > 0),",
        );
        const unused = emit(parse(mmd(...HEADER, ...TYPED, "%% @guard g: context.n > 0", "[*] --> a", "a --> b: A")));
        expect(unused).toContain(
            "            g: ({ context }: GuardArgs<Context, MachineEvent<Events>>) => (context.n > 0),",
        );
    });

    it("wraps actions that read context in mutate, leaves the others plain", () => {
        const code = emit(
            parse(
                mmd(
                    ...HEADER,
                    ...TYPED,
                    "%% @action inc: context.n += 1",
                    "%% @action log: console.log(event.type)",
                    '%% @action hello: console.log("hi")',
                    "[*] --> a",
                    "a --> b: X / inc, log, hello",
                ),
            ),
        );
        expect(code).toContain(
            '            inc: mutate(({ context }: ActionArgs<Context, Extract<Events, { type: "X" }>>) => {\n' +
                "                context.n += 1\n" +
                "            }),",
        );
        expect(code).toContain(
            '            log: ({ event }: ActionArgs<Context, Extract<Events, { type: "X" }>>) => {\n' +
                "                console.log(event.type)\n" +
                "            },",
        );
        expect(code).toContain('            hello: () => {\n                console.log("hi")\n            },');
    });

    it("types delays with ActionArgs<Context, MachineEvent<Events>>", () => {
        const code = emit(
            parse(mmd(...HEADER, ...TYPED, "%% @delay slow: context.n * 2", "[*] --> a", "a --> b: after slow")),
        );
        expect(code).toContain(
            "        delays: {\n            slow: ({ context }: ActionArgs<Context, MachineEvent<Events>>) => (context.n * 2),\n        },",
        );
    });

    it("renders multi-line expression and statement bodies re-indented", () => {
        const code = emit(
            parse(
                mmd(
                    ...HEADER,
                    ...TYPED,
                    "%% @guard g:",
                    "%%     context.n > 0 &&",
                    "%%     context.n < 10",
                    "%% @action act:",
                    "%%     if (context.n > 0) {",
                    "%%         context.n -= 1",
                    "%%     }",
                    "[*] --> a",
                    "a --> b: X [g] / act",
                ),
            ),
        );
        expect(code).toContain(
            '            g: ({ context }: GuardArgs<Context, Extract<Events, { type: "X" }>>) => (\n' +
                "                context.n > 0 &&\n" +
                "                context.n < 10\n" +
                "            ),",
        );
        expect(code).toContain(
            '            act: mutate(({ context }: ActionArgs<Context, Extract<Events, { type: "X" }>>) => {\n' +
                "                if (context.n > 0) {\n" +
                "                    context.n -= 1\n" +
                "                }\n" +
                "            }),",
        );
    });

    it("omits the second createMachine argument when there are no implementations", () => {
        const code = emit(parse(mmd(...HEADER, "[*] --> a", "a --> b: X")));
        expect(code).toMatch(/\n {8}states: \{ a: \{ on: \{ X: "b" \} \}, b: \{\} \},\n {4}\},\n\);\n$/);
        expect(code).not.toContain("guards:");
        expect(code).not.toContain("actions:");
        expect(code).not.toContain("delays:");
    });

    it("emits the tables in the order guards, actions, delays", () => {
        const code = emit(
            parse(
                mmd(
                    ...HEADER,
                    ...TYPED,
                    "%% @delay slow: 100",
                    "%% @action inc: context.n += 1",
                    "%% @guard g: true",
                    "[*] --> a",
                    "a --> b: after slow [g] / inc",
                ),
            ),
        );
        const guards = code.indexOf("        guards: {");
        const actions = code.indexOf("        actions: {");
        const delays = code.indexOf("        delays: {");
        expect(guards).toBeGreaterThan(0);
        expect(actions).toBeGreaterThan(guards);
        expect(delays).toBeGreaterThan(actions);
    });
});

describe("analyzeBodyUsage", () => {
    it("ignores property names, string and comment mentions", () => {
        expect(analyzeBodyUsage("x.context", "expression")).toEqual({ context: false, event: false });
        expect(analyzeBodyUsage("({ context: 1, event: 2 })", "expression")).toEqual({ context: false, event: false });
        expect(analyzeBodyUsage('"context" + "event"', "expression")).toEqual({ context: false, event: false });
        expect(analyzeBodyUsage("// context event\nreturn 1", "statements")).toEqual({ context: false, event: false });
        expect(analyzeBodyUsage("context: for (;;) { break context }", "statements")).toEqual({
            context: false,
            event: false,
        });
    });

    it("counts references, shorthand properties included", () => {
        expect(analyzeBodyUsage("({ context })", "expression")).toEqual({ context: true, event: false });
        expect(analyzeBodyUsage("context.a", "expression")).toEqual({ context: true, event: false });
        expect(analyzeBodyUsage("event.type", "expression")).toEqual({ context: false, event: true });
        expect(analyzeBodyUsage("context.a = event.b", "statements")).toEqual({ context: true, event: true });
    });
});

describe("printValue", () => {
    it("prints short values inline", () => {
        expect(printValue({ a: 1, b: "x", c: ["p", "q"], d: null, e: true }, "")).toBe(
            '{ a: 1, b: "x", c: ["p", "q"], d: null, e: true }',
        );
        expect(printValue([], "")).toBe("[]");
        expect(printValue({}, "")).toBe("{}");
    });

    it("quotes keys that are neither identifiers nor integers", () => {
        expect(printValue({ $final: { type: "final" }, 3000: "b", "a-b": 1, "x.y": 2 }, "")).toBe(
            '{ 3000: "b", $final: { type: "final" }, "a-b": 1, "x.y": 2 }',
        );
    });

    it("wraps objects that do not fit into the line, with trailing commas", () => {
        const states = {
            off: { on: { POWER_ON: { target: "working", guard: "hasPower", actions: ["logStart"] } } },
            working: { on: { POWER_OFF: "off" } },
        };
        expect(printValue(states, "")).toBe(
            [
                "{",
                '    off: { on: { POWER_ON: { target: "working", guard: "hasPower", actions: ["logStart"] } } },',
                '    working: { on: { POWER_OFF: "off" } },',
                "}",
            ].join("\n"),
        );
    });

    it("takes the indent into account when deciding to wrap", () => {
        const value = { key: "x".repeat(80) };
        expect(printValue(value, "")).toBe(`{ key: "${"x".repeat(80)}" }`);
        expect(printValue(value, " ".repeat(16))).toBe(
            `{\n${" ".repeat(20)}key: "${"x".repeat(80)}",\n${" ".repeat(16)}}`,
        );
    });

    it("wraps long arrays one element per line", () => {
        const candidates = [
            { target: "done", guard: "isFinite", actions: ["square"] },
            { target: "error", guard: "isNegative", actions: ["reject"] },
            { target: "retry", actions: ["log"] },
        ];
        expect(printValue(candidates, "    ")).toBe(
            [
                "[",
                '        { target: "done", guard: "isFinite", actions: ["square"] },',
                '        { target: "error", guard: "isNegative", actions: ["reject"] },',
                '        { target: "retry", actions: ["log"] },',
                "    ]",
            ].join("\n"),
        );
    });
});
