/**
 * The proposal's two examples end to end: parse → config (exactly the
 * proposal's, «Конвертер» / «Пример: возведение в квадрат») → emit → snapshot.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { convert } from "../src/convert.js";
import { emit } from "../src/emit/emit.js";
import { parse } from "../src/parse/parse.js";

function fixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describe("trafficLight.mmd", () => {
    const text = fixture("trafficLight.mmd");
    const parsed = parse(text);

    it("produces the config of the proposal", () => {
        expect(parsed.machineId).toBe("trafficLight");
        expect(parsed.config).toEqual({
            id: "trafficLight",
            source: text,
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
        });
    });

    it("collects directives, events, references and states", () => {
        expect(parsed.context).toEqual({
            type: "{ power: boolean; retries: number }",
            initial: { text: "{ power: true, retries: 0 }", line: 4 },
        });
        expect(parsed.events).toEqual({});
        expect(parsed.eventTypes).toEqual(["POWER_ON", "POWER_OFF", "RESET", "FAULT"]);
        expect(parsed.guards).toEqual({ hasPower: { text: "context.power", line: 8 } });
        expect(parsed.actions).toEqual({
            logStart: { text: 'console.log("start")', line: 9 },
            retry: { text: "context.retries += 1", line: 14 },
            warn: { text: 'console.warn("yellow -> red")', line: 20 },
        });
        expect(parsed.delays).toEqual({});
        expect(parsed.references).toEqual({
            guards: { hasPower: ["POWER_ON"] },
            actions: { logStart: ["POWER_ON"], retry: ["RESET"], warn: ["$after"] },
        });
        expect(parsed.states).toEqual([
            { id: "off", path: "off", line: 6 },
            { id: "working", path: "working", line: 10 },
            { id: "green", path: "working.green", parent: "working", line: 18 },
            { id: "yellow", path: "working.yellow", parent: "working", line: 19 },
            { id: "red", path: "working.red", parent: "working", line: 21 },
            { id: "broken", path: "broken", line: 12 },
        ]);
    });

    it("emits the generated file", () => {
        const code = emit(parsed, { fileName: "trafficLight.mmd" });
        expect(code).toMatchSnapshot();
        expect(convert(text, { fileName: "examples/trafficLight.mmd" }).code).toBe(code);
    });
});

describe("square.mmd", () => {
    const text = fixture("square.mmd");
    const parsed = parse(text);

    it("produces the config of the proposal (candidates in source order)", () => {
        expect(parsed.config).toEqual({
            id: "square",
            source: text,
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
    });

    it("collects the payload type, multi-line bodies and references", () => {
        expect(parsed.events).toEqual({ SQUARE: "{ value: number }" });
        expect(parsed.eventTypes).toEqual(["SQUARE", "RESET"]);
        expect(parsed.actions.square).toEqual({
            text: "context.result = event.value ** 2\ncontext.error = null",
            line: 10,
        });
        expect(parsed.actions.clear).toEqual({ text: "context.result = null\ncontext.error = null", line: 18 });
        expect(parsed.references).toEqual({
            guards: { isFinite: ["SQUARE"] },
            actions: { square: ["SQUARE"], reject: ["SQUARE"], clear: ["RESET"] },
        });
        expect(parsed.states).toEqual([
            { id: "idle", path: "idle", line: 7 },
            { id: "done", path: "done", line: 13 },
            { id: "error", path: "error", line: 16 },
        ]);
    });

    it("emits the generated file", () => {
        const code = emit(parsed, { fileName: "square.mmd" });
        expect(code).toMatchSnapshot();
        expect(code).toContain(
            'export type Events =\n    | ({ type: "SQUARE" } & { value: number })\n    | { type: "RESET" };',
        );
        expect(code).toContain(
            'square: mutate(({ context, event }: ActionArgs<Context, Extract<Events, { type: "SQUARE" }>>) => {\n                context.result = event.value ** 2\n                context.error = null\n            }),',
        );
    });
});
