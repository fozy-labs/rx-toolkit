import { describe, expect, it } from "vitest";

import { StatechartParseError } from "../StatechartParseError.js";

import { parseLabel, type TransitionLabel } from "./label.js";

const LINE = 7;
const COLUMN = 20;

function label(text: string): TransitionLabel {
    return parseLabel(text, LINE, COLUMN);
}

function capture(text: string): StatechartParseError {
    try {
        label(text);
    } catch (error) {
        if (error instanceof StatechartParseError) return error;
        throw error;
    }
    throw new Error("expected a StatechartParseError");
}

function expectError(text: string, message: string, column: number): void {
    expect(() => label(text)).toThrow(StatechartParseError);
    const error = capture(text);
    expect(error.message).toContain(message);
    expect(error.line).toBe(LINE);
    expect(error.column).toBe(column);
}

describe("parseLabel", () => {
    describe("productions", () => {
        it("event only", () => {
            expect(label("POWER_ON")).toEqual({
                trigger: { kind: "event", name: "POWER_ON", column: COLUMN },
                guard: null,
                actions: [],
            });
        });

        it("event + guard", () => {
            expect(label("POWER_ON [hasPower]")).toEqual({
                trigger: { kind: "event", name: "POWER_ON", column: COLUMN },
                guard: { name: "hasPower", column: COLUMN + 10 },
                actions: [],
            });
        });

        it("event + actions", () => {
            expect(label("RESET / retry")).toEqual({
                trigger: { kind: "event", name: "RESET", column: COLUMN },
                guard: null,
                actions: [{ name: "retry", column: COLUMN + 8 }],
            });
        });

        it("event + guard + actions", () => {
            expect(label("POWER_ON [hasPower] / logStart")).toEqual({
                trigger: { kind: "event", name: "POWER_ON", column: COLUMN },
                guard: { name: "hasPower", column: COLUMN + 10 },
                actions: [{ name: "logStart", column: COLUMN + 22 }],
            });
        });

        it("guard only", () => {
            expect(label("[isOk]")).toEqual({
                trigger: null,
                guard: { name: "isOk", column: COLUMN + 1 },
                actions: [],
            });
        });

        it("actions only", () => {
            expect(label("/ a, b")).toEqual({
                trigger: null,
                guard: null,
                actions: [
                    { name: "a", column: COLUMN + 2 },
                    { name: "b", column: COLUMN + 5 },
                ],
            });
        });

        it("guard + actions without a trigger", () => {
            expect(label("[g] / a")).toEqual({
                trigger: null,
                guard: { name: "g", column: COLUMN + 1 },
                actions: [{ name: "a", column: COLUMN + 6 }],
            });
        });

        it("after <ms>", () => {
            expect(label("after 3000")).toEqual({
                trigger: { kind: "after", delay: "3000", named: false, column: COLUMN },
                guard: null,
                actions: [],
            });
        });

        it("after 0", () => {
            expect(label("after 0").trigger).toEqual({ kind: "after", delay: "0", named: false, column: COLUMN });
        });

        it("after <name>", () => {
            expect(label("after slowName [g] / a").trigger).toEqual({
                kind: "after",
                delay: "slowName",
                named: true,
                column: COLUMN,
            });
        });

        it("done", () => {
            expect(label("done")).toEqual({ trigger: { kind: "done", column: COLUMN }, guard: null, actions: [] });
        });

        it("done [g] / a", () => {
            expect(label("done [g] / a")).toEqual({
                trigger: { kind: "done", column: COLUMN },
                guard: { name: "g", column: COLUMN + 6 },
                actions: [{ name: "a", column: COLUMN + 11 }],
            });
        });

        it("several actions", () => {
            expect(label("X / a, b, c").actions.map((action) => action.name)).toEqual(["a", "b", "c"]);
        });

        it("tolerates missing whitespace", () => {
            expect(label("X[g]/a,b")).toEqual({
                trigger: { kind: "event", name: "X", column: COLUMN },
                guard: { name: "g", column: COLUMN + 2 },
                actions: [
                    { name: "a", column: COLUMN + 5 },
                    { name: "b", column: COLUMN + 7 },
                ],
            });
        });

        it("tolerates extra whitespace", () => {
            expect(label("X   [ g ]  /  a , b")).toEqual({
                trigger: { kind: "event", name: "X", column: COLUMN },
                guard: { name: "g", column: COLUMN + 6 },
                actions: [
                    { name: "a", column: COLUMN + 14 },
                    { name: "b", column: COLUMN + 18 },
                ],
            });
        });

        it("accepts underscores and digits inside names", () => {
            expect(label("_e1 [g_2] / a3").trigger).toEqual({ kind: "event", name: "_e1", column: COLUMN });
        });
    });

    describe("errors", () => {
        it.each([
            ["X / f; g", ";", 5],
            ["X [a < b]", "<", 5],
            ["X [ctx.ready]", ".", 6],
            ["X / reset()", "(", 9],
            ["X / assign({ n: 1 })", "(", 10],
            ['X [name == "foo"]', "=", 8],
            ["X %% comment", "%", 2],
        ])("rejects %j (character outside the alphabet)", (text, char, offset) => {
            expectError(text, `unexpected character ${JSON.stringify(char)}`, COLUMN + offset);
        });

        it("rejects `after` without a delay", () => {
            expectError("after", "`after` requires a delay", COLUMN + 5);
        });

        it("rejects `after` followed by a guard", () => {
            expectError("after [g]", "`after` requires a delay", COLUMN + 6);
        });

        it("rejects a delay with leading zeros", () => {
            expectError("after 007", 'invalid delay "007": no leading zeros', COLUMN + 6);
        });

        it("rejects invalid delay names", () => {
            expectError("after 1x", 'invalid delay "1x"', COLUMN + 6);
            expectError("after done", 'invalid delay "done"', COLUMN + 6);
            expectError("after after", 'invalid delay "after"', COLUMN + 6);
        });

        it("rejects text after `done`", () => {
            expectError("done 3000", 'unexpected "3000"', COLUMN + 5);
        });

        it("rejects a guard with two names", () => {
            expectError("X [a b]", "expected `]` after the guard name", COLUMN + 5);
        });

        it("rejects an empty guard", () => {
            expectError("X []", "expected a guard name inside `[ ]`", COLUMN + 3);
        });

        it("rejects an unterminated guard", () => {
            expectError("X [g", "expected `]` after the guard name", COLUMN + 4);
        });

        it("rejects an expression inside the guard", () => {
            expectError("X [a.b]", 'unexpected character "."', COLUMN + 4);
        });

        it("rejects `/` without a name", () => {
            expectError("X /", "expected an action name after `/`", COLUMN + 3);
            expectError("X / [g]", "expected an action name after `/`", COLUMN + 4);
        });

        it("rejects a trailing comma", () => {
            expectError("X / a,", "expected an action name after `,`", COLUMN + 6);
        });

        it("rejects an event name starting with a digit", () => {
            expectError("1X", 'invalid event name "1X"', COLUMN);
        });

        it("rejects text after the actions", () => {
            expectError("X / a b", 'unexpected "b"', COLUMN + 6);
        });

        it("rejects a trigger after the guard", () => {
            expectError("[g] X", 'unexpected "X"', COLUMN + 4);
        });

        it("rejects two guards", () => {
            expectError("X [a] [b]", 'unexpected "["', COLUMN + 6);
        });
    });
});
