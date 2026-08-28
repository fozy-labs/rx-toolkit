import { describe, expect, it } from "vitest";

import { StatechartParseError } from "../StatechartParseError.js";

import { parseDiagram, type Diagram, type Statement } from "./diagram.js";
import { splitLines } from "./lines.js";

function parse(text: string): Diagram {
    return parseDiagram(splitLines(text));
}

/** Parses `lines` under the header; statement lines start at line 2. */
function statements(...lines: string[]): Statement[] {
    return parse(["stateDiagram-v2", ...lines].join("\n")).statements;
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

/** `expectError` for a body under the header: line numbers are offset by the header. */
function expectBodyError(body: string[], message: string, line: number, column?: number): void {
    expectError(["stateDiagram-v2", ...body].join("\n"), message, line, column);
}

describe("parseDiagram", () => {
    describe("header", () => {
        it("skips blank and `%%` lines before the header", () => {
            const diagram = parse("\n%% @machine m\n   \n  %% comment\nstateDiagram-v2\n    [*] --> a\n");
            expect(diagram.headerLine).toBe(5);
            expect(diagram.statements).toHaveLength(1);
        });

        it("accepts tabs and trailing spaces", () => {
            const diagram = parse("stateDiagram-v2   \n\t[*] --> a\n\ta --> b: X\n");
            expect(diagram.headerLine).toBe(1);
            expect(diagram.statements.map((statement) => statement.kind)).toEqual(["initial", "transition"]);
        });

        it("accepts an empty diagram body", () => {
            expect(parse("stateDiagram-v2\n")).toEqual({ headerLine: 1, statements: [] });
        });
    });

    describe("statements", () => {
        it("initial transition", () => {
            expect(statements("    [*] --> off")).toEqual([
                { kind: "initial", line: 2, target: "off", targetColumn: 13 },
            ]);
        });

        it("transition without a label", () => {
            expect(statements("    a --> b")).toEqual([
                {
                    kind: "transition",
                    line: 2,
                    source: "a",
                    sourceColumn: 5,
                    target: "b",
                    targetColumn: 11,
                    label: null,
                    labelColumn: 12,
                },
            ]);
        });

        it("transition with a label", () => {
            expect(statements("    off --> working: POWER_ON [hasPower] / logStart")).toEqual([
                {
                    kind: "transition",
                    line: 2,
                    source: "off",
                    sourceColumn: 5,
                    target: "working",
                    targetColumn: 13,
                    label: "POWER_ON [hasPower] / logStart",
                    labelColumn: 22,
                },
            ]);
        });

        it("tolerates spacing variants around `-->` and `:`", () => {
            const [spaced, tight, colonSpace] = statements("    a --> b : X", "    a-->b:X", "    a --> b :X   ");
            expect(spaced).toMatchObject({ source: "a", target: "b", label: "X", labelColumn: 15 });
            expect(tight).toMatchObject({ source: "a", target: "b", targetColumn: 9, label: "X", labelColumn: 11 });
            expect(colonSpace).toMatchObject({ source: "a", target: "b", label: "X", labelColumn: 14 });
        });

        it("treats an empty label as no label", () => {
            expect(statements("    a --> b:", "    a --> b:   ")).toEqual([
                expect.objectContaining({ label: null }),
                expect.objectContaining({ label: null }),
            ]);
        });

        it("transition to `[*]`", () => {
            expect(statements("    red --> [*]: FAULT")).toEqual([
                {
                    kind: "transition",
                    line: 2,
                    source: "red",
                    sourceColumn: 5,
                    target: null,
                    targetColumn: 13,
                    label: "FAULT",
                    labelColumn: 18,
                },
            ]);
        });

        it("strips `:::class` on both ends of a transition", () => {
            expect(statements("    a:::foo --> b:::bar: E")).toEqual([
                {
                    kind: "transition",
                    line: 2,
                    source: "a",
                    sourceColumn: 5,
                    target: "b",
                    targetColumn: 17,
                    label: "E",
                    labelColumn: 26,
                },
            ]);
            expect(statements("    a:::foo --> b:::bar")).toEqual([
                expect.objectContaining({ source: "a", target: "b", label: null }),
            ]);
        });

        it('state "desc" as X', () => {
            expect(statements('    state "Waiting for input" as w')).toEqual([
                { kind: "description", line: 2, id: "w", idColumn: 34, description: "Waiting for input" },
            ]);
        });

        it('state "desc" as X { … }', () => {
            expect(statements('    state "Desc" as a {', "        [*] --> x", "    }")).toEqual([
                {
                    kind: "block",
                    line: 2,
                    endLine: 4,
                    id: "a",
                    idColumn: 21,
                    description: "Desc",
                    regions: [[{ kind: "initial", line: 3, target: "x", targetColumn: 17 }]],
                    hasDividers: false,
                },
            ]);
        });

        it("state X { … } with nested blocks and endLine", () => {
            const result = statements(
                "    state a {",
                "        [*] --> b",
                "        state b {",
                "            [*] --> c",
                "            c --> [*]",
                "        }",
                "        b --> [*]: done",
                "    }",
                "    a --> z: X",
            );
            expect(result).toEqual([
                {
                    kind: "block",
                    line: 2,
                    endLine: 9,
                    id: "a",
                    idColumn: 11,
                    description: null,
                    hasDividers: false,
                    regions: [
                        [
                            { kind: "initial", line: 3, target: "b", targetColumn: 17 },
                            {
                                kind: "block",
                                line: 4,
                                endLine: 7,
                                id: "b",
                                idColumn: 15,
                                description: null,
                                hasDividers: false,
                                regions: [
                                    [
                                        { kind: "initial", line: 5, target: "c", targetColumn: 21 },
                                        expect.objectContaining({
                                            kind: "transition",
                                            line: 6,
                                            source: "c",
                                            target: null,
                                        }),
                                    ],
                                ],
                            },
                            expect.objectContaining({
                                kind: "transition",
                                line: 8,
                                source: "b",
                                target: null,
                                label: "done",
                            }),
                        ],
                    ],
                },
                expect.objectContaining({ kind: "transition", line: 10, source: "a", target: "z", label: "X" }),
            ]);
        });

        it("accepts `} ` with trailing whitespace and `{` preceded by no space", () => {
            const [block] = statements("    state a{", "        [*] --> x", "    }  ");
            expect(block).toMatchObject({ kind: "block", id: "a", endLine: 4 });
        });

        it("`--` splits a block into regions", () => {
            const [block] = statements(
                "    state active {",
                "        [*] --> a1",
                "        a1 --> a2: X",
                "        --",
                "        [*] --> b1",
                "        --",
                "        [*] --> c1",
                "    }",
            );
            expect(block).toMatchObject({ kind: "block", id: "active", hasDividers: true, endLine: 9 });
            const regions = (block as Extract<Statement, { kind: "block" }>).regions;
            expect(regions).toHaveLength(3);
            expect(regions.map((region) => region.map((statement) => statement.kind))).toEqual([
                ["initial", "transition"],
                ["initial"],
                ["initial"],
            ]);
        });

        it("keeps an empty region (validated later by the builder)", () => {
            const [block] = statements("    state a {", "        --", "        [*] --> x", "    }");
            expect((block as Extract<Statement, { kind: "block" }>).regions).toEqual([
                [],
                [{ kind: "initial", line: 4, target: "x", targetColumn: 17 }],
            ]);
        });

        it("state X <<choice>> with and without a space", () => {
            expect(statements("    state c <<choice>>", "    state d<<choice>>", "    state e << choice >>")).toEqual([
                { kind: "choice", line: 2, id: "c", idColumn: 11 },
                { kind: "choice", line: 3, id: "d", idColumn: 11 },
                { kind: "choice", line: 4, id: "e", idColumn: 11 },
            ]);
        });

        it("single-line note", () => {
            expect(statements("    note right of off: hello", "    note left of a:", "    note left of b : x")).toEqual(
                [
                    { kind: "note", line: 2, id: "off", idColumn: 19 },
                    { kind: "note", line: 3, id: "a", idColumn: 18 },
                    { kind: "note", line: 4, id: "b", idColumn: 18 },
                ],
            );
        });

        it("block note swallows statement-looking lines until `end note`", () => {
            expect(
                statements(
                    "    note left of broken",
                    "        a --> b: X",
                    "        state q {",
                    "        }",
                    "    end note",
                    "    a --> b",
                ),
            ).toEqual([
                { kind: "note", line: 2, id: "broken", idColumn: 18 },
                expect.objectContaining({ kind: "transition", line: 7, source: "a", target: "b" }),
            ]);
        });

        it("accepts a bare id on its own line as a declaration (mermaid's plain state statement)", () => {
            expect(statements("    lonely", "    state a {", "        inner", "    }")).toEqual([
                { kind: "declaration", line: 2, id: "lonely", idColumn: 5 },
                expect.objectContaining({
                    kind: "block",
                    id: "a",
                    regions: [[{ kind: "declaration", line: 4, id: "inner", idColumn: 9 }]],
                }),
            ]);
        });

        it("strips `:::class` from a bare declaration", () => {
            // Currently fails: the `X : description` check runs before the declaration branch and catches `:::`.
            expect(statements("    other:::cls")).toEqual([{ kind: "declaration", line: 2, id: "other", idColumn: 5 }]);
        });

        it("ignores direction, classDef and class", () => {
            expect(
                statements(
                    "    direction LR",
                    "    classDef active fill:#ffd54f,stroke:#f57f17",
                    "    class a,b active",
                ),
            ).toEqual([
                { kind: "ignored", line: 2, keyword: "direction" },
                { kind: "ignored", line: 3, keyword: "classDef" },
                { kind: "ignored", line: 4, keyword: "class" },
            ]);
        });

        it("skips `%%` lines and blank lines inside blocks", () => {
            const [block] = statements(
                "    state w {",
                "        %% @action warn: x = { y: 1 } => z; ",
                "",
                "        [*] --> g",
                "    }",
            );
            expect((block as Extract<Statement, { kind: "block" }>).regions[0]).toHaveLength(1);
        });
    });

    describe("errors", () => {
        it("rejects a missing header", () => {
            expectError("", "missing `stateDiagram-v2` header", 1);
            expectError("%% @machine m\n\n", "missing `stateDiagram-v2` header", 3);
        });

        it("rejects the v1 header", () => {
            expectError("stateDiagram\n    [*] --> a\n", "only `stateDiagram-v2` diagrams are supported", 1);
        });

        it("rejects text after the header", () => {
            expectError("stateDiagram-v2 foo\n", "unexpected text after the `stateDiagram-v2` header", 1);
        });

        it("rejects other diagram types", () => {
            expectError("flowchart LR\n    a --> b\n", "expected the `stateDiagram-v2` header", 1);
        });

        it("rejects YAML front matter", () => {
            expectError("---\ntitle: x\n---\nstateDiagram-v2\n", "YAML front matter is not supported", 1);
        });

        it("rejects `[*] --> [*]`", () => {
            expectBodyError(["    [*] --> [*]"], "`[*] --> [*]` is not supported", 2, 13);
        });

        it("rejects a labelled initial transition", () => {
            expectBodyError(["    [*] --> a: START"], "initial transition (`[*] --> X`) cannot have a label", 2, 16);
        });

        it("rejects `}` at the root", () => {
            expectBodyError(["    [*] --> a", "    }"], "unexpected `}` at the root", 3);
        });

        it("rejects `--` at the root", () => {
            expectBodyError(
                ["    a --> b", "    --", "    c --> d"],
                "`--` (parallel regions) is only allowed inside",
                3,
            );
        });

        it("rejects an unclosed block at the block's line", () => {
            expectBodyError(["    [*] --> a", "    state a {", "        [*] --> b"], "unclosed block of state `a`", 3);
        });

        it("rejects a bare `state X`", () => {
            expectBodyError(["    state a", "    a --> b"], "bare `state a` declares nothing", 2, 11);
        });

        it("rejects fork / join / other stereotypes", () => {
            expectBodyError(["    state f <<fork>>"], "`<<fork>>` is not supported in v1", 2, 13);
            expectBodyError(["    state j <<join>>"], "`<<join>>` is not supported in v1", 2, 13);
            expectBodyError(["    state e <<end>>"], "unsupported stereotype `<<end>>`", 2, 13);
            expectBodyError(["    state e<<foo>>"], "unsupported stereotype `<<foo>>`", 2, 12);
        });

        it("rejects a described choice", () => {
            expectBodyError(['    state "Desc" as c <<choice>>'], "choice state cannot have a description", 2, 21);
        });

        it("rejects `:::class` in state declarations", () => {
            expectBodyError(["    state a:::cls"], "`:::class` is only supported on transition ends", 2, 11);
            expectBodyError(['    state "D" as a:::cls'], "`:::class` is only supported on transition ends", 2, 18);
        });

        it("rejects a one-line block", () => {
            expectBodyError(["    state a { [*] --> x }"], "must open with `{` at the end of its line", 2, 11);
            expectBodyError(['    state "D" as a { [*] --> x }'], "must open with `{` at the end of its line", 2, 18);
        });

        it("rejects `X : description`", () => {
            expectBodyError(["    a : some description"], "`X : description` is not supported", 2);
        });

        it("rejects unknown statements", () => {
            expectBodyError(["    title Hello"], 'unsupported statement "title Hello"', 2);
            expectBodyError(["    style a fill:#f00"], 'unsupported statement "style a fill:#f00"', 2);
        });

        it("rejects an unterminated note", () => {
            expectBodyError(
                ["    [*] --> a", "    note right of a", "        text end note", "    a --> b"],
                "unterminated note block",
                3,
            );
        });

        it('rejects the old `note "x" as N` syntax', () => {
            expectBodyError(['    note "x" as N'], "unsupported `note` statement", 2);
        });

        it("rejects a `%%` comment after a transition", () => {
            expectBodyError(
                ["    a --> b %% comment"],
                "`%%` comments are only recognized at the start of a line",
                2,
                13,
            );
        });

        it("rejects `;` anywhere in a transition line at the column of the `;`", () => {
            expectBodyError(["    a --> b; b --> c"], "mermaid reads it as a statement separator", 2, 12);
            expectBodyError(["    a --> b: X / f; g"], "mermaid reads it as a statement separator", 2, 19);
        });

        it("rejects invalid state ids", () => {
            expectBodyError(["    my-state --> b"], 'invalid state id "my-state"', 2, 5);
            expectBodyError(["    a --> my-state"], 'invalid state id "my-state"', 2, 11);
            expectBodyError(["    a.b --> c"], 'invalid state id "a.b"', 2, 5);
            expectBodyError(["    1a --> b"], 'invalid state id "1a"', 2, 5);
            expectBodyError(['    state "d" as 1a'], 'invalid state id "1a"', 2, 18);
        });

        it("rejects reserved `$` ids", () => {
            expectBodyError(["    $final --> c"], 'state id "$final" is reserved', 2, 5);
            expectBodyError(["    [*] --> $0"], 'state id "$0" is reserved', 2, 13);
        });

        it("rejects history pseudo-states as source and target", () => {
            expectBodyError(["    a --> [H]"], "history states (`[H]`, `[H*]`) are not supported", 2, 11);
            expectBodyError(["    [H] --> a"], "history states (`[H]`, `[H*]`) are not supported", 2, 5);
            expectBodyError(["    a --> [H*]"], "history states (`[H]`, `[H*]`) are not supported", 2, 11);
            expectBodyError(["    [*] --> [H*]"], "history states (`[H]`, `[H*]`) are not supported", 2, 13);
        });

        it("validates bare declarations through the state id rules", () => {
            expectBodyError(["    1a"], 'invalid state id "1a"', 2, 5);
            expectBodyError(["    $x"], 'state id "$x" is reserved', 2, 5);
            expectBodyError(["    [H]"], "history states (`[H]`, `[H*]`) are not supported", 2, 5);
            expectBodyError(["    [H*]"], "history states (`[H]`, `[H*]`) are not supported", 2, 5);
            expectBodyError(["    [*]"], 'invalid state id "[*]"', 2, 5);
        });

        it("rejects `;` inside a single-line note at the column of the `;`", () => {
            expectBodyError(["    note right of a: x; y"], "`;` is not allowed in a single-line note", 2, 23);
            expectBodyError(["    note left of a: ;"], "`;` is not allowed in a single-line note", 2, 21);
        });

        it("rejects an invalid direction", () => {
            expectBodyError(["    direction XX"], "invalid `direction` statement", 2);
        });

        it("rejects a missing source or target", () => {
            expectBodyError(["    --> b"], "missing source state before `-->`", 2);
            expectBodyError(["    a -->"], "missing target state after `-->`", 2, 10);
        });
    });
});
