import { describe, expect, it } from "vitest";

import { StatechartParseError } from "../StatechartParseError.js";

import { parse } from "./parse.js";

/** Joins lines with `\n` (+ trailing newline) so that line numbers are `index + 1`. */
function mmd(...lines: string[]): string {
    return `${lines.join("\n")}\n`;
}

function failing(text: string): StatechartParseError {
    try {
        parse(text);
    } catch (error) {
        if (error instanceof StatechartParseError) return error;
        throw error;
    }
    throw new Error("expected parse() to throw StatechartParseError");
}

const HEADER = ["stateDiagram-v2", "%% @machine m"];

describe("parse: config shape", () => {
    it("maps [*] --> A to initial and A --> [*] to a sibling $final appended last", () => {
        const { config } = parse(mmd(...HEADER, "[*] --> a", "a --> [*]: X"));
        expect(config.id).toBe("m");
        expect(config.initial).toBe("a");
        expect(config.states).toEqual({ a: { on: { X: "$final" } }, $final: { type: "final" } });
        expect(Object.keys(config.states)).toEqual(["a", "$final"]);
    });

    it("targets a non-sibling $final by absolute path", () => {
        const { config } = parse(mmd(...HEADER, "[*] --> a", "state a {", "    [*] --> b", "}", "b --> [*]: X"));
        expect(config.states).toEqual({
            a: { initial: "b", states: { b: { on: { X: "#m.$final" } } } },
            $final: { type: "final" },
        });
    });

    it("puts the $final of a block inside the block", () => {
        const { config } = parse(mmd(...HEADER, "[*] --> a", "state a {", "    [*] --> b", "    b --> [*]: X", "}"));
        expect(config.states).toEqual({
            a: { initial: "b", states: { b: { on: { X: "$final" } }, $final: { type: "final" } } },
        });
        expect(Object.keys(config.states.a!.states!)).toEqual(["b", "$final"]);
    });

    it("maps `done` to onDone of the compound source", () => {
        const { config } = parse(mmd(...HEADER, "[*] --> a", "state a {", "    [*] --> b", "}", "a --> c: done"));
        expect(config.states.a).toEqual({ initial: "b", onDone: "c", states: { b: {} } });
        expect(config.states.c).toEqual({});
    });

    it("maps an unlabeled transition and an empty label to always", () => {
        const { config } = parse(mmd(...HEADER, "[*] --> a", "a --> b", "b --> c:"));
        expect(config.states.a).toEqual({ always: "b" });
        expect(config.states.b).toEqual({ always: "c" });
    });

    it("maps a guard-only label to an always candidate with a guard", () => {
        const { config } = parse(mmd(...HEADER, "%% @guard g: true", "[*] --> a", "a --> b: [g]"));
        expect(config.states.a).toEqual({ always: { target: "b", guard: "g" } });
    });

    it("maps actions to a transition object", () => {
        const { config } = parse(
            mmd(...HEADER, "%% @action f: 1", "%% @action h: 2", "[*] --> a", "a --> b: X / f, h"),
        );
        expect(config.states.a).toEqual({ on: { X: { target: "b", actions: ["f", "h"] } } });
    });

    it("collects several transitions of one event as candidates in source order, keys in first-occurrence order", () => {
        const { config } = parse(
            mmd(...HEADER, "%% @guard g: true", "[*] --> a", "a --> b: Y [g]", "a --> c: X", "a --> d: Y"),
        );
        expect(Object.keys(config.states.a!.on!)).toEqual(["Y", "X"]);
        expect(config.states.a!.on!.Y).toEqual([{ target: "b", guard: "g" }, "d"]);
        expect(config.states.a!.on!.X).toBe("c");
    });

    it("maps `after` to delayed transitions keyed by milliseconds or delay name", () => {
        const { config } = parse(
            mmd(...HEADER, "%% @delay slow: 100", "[*] --> a", "a --> b: after 3000", "b --> a: after slow"),
        );
        expect(config.states.a).toEqual({ after: { 3000: "b" } });
        expect(Object.keys(config.states.a!.after!)).toEqual(["3000"]);
        expect(config.states.b).toEqual({ after: { slow: "a" } });
    });

    it("maps `--` regions to a parallel state with $0 / $1 and resolves cross-region targets by path", () => {
        const { config } = parse(
            mmd(
                ...HEADER,
                "[*] --> active",
                "state active {",
                "    [*] --> a1",
                "    a1 --> a2: X",
                "    --",
                "    [*] --> b1",
                "    b1 --> b2: Y",
                "}",
                "a1 --> b1: JUMP",
            ),
        );
        expect(config.states.active).toEqual({
            type: "parallel",
            states: {
                $0: { initial: "a1", states: { a1: { on: { X: "a2", JUMP: "#m.active.$1.b1" } }, a2: {} } },
                $1: { initial: "b1", states: { b1: { on: { Y: "b2" } }, b2: {} } },
            },
        });
        expect(Object.keys(config.states.active!.states!)).toEqual(["$0", "$1"]);
    });

    it("resolves deep targets from the root by absolute path", () => {
        const { config } = parse(
            mmd(
                ...HEADER,
                "[*] --> a",
                "state a {",
                "    [*] --> b",
                "    state b {",
                "        [*] --> c",
                "    }",
                "}",
                "a --> d: X",
                "d --> c: GO",
            ),
        );
        expect(config.states.d).toEqual({ on: { GO: "#m.a.b.c" } });
        expect(config.states.a).toEqual({
            initial: "b",
            on: { X: "d" },
            states: { b: { initial: "c", states: { c: {} } } },
        });
    });

    it("maps a choice state to an atomic state with always candidates in source order", () => {
        const { config } = parse(
            mmd(
                ...HEADER,
                "%% @guard isOk: true",
                "[*] --> a",
                "state c <<choice>>",
                "a --> c: CHECK",
                "c --> ok: [isOk]",
                "c --> bad",
            ),
        );
        expect(config.states.c).toEqual({ always: [{ target: "ok", guard: "isOk" }, "bad"] });
    });

    it('records descriptions from `state "d" as X` and `state "d" as X {`', () => {
        const { config } = parse(
            mmd(
                ...HEADER,
                "[*] --> a",
                'state "Alpha" as a',
                "a --> w: GO",
                'state "Work" as w {',
                "    [*] --> x",
                "}",
            ),
        );
        expect(config.states.a).toEqual({ description: "Alpha", on: { GO: "w" } });
        expect(config.states.w).toEqual({ description: "Work", initial: "x", states: { x: {} } });
    });

    it("keeps a self transition as a bare sibling target", () => {
        const { config } = parse(mmd(...HEADER, "[*] --> a", "a --> a: X"));
        expect(config.states.a).toEqual({ on: { X: "a" } });
    });
});

describe("parse: ownership follows mermaid", () => {
    it("owns a state by the block that mentions it even when the root mentions it too", () => {
        const { config } = parse(
            mmd(
                ...HEADER,
                "[*] --> off",
                "off --> working: ON",
                "state working {",
                "    [*] --> green",
                "    green --> broken: X",
                "}",
                "broken --> off: RESET",
            ),
        );
        expect(Object.keys(config.states)).toEqual(["off", "working"]);
        expect(config.states.working!.states!.broken).toEqual({ on: { RESET: "#m.off" } });
        expect(config.states.working!.states!.green).toEqual({ on: { X: "broken" } });
    });

    it("keeps a root-only state at the root", () => {
        const { config } = parse(
            mmd(...HEADER, "[*] --> a", "a --> b: X", "state w {", "    [*] --> x", "}", "a --> w: GO"),
        );
        expect(Object.keys(config.states)).toEqual(["a", "b", "w"]);
    });

    it("resolves a root → nested target by absolute path without moving the state", () => {
        const { config } = parse(
            mmd(
                ...HEADER,
                "[*] --> off",
                "off --> green: DEEP",
                "state working {",
                "    [*] --> green",
                "    green --> yellow: T",
                "}",
            ),
        );
        expect(config.states.off).toEqual({ on: { DEEP: "#m.working.green" } });
        expect(Object.keys(config.states.working!.states!)).toEqual(["green", "yellow"]);
    });

    it("declares a bare id line as a state of its scope", () => {
        const { config } = parse(
            mmd(...HEADER, "[*] --> a", "    lonely", "a --> b: GO", "state b {", "    [*] --> x", "    inner", "}"),
        );
        expect(Object.keys(config.states)).toEqual(["a", "lonely", "b"]);
        expect(config.states.lonely).toEqual({});
        expect(config.states.b).toEqual({ initial: "x", states: { x: {}, inner: {} } });
    });

    it("counts a note target as a mention", () => {
        const { config } = parse(
            mmd(
                ...HEADER,
                "[*] --> idle",
                "idle --> working: ON",
                "idle --> off: OFF",
                "state working {",
                "    [*] --> green",
                "    note right of off: hi",
                "}",
            ),
        );
        expect(Object.keys(config.states)).toEqual(["idle", "working"]);
        expect(config.states.working!.states!.off).toEqual({});
        expect(config.states.idle!.on!.OFF).toBe("#m.working.off");
    });
});

describe("parse: states list", () => {
    it("lists states depth first with ids, paths, parents, descriptions and regions, without $final", () => {
        const { states } = parse(
            mmd(
                ...HEADER,
                "[*] --> off",
                'state "Desc" as off',
                "off --> active: GO",
                "state active {",
                "    [*] --> a1",
                "    a1 --> [*]",
                "    --",
                "    [*] --> b1",
                "}",
                "active --> [*]: END",
            ),
        );
        expect(states).toEqual([
            { id: "off", path: "off", description: "Desc", line: 3 },
            { id: "active", path: "active", line: 5 },
            { id: "active.$0", path: "active.$0", parent: "active", line: 6 },
            { id: "a1", path: "active.$0.a1", parent: "active.$0", line: 7 },
            { id: "active.$1", path: "active.$1", parent: "active", line: 6 },
            { id: "b1", path: "active.$1.b1", parent: "active.$1", line: 10 },
        ]);
        expect(states[0]).not.toHaveProperty("parent");
    });

    it("uses the mermaid id of the enclosing block as parent for nested compounds", () => {
        const { states } = parse(
            mmd(
                ...HEADER,
                "[*] --> a",
                "state a {",
                "    [*] --> b",
                "    state b {",
                "        [*] --> c",
                "    }",
                "}",
            ),
        );
        expect(states).toEqual([
            { id: "a", path: "a", line: 3 },
            { id: "b", path: "a.b", parent: "a", line: 5 },
            { id: "c", path: "a.b.c", parent: "b", line: 7 },
        ]);
    });
});

describe("parse: directives in the result", () => {
    const text = mmd(
        "stateDiagram-v2",
        "%% @machine m",
        "%% @context type: { n: number }",
        "%% @context initial: { n: 0 }",
        "%% @event B: { n: number }",
        "%% @guard g: context.n > 0",
        "%% @action act:",
        "%%     context.n += 1",
        "%%     context.n *= 2",
        "%% @delay slow: 100",
        "[*] --> a",
        "a --> b: A / act",
        "b --> a: B [g] / act",
        "a --> a: A",
        "b --> b: after slow",
    );

    it("exposes machineId, eventTypes (source order, unique) and events", () => {
        const parsed = parse(text);
        expect(parsed.machineId).toBe("m");
        expect(parsed.eventTypes).toEqual(["A", "B"]);
        expect(parsed.events).toEqual({ B: "{ n: number }" });
    });

    it("exposes bodies as { text, line } with the directive line and joined continuation lines", () => {
        const parsed = parse(text);
        expect(parsed.context).toEqual({
            type: "{ n: number }",
            initial: { text: "{ n: 0 }", line: 4 },
        });
        expect(parsed.guards).toEqual({ g: { text: "context.n > 0", line: 6 } });
        expect(parsed.actions).toEqual({ act: { text: "context.n += 1\ncontext.n *= 2", line: 7 } });
        expect(parsed.delays).toEqual({ slow: { text: "100", line: 10 } });
    });

    it("collects references of guards and actions by event name, unique, in source order", () => {
        const parsed = parse(text);
        expect(parsed.references).toEqual({ guards: { g: ["B"] }, actions: { act: ["A", "B"] } });
    });

    it("marks system triggers as $always / $after / $done", () => {
        const parsed = parse(
            mmd(
                ...HEADER,
                "%% @guard g: true",
                "%% @action act: console.log(1)",
                "[*] --> a",
                "a --> b: [g] / act",
                "b --> a: after 100 [g] / act",
                "state w {",
                "    [*] --> x",
                "}",
                "a --> w: W",
                "w --> a: done [g] / act",
            ),
        );
        expect(parsed.references.guards.g).toEqual(["$always", "$after", "$done"]);
        expect(parsed.references.actions.act).toEqual(["$always", "$after", "$done"]);
        expect(parsed.eventTypes).toEqual(["W"]);
    });

    it("leaves context empty when no @context directive is present", () => {
        const parsed = parse(mmd(...HEADER, "[*] --> a"));
        expect(parsed.context).toEqual({});
        expect(parsed.events).toEqual({});
        expect(parsed.eventTypes).toEqual([]);
        expect(parsed.references).toEqual({ guards: {}, actions: {} });
    });

    it("keeps the source verbatim, CRLF included", () => {
        const text = "stateDiagram-v2\r\n%% @machine m\r\n[*] --> a\r\na --> b: X\r\n";
        const parsed = parse(text);
        expect(parsed.config.source).toBe(text);
        expect(parsed.config.states).toEqual({ a: { on: { X: "b" } }, b: {} });
    });
});

describe("parse: structural errors", () => {
    it("requires a @machine directive (reported at the header line)", () => {
        const error = failing(mmd("", "stateDiagram-v2", "[*] --> a"));
        expect(error.message).toBe("missing `%% @machine <id>` directive");
        expect(error.line).toBe(2);
    });

    it("rejects a state id used inside two blocks", () => {
        const error = failing(
            mmd(...HEADER, "[*] --> p1", "state p1 {", "    [*] --> idle", "}", "state p2 {", "    [*] --> idle", "}"),
        );
        expect(error.message).toContain(
            'duplicate state id "idle": used inside state `p1` (line 5) and inside state `p2`',
        );
        expect(error.line).toBe(8);
        expect(error.column).toBe(13);
        expect(error.path).toBe("p2");
    });

    it("rejects a state id used inside two regions", () => {
        const error = failing(
            mmd(
                ...HEADER,
                "[*] --> active",
                "state active {",
                "    [*] --> a1",
                "    a1 --> b1: X",
                "    --",
                "    [*] --> b1",
                "}",
            ),
        );
        expect(error.message).toContain(
            'duplicate state id "b1": used inside region $0 of state `active` (line 6) and inside region $1 of state `active`',
        );
        expect(error.line).toBe(8);
        expect(error.column).toBe(13);
        expect(error.path).toBe("active.$1");
    });

    it("rejects a state used inside its own block", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "state a {", "    [*] --> b", "    b --> a: X", "}"));
        expect(error.message).toBe('state "a" is used inside its own block (state `a`)');
        expect(error.line).toBe(6);
        expect(error.column).toBe(11);
        expect(error.path).toBe("a");
    });

    it("requires an initial state at the root", () => {
        const error = failing(mmd(...HEADER, "a --> b: X"));
        expect(error.message).toBe("the root of the diagram has no initial state: add `[*] --> <state>`");
        expect(error.line).toBe(1);
        expect(error.path).toBeUndefined();
    });

    it("requires an initial state in a compound block", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "state a {", "    x --> y: E", "}"));
        expect(error.message).toBe("state `a` has no initial state: add `[*] --> <state>`");
        expect(error.line).toBe(4);
        expect(error.path).toBe("a");
    });

    it("rejects an empty block", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "state a {", "}"));
        expect(error.message).toBe("state `a` has no initial state: add `[*] --> <state>`");
        expect(error.line).toBe(4);
        expect(error.path).toBe("a");
    });

    it("rejects an empty region", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "state a {", "    --", "    [*] --> x", "}"));
        expect(error.message).toBe("region $0 of state `a` has no initial state: add `[*] --> <state>`");
        expect(error.line).toBe(4);
        expect(error.path).toBe("a.$0");
    });

    it("rejects two initial transitions in one scope", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "[*] --> b"));
        expect(error.message).toBe(
            "the root of the diagram has more than one initial state (first `[*] -->` at line 3)",
        );
        expect(error.line).toBe(4);
        expect(error.column).toBe(9);
        expect(error.path).toBeUndefined();
    });

    it("rejects a root initial state that a block pulled in", () => {
        const error = failing(
            mmd(
                ...HEADER,
                "[*] --> off",
                "off --> working: ON",
                "state working {",
                "    [*] --> green",
                "    green --> off: X",
                "}",
            ),
        );
        expect(error.message).toBe(
            'initial state "off" of the root of the diagram is drawn inside state `working` (mentioned there at line 7)',
        );
        expect(error.line).toBe(3);
        expect(error.column).toBe(9);
        expect(error.path).toBeUndefined();
    });

    it("rejects an undeclared guard at the column of the name", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "a --> b: X [g]"));
        expect(error.message).toBe('undeclared guard "g": add `%% @guard g: <expression>`');
        expect(error.line).toBe(4);
        expect(error.column).toBe(13);
        expect(error.path).toBe("a");
    });

    it("rejects an undeclared action at the column of the name", () => {
        const error = failing(mmd(...HEADER, "%% @action f: 1", "[*] --> a", "a --> b: X / f, act"));
        expect(error.message).toBe('undeclared action "act": add `%% @action act: <statements>`');
        expect(error.line).toBe(5);
        expect(error.column).toBe(17);
        expect(error.path).toBe("a");
    });

    it("rejects an undeclared delay name", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "a --> b: after slow"));
        expect(error.message).toBe('undeclared delay "slow": add `%% @delay slow: <expression>`');
        expect(error.line).toBe(4);
        expect(error.column).toBe(10);
        expect(error.path).toBe("a");
    });

    it("rejects `done` from an atomic state", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "a --> b: done"));
        expect(error.message).toBe('`done` requires "a" to be a compound or parallel state (`state a { }`)');
        expect(error.line).toBe(4);
        expect(error.column).toBe(10);
        expect(error.path).toBe("a");
    });

    it("rejects an evented transition out of a choice state", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "state c <<choice>>", "a --> c: E", "c --> x: GO"));
        expect(error.message).toBe('transitions out of choice state "c" must be eventless (`c --> X: [guard]`)');
        expect(error.line).toBe(6);
        expect(error.column).toBe(10);
        expect(error.path).toBe("c");
    });

    it("rejects an @event that no transition uses", () => {
        const error = failing(mmd(...HEADER, "%% @event X: { a: number }", "[*] --> a", "a --> b: Y"));
        expect(error.message).toBe('event "X" is declared with @event but not used in any transition');
        expect(error.line).toBe(3);
    });

    it("rejects a duplicate description", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", 'state "A" as a', 'state "B" as a'));
        expect(error.message).toBe('duplicate description of state "a" (first declared at line 4)');
        expect(error.line).toBe(5);
        expect(error.column).toBe(14);
        expect(error.path).toBeUndefined();
    });

    it("rejects a duplicate choice declaration", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "state c <<choice>>", "state c <<choice>>", "a --> c"));
        expect(error.message).toBe("duplicate `state c <<choice>>` (first declared at line 4)");
        expect(error.line).toBe(5);
        expect(error.column).toBe(7);
        expect(error.path).toBeUndefined();
    });

    it("rejects a duplicate block", () => {
        const error = failing(
            mmd(...HEADER, "[*] --> a", "state a {", "    [*] --> b", "}", "state a {", "    [*] --> c", "}"),
        );
        expect(error.message).toBe("duplicate block `state a {` (first opened at line 4)");
        expect(error.line).toBe(7);
        expect(error.column).toBe(7);
        expect(error.path).toBe("a");
    });

    it("rejects a choice state with a block", () => {
        const error = failing(mmd(...HEADER, "[*] --> c", "state c <<choice>>", "state c {", "    [*] --> x", "}"));
        expect(error.message).toBe('choice state "c" cannot have a block');
        expect(error.line).toBe(5);
        expect(error.column).toBe(7);
        expect(error.path).toBe("c");
    });

    it("rejects `after` without a delay", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "a --> b: after"));
        expect(error.message).toBe("`after` requires a delay: `after <milliseconds>` or `after <delayName>`");
        expect(error.line).toBe(4);
        expect(error.column).toBe(15);
    });

    it("rejects tokens after `done`", () => {
        const error = failing(mmd(...HEADER, "[*] --> a", "state a {", "    [*] --> b", "}", "a --> c: done 3000"));
        expect(error.message).toContain('unexpected "3000" in transition label');
        expect(error.line).toBe(7);
        expect(error.column).toBe(15);
    });

    it("rejects characters outside the label alphabet at their column in the line", () => {
        const error = failing(mmd(...HEADER, "%% @action f: 1", "[*] --> a", "a --> b: X / f; g"));
        expect(error.message).toBe(
            "`;` is not allowed: mermaid reads it as a statement separator (one statement per line)",
        );
        expect(error.line).toBe(5);
        expect(error.column).toBe(15);
    });
});

describe("parse: body syntax check", () => {
    it("reports an incomplete guard expression at the directive line", () => {
        const error = failing(mmd(...HEADER, "%% @guard g: context.", "[*] --> a", "a --> b: X [g]"));
        expect(error.message).toContain("syntax error in @guard g:");
        expect(error.line).toBe(3);
        expect(error.column).toBeGreaterThanOrEqual(14);
    });

    it("reports an error inside an inline body at its column", () => {
        const error = failing(mmd(...HEADER, "%% @guard g: 1 +* 2", "[*] --> a", "a --> b: X [g]"));
        expect(error.message).toContain("syntax error in @guard g: Expression expected.");
        expect(error.line).toBe(3);
        expect(error.column).toBe(17);
    });

    it("reports an unbalanced brace in an action at the directive line", () => {
        const error = failing(mmd(...HEADER, "%% @action act: if (x) {", "[*] --> a", "a --> b: X / act"));
        expect(error.message).toContain("syntax error in @action act:");
        expect(error.line).toBe(3);
    });

    it("reports an error on a continuation line at that line and column", () => {
        const error = failing(
            mmd(
                ...HEADER,
                "%% @action act:",
                "%%     context.a = 1",
                "%%     context.b = = 2",
                "[*] --> a",
                "a --> a: X / act",
            ),
        );
        expect(error.message).toContain("syntax error in @action act: Expression expected.");
        expect(error.line).toBe(5);
        expect(error.column).toBe(20);
    });

    it("reports an unterminated @context type", () => {
        const error = failing(
            mmd(...HEADER, "%% @context type: { a: number", "%% @context initial: { a: 1 }", "[*] --> a"),
        );
        expect(error.message).toContain("syntax error in @context type:");
        expect(error.line).toBe(3);
    });

    it("reports a malformed @context initial at its column", () => {
        const error = failing(
            mmd(...HEADER, "%% @context type: { a: number }", "%% @context initial: { a: }", "[*] --> a"),
        );
        expect(error.message).toContain("syntax error in @context initial: Expression expected.");
        expect(error.line).toBe(4);
        expect(error.column).toBe(27);
    });

    it("reports an unterminated @event payload type", () => {
        const error = failing(mmd(...HEADER, "%% @event X: { value: number", "[*] --> a", "a --> b: X"));
        expect(error.message).toContain("syntax error in @event X:");
        expect(error.line).toBe(3);
    });

    it("accepts TypeScript-only syntax in bodies", () => {
        const parsed = parse(
            mmd(
                ...HEADER,
                "%% @event X: { value: unknown }",
                "%% @guard g: (event.value as number) > 1",
                "%% @action act: context.list!.length",
                "[*] --> a",
                "a --> b: X [g] / act",
            ),
        );
        expect(parsed.guards.g!.text).toBe("(event.value as number) > 1");
        expect(parsed.actions.act!.text).toBe("context.list!.length");
    });
});

describe("parse: names that plain objects cannot hold", () => {
    it("rejects `__proto__` as a state id, an event name and a directive name", () => {
        const state = failing(mmd(...HEADER, "[*] --> __proto__"));
        expect(state.message).toBe(
            'invalid state id "__proto__": expected /[A-Za-z_][A-Za-z0-9_]*/ other than `__proto__`',
        );
        expect(state.line).toBe(3);
        const event = failing(mmd(...HEADER, "[*] --> a", "a --> b: __proto__"));
        expect(event.message).toContain('invalid event name "__proto__"');
        expect(event.line).toBe(4);
        const guard = failing(mmd(...HEADER, "%% @guard __proto__: true", "[*] --> a"));
        expect(guard.message).toContain('invalid name "__proto__" in directive @guard');
        expect(guard.line).toBe(3);
    });
});

describe("parse: candidate lists", () => {
    it("keeps bare targets in `on` / `always` lists but wraps them into objects in `after` / `onDone` lists", () => {
        // createMachine accepts a bare target in an `after` / `onDone` slot only outside an array.
        const { config } = parse(
            mmd(
                ...HEADER,
                "%% @guard g: true",
                "[*] --> a",
                "a --> b: after 100 [g]",
                "a --> c: after 100",
                "a --> d: X",
                "a --> e: X",
                "a --> f",
                "a --> h",
                "state w {",
                "    [*] --> x",
                "    x --> [*]: DONE",
                "}",
                "w --> b: done [g]",
                "w --> c: done",
            ),
        );
        expect(config.states.a).toEqual({
            on: { X: ["d", "e"] },
            after: { 100: [{ target: "b", guard: "g" }, { target: "c" }] },
            always: ["f", "h"],
        });
        expect(config.states.w).toEqual({
            initial: "x",
            onDone: [{ target: "b", guard: "g" }, { target: "c" }],
            states: { x: { on: { DONE: "$final" } }, $final: { type: "final" } },
        });
    });
});
