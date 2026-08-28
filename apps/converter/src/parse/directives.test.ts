import { describe, expect, it } from "vitest";

import { StatechartParseError } from "../StatechartParseError.js";

import { parseDirectives, type BodySource, type DirectiveSet } from "./directives.js";
import { splitLines } from "./lines.js";

function parse(text: string): DirectiveSet {
    return parseDirectives(splitLines(text));
}

function body(text: string, line: number, lines: Array<[line: number, column: number]>): BodySource {
    return { text, line, lines: lines.map(([lineNumber, column]) => ({ line: lineNumber, column })) };
}

function capture(text: string): StatechartParseError {
    try {
        parse(text);
    } catch (error) {
        if (error instanceof StatechartParseError) return error;
        throw error;
    }
    throw new Error("expected a StatechartParseError");
}

function expectError(text: string, message: string, line: number, column?: number): void {
    expect(() => parse(text)).toThrow(StatechartParseError);
    const error = capture(text);
    expect(error.message).toContain(message);
    expect(error.line).toBe(line);
    if (column !== undefined) expect(error.column).toBe(column);
}

describe("parseDirectives", () => {
    describe("bodies", () => {
        it("reads an inline body after `:`", () => {
            const set = parse("%% @guard hasPower: context.power\n");
            expect(set.guards.get("hasPower")).toEqual(body("context.power", 1, [[1, 21]]));
        });

        it("reads a multi-line body from continuation lines", () => {
            const set = parse(
                ["%% @action square:", "%%     context.result = 1", "%%     context.error = null"].join("\n"),
            );
            expect(set.actions.get("square")).toEqual(
                body("context.result = 1\ncontext.error = null", 1, [
                    [2, 8],
                    [3, 8],
                ]),
            );
        });

        it("combines the inline part with continuation lines", () => {
            const set = parse(["%% @action foo: if (x) {", "%%     y()", "%% }"].join("\n"));
            expect(set.actions.get("foo")).toEqual(
                body("if (x) {\n    y()\n}", 1, [
                    [1, 17],
                    [2, 4],
                    [3, 4],
                ]),
            );
        });

        it("strips the common indent of continuation lines (spaces)", () => {
            const set = parse(["%% @action a:", "%%       if (x) {", "%%           y()", "%%       }"].join("\n"));
            expect(set.actions.get("a")?.text).toBe("if (x) {\n    y()\n}");
        });

        it("strips the common indent of continuation lines (tabs)", () => {
            const set = parse(["%% @action a:", "%%\t\tfoo()", "%%\t\t\tbar()"].join("\n"));
            expect(set.actions.get("a")).toEqual(
                body("foo()\n\tbar()", 1, [
                    [2, 5],
                    [3, 5],
                ]),
            );
        });

        it("keeps blank `%%` lines inside a body and trims leading / trailing ones", () => {
            const set = parse(
                ["%% @action a:", "%%", "%%     foo()", "%%", "%%     bar()", "%%", "%%   ", "[*] --> x"].join("\n"),
            );
            expect(set.actions.get("a")).toEqual(
                body("foo()\n\nbar()", 1, [
                    [3, 8],
                    [4, 3],
                    [5, 8],
                ]),
            );
        });

        it("ends the body at a `%%text` comment without a space", () => {
            const set = parse(["%% @action a:", "%%     foo()", "%%comment", "%%     notBody()"].join("\n"));
            expect(set.actions.get("a")?.text).toBe("foo()");
        });

        it("ends the body at the next `%% @` directive", () => {
            const set = parse(["%% @action a:", "%%     foo()", "%% @action b:", "%%     bar()"].join("\n"));
            expect(set.actions.get("a")?.text).toBe("foo()");
            expect(set.actions.get("b")?.text).toBe("bar()");
        });

        it("ends the body at any non-`%%` line", () => {
            const set = parse(["%% @action a:", "%%     foo()", "a --> b", "%%     notBody()"].join("\n"));
            expect(set.actions.get("a")?.text).toBe("foo()");
        });

        it("maps the lines of an inline body to the directive line and column", () => {
            const set = parse("    %% @delay slow:   context.speed * 2\n");
            expect(set.delays.get("slow")).toEqual(body("context.speed * 2", 1, [[1, 23]]));
        });

        it("maps continuation lines to their own source lines after the indent", () => {
            const set = parse(
                ["stateDiagram-v2", "    %% @context initial:", "    %%     { a: 1,", "    %%       b: 2 }"].join("\n"),
            );
            expect(set.contextInitial).toEqual(
                body("{ a: 1,\n  b: 2 }", 2, [
                    [3, 12],
                    [4, 12],
                ]),
            );
        });

        it("accepts `%%@kind` without a space", () => {
            expect(parse("%%@machine m\n").machine).toEqual({ id: "m", line: 1 });
        });

        it("accepts `:` directly after the head and spaces before `:`", () => {
            const set = parse(["%% @event SQUARE:{ value: number }", "%% @guard g : true"].join("\n"));
            expect(set.events.get("SQUARE")?.text).toBe("{ value: number }");
            expect(set.guards.get("g")).toEqual(body("true", 2, [[2, 15]]));
        });
    });

    describe("placement", () => {
        it("reads directives before the header, at the root and inside `state X { }`", () => {
            const set = parse(
                [
                    "%% @machine m",
                    "stateDiagram-v2",
                    "    %% @guard g: true",
                    "    [*] --> a",
                    "    state a {",
                    "        %% @action act: foo()",
                    "        [*] --> b",
                    "    }",
                ].join("\n"),
            );
            expect(set.machine).toEqual({ id: "m", line: 1 });
            expect(set.guards.get("g")?.line).toBe(3);
            expect(set.actions.get("act")?.line).toBe(6);
        });

        it("accepts CRLF input", () => {
            const set = parse("%% @machine m\r\n%% @action a:\r\n%%     foo()\r\n%%     bar()\r\n");
            expect(set.machine).toEqual({ id: "m", line: 1 });
            expect(set.actions.get("a")?.text).toBe("foo()\nbar()");
        });

        it("returns every table, empty by default", () => {
            expect(parse("stateDiagram-v2\n")).toEqual({
                machine: null,
                contextType: null,
                contextInitial: null,
                events: new Map(),
                guards: new Map(),
                actions: new Map(),
                delays: new Map(),
            });
        });

        it("fills @context type and initial separately", () => {
            const set = parse(["%% @context type: { a: number }", "%% @context initial: { a: 1 }"].join("\n"));
            expect(set.contextType).toEqual(body("{ a: number }", 1, [[1, 19]]));
            expect(set.contextInitial).toEqual(body("{ a: 1 }", 2, [[2, 22]]));
        });
    });

    describe("errors", () => {
        it("rejects an unknown kind", () => {
            expectError("stateDiagram-v2\n%% @foo bar: 1\n", "unknown directive @foo", 2, 5);
        });

        it("rejects a missing kind", () => {
            expectError("%% @\n", "missing directive kind", 1, 5);
        });

        it("rejects a malformed header (text after the head without `:`)", () => {
            expectError("%% @machine a b\n", "unexpected text in directive @machine", 1, 15);
        });

        it("rejects @machine without an id", () => {
            expectError("%% @machine\n", "requires a name", 1, 12);
        });

        it("rejects @machine with an invalid id", () => {
            expectError("%% @machine 1abc\n", 'invalid name "1abc"', 1, 13);
        });

        it("rejects @machine with an inline body", () => {
            expectError("%% @machine m: body\n", "does not take a body", 1, 16);
        });

        it("rejects @machine with a continuation body", () => {
            expectError("%% @machine m\n%%   free comment\n", "does not take a body", 2, 6);
        });

        it("rejects a duplicate @machine", () => {
            expectError(
                "%% @machine a\n%% @machine b\n",
                "duplicate @machine directive (first declared at line 1)",
                2,
                5,
            );
        });

        it("rejects @context with a wrong head", () => {
            expectError("%% @context foo: 1\n", 'expects `type` or `initial`, got "foo"', 1, 13);
        });

        it("rejects @context without a head", () => {
            expectError("%% @context: 1\n", "expects `type` or `initial`", 1, 12);
        });

        it("rejects a duplicate @context type", () => {
            expectError(
                "%% @context type: A\n%% @context type: B\n",
                "duplicate directive @context type (first declared at line 1)",
                2,
                13,
            );
        });

        it("rejects `after` and `done` as event names", () => {
            expectError("%% @event after: {}\n", "reserved trigger keyword", 1, 11);
            expectError("%% @event done: {}\n", "reserved trigger keyword", 1, 11);
        });

        it("rejects invalid names", () => {
            expectError("%% @guard 1abc: true\n", 'invalid name "1abc"', 1, 11);
            expectError("%% @action a-b: x()\n", 'invalid name "a-b"', 1, 12);
        });

        it("rejects duplicate @guard / @action / @delay / @event", () => {
            expectError(
                "%% @guard g: 1\n%% @guard g: 2\n",
                "duplicate directive @guard g (first declared at line 1)",
                2,
                11,
            );
            expectError("%% @action a: x()\n%% @action a: y()\n", "duplicate directive @action a", 2, 12);
            expectError("%% @delay d: 1\n%% @delay d: 2\n", "duplicate directive @delay d", 2, 11);
            expectError("%% @event E: {}\n%% @event E: {}\n", "duplicate directive @event E", 2, 11);
        });

        it("allows the same name in different kinds", () => {
            const set = parse("%% @guard x: true\n%% @action x: foo()\n%% @delay x: 1\n%% @event x: {}\n");
            expect([...set.guards.keys()]).toEqual(["x"]);
            expect([...set.actions.keys()]).toEqual(["x"]);
            expect([...set.delays.keys()]).toEqual(["x"]);
            expect([...set.events.keys()]).toEqual(["x"]);
        });

        it("rejects empty bodies", () => {
            expectError("%% @guard g:\n[*] --> a\n", "directive @guard g has an empty body", 1);
            expectError("%% @guard g\n", "directive @guard g has an empty body", 1);
            expectError("%% @context type:\n", "directive @context type has an empty body", 1);
            expectError("%% @event E:\n%%\n", "directive @event E has an empty body", 1);
        });

        it("rejects mermaid init directives anywhere", () => {
            expectError("%%{init: {'theme':'dark'}}%%\nstateDiagram-v2\n", "mermaid init directives", 1);
            expectError("stateDiagram-v2\n    %%{init: {}}%%\n", "mermaid init directives", 2);
            expectError("%% @action a:\n%%     foo()\n%%{init: {}}%%\n", "mermaid init directives", 3);
        });
    });
});
