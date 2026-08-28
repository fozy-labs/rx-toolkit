import { parse, type ParseResult } from "@fozy-labs/statechart-converter";
import { describe, expect, it } from "vitest";

import { squareFixture } from "../testing/fixtures";

import { CompileError, compileImplementations, toMachineImplementations } from "./compileImplementations";

/** The proposal's `square` example, parsed by the real converter. */
const squareParsed = parse(squareFixture.source);

/** A small machine with a named delay and a guard that reads the event. */
const retrySource = `stateDiagram-v2
    %% @machine retry
    %% @context type: { retries: number }
    %% @context initial: { retries: 2 }
    %% @event GO: { force: boolean }
    [*] --> idle
    %% @guard allowed: event.force || context.retries < 3
    idle --> waiting: GO [allowed]
    %% @delay slow: context.retries * 1000
    waiting --> idle: after slow
`;

const retryParsed = parse(retrySource);

type SquareContext = { result: number | null; error: string | null };

describe("parse results of the fixtures", () => {
    it("carry the directive lines the playground reports", () => {
        expect(squareParsed.context.initial?.line).toBe(4);
        expect(squareParsed.guards.isFinite.line).toBe(9);
        expect(squareParsed.actions.square).toEqual({
            text: "context.result = event.value ** 2\ncontext.error = null",
            line: 10,
        });
        expect(squareParsed.actions.reject.line).toBe(15);
        expect(squareParsed.actions.clear.line).toBe(18);
        expect(retryParsed.delays.slow).toEqual({ text: "context.retries * 1000", line: 9 });
    });
});

describe("compileImplementations", () => {
    it("compiles guards that read context and event", () => {
        const { guards } = compileImplementations(squareParsed);
        const context: SquareContext = { result: null, error: null };

        expect(guards.isFinite({ context, event: { type: "SQUARE", value: 12 } })).toBe(true);
        expect(guards.isFinite({ context, event: { type: "SQUARE", value: NaN } })).toBe(false);

        const { guards: retryGuards } = compileImplementations(retryParsed);
        expect(retryGuards.allowed({ context: { retries: 5 }, event: { type: "GO", force: true } })).toBe(true);
        expect(retryGuards.allowed({ context: { retries: 5 }, event: { type: "GO", force: false } })).toBe(false);
        expect(retryGuards.allowed({ context: { retries: 1 }, event: { type: "GO", force: false } })).toBe(true);
    });

    it("coerces guard results to booleans", () => {
        const parsed: ParseResult = {
            ...retryParsed,
            guards: { truthy: { text: "context.retries", line: 1 } },
        };
        const { guards } = compileImplementations(parsed);
        expect(guards.truthy({ context: { retries: 2 }, event: { type: "GO" } })).toBe(true);
        expect(guards.truthy({ context: { retries: 0 }, event: { type: "GO" } })).toBe(false);
    });

    it("compiles action recipes that mutate the passed context and ignore the return value", () => {
        const { actionRecipes } = compileImplementations(squareParsed);
        const context: SquareContext = { result: null, error: "stale" };

        const returned = actionRecipes.square({ context, event: { type: "SQUARE", value: 12 } });

        expect(returned).toBeUndefined();
        expect(context).toEqual({ result: 144, error: null });

        actionRecipes.reject({ context, event: { type: "SQUARE", value: NaN } });
        expect(context.error).toBe("not a finite number");

        actionRecipes.clear({ context, event: { type: "RESET" } });
        expect(context).toEqual({ result: null, error: null });
    });

    it("creates a fresh context value on every call", () => {
        const { createContext } = compileImplementations(squareParsed);
        const first = createContext();
        const second = createContext();

        expect(first).toEqual({ result: null, error: null });
        expect(second).toEqual(first);
        expect(second).not.toBe(first);
    });

    it("compiles delays to numbers", () => {
        const { delays } = compileImplementations(retryParsed);
        expect(delays.slow({ context: { retries: 3 }, event: { type: "GO" } })).toBe(3000);
    });

    it("returns an empty object as context when @context initial is absent", () => {
        const parsed: ParseResult = { ...squareParsed, context: {} };
        const { createContext } = compileImplementations(parsed);
        expect(createContext()).toEqual({});
    });

    it("reports a syntax error in a guard as a CompileError with kind, name, line and detail", () => {
        const parsed: ParseResult = {
            ...squareParsed,
            guards: { broken: { text: "event.value ===", line: 42 } },
        };

        let caught: unknown;
        try {
            compileImplementations(parsed);
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(CompileError);
        const error = caught as CompileError;
        expect(error.name).toBe("CompileError");
        expect(error.kind).toBe("guard");
        expect(error.directiveName).toBe("broken");
        expect(error.line).toBe(42);
        expect(error.cause).toBeInstanceOf(SyntaxError);
        expect(error.detail).toBe((error.cause as SyntaxError).message);
        expect(error.message).toBe(`@guard broken (line 42): ${error.detail}`);
    });

    it("reports a syntax error in a multi-line action", () => {
        const parsed: ParseResult = {
            ...squareParsed,
            actions: {
                ...squareParsed.actions,
                square: { text: "context.result = event.value ** 2\ncontext.error = ", line: 10 },
            },
        };

        expect(() => compileImplementations(parsed)).toThrow(CompileError);
        expect(() => compileImplementations(parsed)).toThrow(/^@action square \(line 10\): /);
    });

    it("reports a syntax error in @context initial under the name initial", () => {
        const parsed: ParseResult = {
            ...squareParsed,
            context: { initial: { text: "{ result: }", line: 4 } },
        };

        let caught: unknown;
        try {
            compileImplementations(parsed);
        } catch (error) {
            caught = error;
        }

        expect(caught).toBeInstanceOf(CompileError);
        expect((caught as CompileError).kind).toBe("context");
        expect((caught as CompileError).directiveName).toBe("initial");
        expect((caught as CompileError).line).toBe(4);
    });

    it("does not catch runtime errors thrown by a body", () => {
        const parsed: ParseResult = {
            ...retryParsed,
            guards: { explode: { text: "context.missing.deep", line: 1 } },
        };
        const { guards } = compileImplementations(parsed);
        expect(() => guards.explode({ context: {}, event: { type: "GO" } })).toThrow(TypeError);
    });
});

describe("toMachineImplementations", () => {
    it("wraps every action recipe with mutate and passes guards and delays through", () => {
        const compiled = compileImplementations(squareParsed);
        const recorded: Array<(args: { context: unknown; event: unknown }) => void> = [];
        const mutate = (recipe: (args: { context: unknown; event: unknown }) => void) => {
            recorded.push(recipe);
            return { tag: "mutate", index: recorded.length - 1 };
        };

        const implementations = toMachineImplementations(compiled, mutate);

        expect(Object.keys(implementations.actions).sort()).toEqual(["clear", "reject", "square"]);
        expect(implementations.actions.square).toEqual({ tag: "mutate", index: 0 });
        expect(recorded).toHaveLength(3);
        expect(implementations.guards).toBe(compiled.guards);
        expect(implementations.delays).toBe(compiled.delays);

        const context: SquareContext = { result: null, error: null };
        recorded[0]({ context, event: { type: "SQUARE", value: 3 } });
        expect(context).toEqual({ result: 9, error: null });
    });
});
