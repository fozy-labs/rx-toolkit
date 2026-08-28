/**
 * Differential tests against the pinned mermaid 11.17.2:
 *
 * 1. statement tree — our `parseDiagram` vs `getRootDocV2()` for every accepted diagram;
 * 2. placement — the block each state is drawn in (`getData()` parent ids) vs our ownership;
 * 3. quirks — constructs mermaid accepts but renders as something else than
 *    written; we reject them, and these tests pin both behaviours.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseDiagram, type Statement } from "../src/parse/diagram.js";
import { splitLines } from "../src/parse/lines.js";
import { parse } from "../src/parse/parse.js";
import { StatechartParseError } from "../src/StatechartParseError.js";

import { mermaidAccepts, mermaidStateDiagram, type MermaidStatement } from "./mermaidOracle.js";

// --- normalized statement tree -------------------------------------------------

type Norm =
    | { k: "rel"; from: string; to: string; label: string | null }
    | { k: "desc"; id: string; description: string }
    | { k: "choice"; id: string }
    | { k: "block"; id: string; description: string | null; regions: Norm[][] }
    | { k: "note"; id: string }
    | { k: "decl"; id: string }
    | { k: "dir" }
    | { k: "classDef" }
    | { k: "class" };

function normalizeOurs(statements: Statement[]): Norm[] {
    return statements.map((statement): Norm => {
        switch (statement.kind) {
            case "initial":
                return { k: "rel", from: "[*]", to: statement.target, label: null };
            case "transition":
                return { k: "rel", from: statement.source, to: statement.target ?? "[*]", label: statement.label };
            case "description":
                return { k: "desc", id: statement.id, description: statement.description };
            case "choice":
                return { k: "choice", id: statement.id };
            case "block":
                return {
                    k: "block",
                    id: statement.id,
                    description: statement.description,
                    regions: statement.regions.map(normalizeOurs),
                };
            case "note":
                return { k: "note", id: statement.id };
            case "declaration":
                return { k: "decl", id: statement.id };
            case "ignored":
                return statement.keyword === "direction" ? { k: "dir" } : { k: statement.keyword };
        }
    });
}

function normalizeMermaid(doc: MermaidStatement[]): Norm[] {
    return doc.map((statement): Norm => {
        if (typeof statement === "string")
            throw new Error(`mermaid produced a junk statement ${JSON.stringify(statement)}`);
        switch (statement.stmt) {
            case "relation": {
                const { state1, state2, description } = statement;
                return {
                    k: "rel",
                    from: state1.start === undefined ? state1.id : "[*]",
                    to: state2.start === undefined ? state2.id : "[*]",
                    label: description === undefined || description === "" ? null : description,
                };
            }
            case "state": {
                if (statement.note !== undefined) return { k: "note", id: statement.id };
                if (statement.doc !== undefined) {
                    const children = statement.doc;
                    const dividers = children.every(
                        (child) => typeof child !== "string" && child.stmt === "state" && child.type === "divider",
                    );
                    const regions = dividers
                        ? children.map((child) => normalizeMermaid((child as { doc?: MermaidStatement[] }).doc ?? []))
                        : [normalizeMermaid(children)];
                    const description =
                        statement.description === undefined || statement.description === ""
                            ? null
                            : statement.description;
                    return { k: "block", id: statement.id, description, regions };
                }
                if (statement.type === "choice") return { k: "choice", id: statement.id };
                if (statement.description === undefined || statement.description === "") {
                    return { k: "decl", id: statement.id };
                }
                return { k: "desc", id: statement.id, description: statement.description };
            }
            case "dir":
                return { k: "dir" };
            case "classDef":
                return { k: "classDef" };
            case "applyClass":
                return { k: "class" };
            default:
                throw new Error(`unexpected mermaid statement ${JSON.stringify(statement)}`);
        }
    });
}

// --- placement ---------------------------------------------------------------

const PSEUDO_SHAPES = new Set(["stateStart", "stateEnd", "note", "noteGroup", "divider"]);

/** `id → parent` where a region parent is `<composite>.$<index>` (dividers numbered per composite in order). */
async function mermaidPlacement(text: string): Promise<Record<string, string | null>> {
    const { nodes } = await mermaidStateDiagram(text);
    const regions = new Map<string, string>();
    const counters = new Map<string, number>();
    for (const node of nodes) {
        if (node.shape !== "divider") continue;
        const composite = node.parentId ?? "";
        const index = counters.get(composite) ?? 0;
        counters.set(composite, index + 1);
        regions.set(node.id, `${composite}.$${index}`);
    }
    const placement: Record<string, string | null> = {};
    for (const node of nodes) {
        if (node.shape !== undefined && PSEUDO_SHAPES.has(node.shape)) continue;
        placement[node.id] = node.parentId === undefined ? null : (regions.get(node.parentId) ?? node.parentId);
    }
    return placement;
}

function ourPlacement(text: string): Record<string, string | null> {
    const placement: Record<string, string | null> = {};
    for (const state of parse(text).states) {
        if (state.id.includes(".$")) continue;
        placement[state.id] = state.parent ?? null;
    }
    return placement;
}

// --- corpus ------------------------------------------------------------------

function fixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const CORPUS: Record<string, string> = {
    trafficLight: fixture("trafficLight.mmd"),
    square: fixture("square.mmd"),
    "parallel regions, cross-region target, choice": `stateDiagram-v2
    %% @machine m
    %% @guard isOk: true
    %% @guard isBad: false
    [*] --> active
    state active {
        [*] --> a1
        a1 --> a2: X
        a2 --> [*]
        --
        [*] --> b1
        b1 --> b2: Y
    }
    state c <<choice>>
    active --> c: CHECK
    c --> done1: [isOk]
    c --> done2: [isBad]
    c --> done1
    active --> done2: done
`,
    "nested compounds, descriptions, notes, ignored statements": `stateDiagram-v2
    direction LR
    %% @machine nested
    state "Outer state" as a
    [*] --> a
    state a {
        [*] --> b
        state "Inner" as b {
            [*] --> c
            c --> [*]: STOP
        }
        b --> [*]: done
    }
    a --> end1: done
    note right of a: a note
    note left of end1
        multi
        line: with colon
    end note
    classDef active fill:#ffd54f,stroke:#f57f17
    class a,end1 active
    end1:::foo --> a:::bar: AGAIN
`,
    "state pulled into a block by a mention inside it": `stateDiagram-v2
    %% @machine pull
    [*] --> off
    off --> working: ON
    state working {
        [*] --> green
        green --> broken: X
    }
    broken --> off: RESET
`,
    "root transition into a nested state": `stateDiagram-v2
    %% @machine deep
    [*] --> off
    off --> green: DEEP
    state working {
        [*] --> green
        green --> yellow: T
    }
`,
    "directives and comments everywhere, CRLF, tabs": [
        "%% a free comment (a `%%` line right after a directive would continue its body)",
        "%% @machine everywhere",
        "%%@guard g: true",
        "",
        "stateDiagram-v2   ",
        "\t[*] --> a",
        "\t%% @action act:",
        "\t%%     console.log(1)",
        "\t%%",
        "\t%%     console.log(2)",
        "\ta --> b : E [g] / act",
        "\tstate b {",
        "\t\t%% @action inner: console.log(3)",
        "\t\t[*] --> b1",
        "\t\tb1 --> b1: LOOP / inner",
        "\t}",
        "%%",
        "",
    ].join("\r\n"),
    "bare state declarations (toMermaid style)": `stateDiagram-v2
    %% @machine decl
    lonely
    [*] --> a
    a --> b: GO
    state b {
        inner
        [*] --> b1
        b1 --> inner: IN
    }
`,
    "timers, guards on after / done / always": `stateDiagram-v2
    %% @machine timers
    %% @delay slow: 5000
    %% @guard g: true
    %% @action act: void 0
    [*] --> a
    a --> b: after slow [g] / act
    b --> a: after 10 / act, act
    a --> b: [g]
    state b {
        [*] --> b1
        b1 --> [*]
    }
    b --> a: done [g] / act
    a --> [*]: STOP
`,
};

describe("statement tree equals mermaid's getRootDocV2()", () => {
    for (const [name, text] of Object.entries(CORPUS)) {
        it(name, async () => {
            expect(() => parse(text)).not.toThrow();
            const ours = normalizeOurs(parseDiagram(splitLines(text)).statements);
            const theirs = normalizeMermaid((await mermaidStateDiagram(text)).doc);
            expect(ours).toEqual(theirs);
        });
    }
});

describe("state placement equals mermaid's getData() parents", () => {
    for (const [name, text] of Object.entries(CORPUS)) {
        it(name, async () => {
            expect(ourPlacement(text)).toEqual(await mermaidPlacement(text));
        });
    }
});

// --- quirks --------------------------------------------------------------------

function parseError(text: string): StatechartParseError {
    try {
        parse(text);
    } catch (error) {
        if (error instanceof StatechartParseError) return error;
        throw error;
    }
    throw new Error("expected a StatechartParseError");
}

const M = "stateDiagram-v2\n    %% @machine q\n";

describe("mermaid quirks the converter rejects", () => {
    it("`;` truncates a label silently in mermaid; we reject the character", async () => {
        const text = `${M}    %% @action f: void 0\n    %% @action g: void 0\n    [*] --> a\n    a --> b: X / f; g\n`;
        const { relations, states } = await mermaidStateDiagram(text);
        expect(relations.find((relation) => relation.id1 === "a")?.relationTitle).toBe("X / f");
        expect(states).toContain("g");
        const error = parseError(text);
        expect(error.message).toMatch(/statement separator/);
        expect(error.line).toBe(6);
        expect(error.column).toBe(19);
    });

    it("`;` ends a single-line note in mermaid and the rest becomes statements; we reject", async () => {
        const text = `${M}    [*] --> a\n    note right of a: hello; b --> c: HIDDEN\n`;
        const { relations } = await mermaidStateDiagram(text);
        expect(relations.some((relation) => relation.id1 === "b" && relation.id2 === "c")).toBe(true);
        const error = parseError(text);
        expect(error.message).toMatch(/`;` is not allowed in a single-line note/);
        expect(error.line).toBe(4);
        expect(error.column).toBe(27);
    });

    it("`%%` lines are ignored by mermaid anywhere; we read directives from all of them", async () => {
        const withDirectives =
            "%% @machine q\nstateDiagram-v2\n    %% @action act: void 0\n    [*] --> a\n    state w {\n        %% @action inner: void 0\n        [*] --> x\n        x --> y: E / inner\n    }\n    a --> w: GO / act\n";
        const withoutDirectives = withDirectives
            .split("\n")
            .filter((line) => !line.trim().startsWith("%%"))
            .join("\n");
        const [a, b] = await Promise.all([mermaidStateDiagram(withDirectives), mermaidStateDiagram(withoutDirectives)]);
        expect(a.relations).toEqual(b.relations);
        expect(a.doc).toEqual(b.doc);
        const parsed = parse(withDirectives);
        expect(parsed.machineId).toBe("q");
        expect(Object.keys(parsed.actions)).toEqual(["act", "inner"]);
    });

    it("the same id inside two blocks: mermaid keeps the last block only; we reject", async () => {
        const text = `${M}    [*] --> p1\n    state p1 {\n        [*] --> idle\n        idle --> x: A\n    }\n    state p2 {\n        [*] --> idle\n        idle --> y: B\n    }\n    p1 --> p2: GO\n`;
        expect(await mermaidPlacement(text)).toMatchObject({ idle: "p2", x: "p1", y: "p2" });
        const error = parseError(text);
        expect(error.message).toMatch(/duplicate state id "idle"/);
        expect(error.line).toBe(9);
        expect(error.path).toBe("p2");
    });

    it("the same id inside two regions of one block: mermaid keeps the last region; we reject", async () => {
        const text = `${M}    [*] --> p\n    state p {\n        [*] --> b1\n        b1 --> b2: A\n        --\n        [*] --> a1\n        a1 --> b1: X\n    }\n`;
        expect(await mermaidPlacement(text)).toMatchObject({ b1: "p.$1", b2: "p.$0", a1: "p.$1" });
        const error = parseError(text);
        expect(error.message).toMatch(/duplicate state id "b1"/);
        expect(error.line).toBe(9);
        expect(error.path).toBe("p.$1");
    });

    it("root mentions never place a state: a declaration at the root does not pull it back", async () => {
        const text = `${M}    [*] --> off\n    off --> working: ON\n    state working {\n        [*] --> green\n        green --> broken: X\n    }\n    state "Broken" as broken\n    broken --> off: RESET\n`;
        expect(await mermaidPlacement(text)).toMatchObject({ broken: "working", off: null });
        const parsed = parse(text);
        expect(parsed.config.states.working!.states).toHaveProperty("broken", {
            description: "Broken",
            on: { RESET: "#q.off" },
        });
        expect(parsed.config.states).not.toHaveProperty("broken");
    });

    it("a root initial pulled into a block by a mention: mermaid draws it inside; we reject", async () => {
        const text = `${M}    [*] --> off\n    off --> working: ON\n    state working {\n        [*] --> green\n        green --> off: X\n    }\n`;
        expect(await mermaidPlacement(text)).toMatchObject({ off: "working" });
        const error = parseError(text);
        expect(error.message).toMatch(/initial state "off" of the root of the diagram is drawn inside state `working`/);
        expect(error.line).toBe(3);
    });

    it("a labelled initial transition: mermaid keeps the label; we reject", async () => {
        const text = `${M}    [*] --> a: START\n`;
        const { relations } = await mermaidStateDiagram(text);
        expect(relations[0]?.relationTitle).toBe("START");
        expect(parseError(text).message).toMatch(/initial transition .* cannot have a label/);
    });

    it("text after the header: mermaid reads it as a state id; we reject", async () => {
        const text = "stateDiagram-v2 foo\n    %% @machine q\n    [*] --> a\n";
        expect((await mermaidStateDiagram(text)).states).toContain("foo");
        expect(parseError(text).message).toMatch(/unexpected text after the `stateDiagram-v2` header/);
    });

    it("bare `state X` declares nothing in mermaid; we reject", async () => {
        const text = `${M}    state lonely\n    [*] --> a\n`;
        expect((await mermaidStateDiagram(text)).states).not.toContain("lonely");
        expect(parseError(text).message).toMatch(/bare `state lonely` declares nothing/);
    });

    it("unknown stereotypes are junk for mermaid; we reject", async () => {
        for (const stereotype of ["end", "foo"]) {
            const text = `${M}    state e <<${stereotype}>>\n    [*] --> e\n`;
            expect(await mermaidAccepts(text)).toBe(true);
            expect(parseError(text).message).toMatch(/unsupported stereotype/);
        }
        for (const stereotype of ["fork", "join"]) {
            const text = `${M}    state f <<${stereotype}>>\n    [*] --> f\n`;
            expect(await mermaidAccepts(text)).toBe(true);
            expect(parseError(text).message).toMatch(new RegExp(`<<${stereotype}>>.*not supported in v1`));
        }
    });

    it("`X : description` is mermaid syntax outside the subset; we reject", async () => {
        const text = `${M}    a : some description\n    [*] --> a\n`;
        expect(await mermaidAccepts(text)).toBe(true);
        expect(parseError(text).message).toMatch(/`X : description` is not supported/);
    });

    it("`%%` inside a label is label text for mermaid; we reject the character", async () => {
        const text = `${M}    [*] --> a\n    a --> b: X %% comment\n`;
        const { relations } = await mermaidStateDiagram(text);
        expect(relations.find((relation) => relation.id1 === "a")?.relationTitle).toBe("X %% comment");
        expect(parseError(text).message).toMatch(/unexpected character "%"/);
    });

    it("`[H]` is an ordinary state id for mermaid; we reject history", async () => {
        const text = `${M}    [*] --> a\n    a --> [H]\n`;
        expect((await mermaidStateDiagram(text)).states).toContain("[H]");
        expect(parseError(text).message).toMatch(/history states/);
    });

    it("front matter and `%%{init}` are mermaid features outside the subset; we reject", async () => {
        const frontMatter = "---\ntitle: q\n---\nstateDiagram-v2\n    %% @machine q\n    [*] --> a\n";
        expect(await mermaidAccepts(frontMatter)).toBe(true);
        expect(parseError(frontMatter).message).toMatch(/front matter/);
        const init = "%%{init: {'theme': 'dark'}}%%\nstateDiagram-v2\n    %% @machine q\n    [*] --> a\n";
        expect(await mermaidAccepts(init)).toBe(true);
        expect(parseError(init).message).toMatch(/init directives/);
    });

    it('constructs both sides reject: hyphenated ids, `--` at the root, `\\"` in a description', async () => {
        const hyphen = `${M}    [*] --> my-state\n`;
        expect(await mermaidAccepts(hyphen)).toBe(false);
        expect(parseError(hyphen).message).toMatch(/invalid state id "my-state"/);
        const divider = `${M}    [*] --> a\n    --\n    [*] --> b\n`;
        expect(await mermaidAccepts(divider)).toBe(false);
        expect(parseError(divider).message).toMatch(/`--` .* only allowed inside/);
        const escapedQuote = `${M}    state "a\\"b" as x\n    [*] --> x\n`;
        expect(await mermaidAccepts(escapedQuote)).toBe(false);
        expect(parseError(escapedQuote).message).toMatch(/malformed description/);
    });

    it("`;` splits statements in mermaid; we reject it anywhere in a transition line", async () => {
        const text = `${M}    [*] --> a\n    a --> b; b --> c: Y\n`;
        const { relations } = await mermaidStateDiagram(text);
        expect(relations.some((relation) => relation.id1 === "b" && relation.id2 === "c")).toBe(true);
        const error = parseError(text);
        expect(error.message).toMatch(/statement separator/);
        expect(error.line).toBe(4);
        expect(error.column).toBe(12);
    });
});
