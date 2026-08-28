/**
 * `tsc --strict` over generated files against the real library (root `src/`
 * at HEAD, see `typecheckGenerated.ts`): the proposal's examples, a kitchen
 * sink, the no-context / no-events case, two negative cases proving the
 * harness is not vacuous, and the round-trip fixtures converted from their
 * `withDirectives(toMermaid())` text.
 */
import { readFileSync } from "node:fs";

import { createMachine } from "@fozy-labs/rx-toolkit";
import { describe, expect, it } from "vitest";

import { convert } from "../src/convert.js";

import { roundTripFixtures, withDirectives } from "./roundTripFixtures.js";
import { typecheckGenerated, typecheckLibrary } from "./typecheckGenerated.js";

function fixture(name: string): string {
    return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

const KITCHEN_SINK = `stateDiagram-v2
    %% @machine sink
    %% @context type: { count: number; log: string[] }
    %% @context initial: { count: 0, log: [] }
    %% @event ADD: { amount: number }
    %% @guard positive: event.amount > 0
    %% @guard hasCount: context.count > 0
    %% @guard always: true
    %% @action add: context.count += event.amount
    %% @action note: context.log.push(event.type)
    %% @action ping: console.log("ping")
    %% @delay slow: context.count * 100

    [*] --> idle
    idle --> active: ADD [positive] / add, note
    idle --> idle: ADD / ping
    state active {
        [*] --> a1
        a1 --> a2: after slow / note
        a2 --> [*]: after 10 [hasCount]
        --
        [*] --> b1
        b1 --> b2: RESET
    }
    active --> idle: done / note
    state c <<choice>>
    idle --> c: CHECK
    c --> active: [hasCount] / note
    c --> idle: [always]
`;

describe("generated files typecheck against the library", () => {
    it("the library sources are clean under the harness options (so reporting the generated file only is honest)", () => {
        const { code } = convert(fixture("square.mmd"), { fileName: "square.mmd" });
        expect(typecheckLibrary(code)).toEqual([]);
    });

    it("trafficLight.mmd", () => {
        const { code } = convert(fixture("trafficLight.mmd"), { fileName: "trafficLight.mmd" });
        expect(typecheckGenerated(code, "trafficLight.generated.ts")).toEqual([]);
    });

    it("square.mmd", () => {
        const { code } = convert(fixture("square.mmd"), { fileName: "square.mmd" });
        expect(typecheckGenerated(code, "square.generated.ts")).toEqual([]);
    });

    it("parallel regions, choice, named delay, system-event handlers", () => {
        const { code } = convert(KITCHEN_SINK, { fileName: "sink.mmd" });
        expect(code).toContain("type MachineEvent");
        expect(code).toContain("note: mutate(({ context, event }: ActionArgs<Context, MachineEvent<Events>>)");
        expect(code).toContain("slow: ({ context }: ActionArgs<Context, MachineEvent<Events>>)");
        expect(typecheckGenerated(code, "sink.generated.ts")).toEqual([]);
    });

    it("no context, no events", () => {
        const { code } = convert("stateDiagram-v2\n    %% @machine bare\n    [*] --> a\n    a --> [*]\n", {
            fileName: "bare.mmd",
        });
        expect(code).toContain("export type Context = {};");
        expect(code).toContain("export type Events = never;");
        expect(typecheckGenerated(code, "bare.generated.ts")).toEqual([]);
    });

    it("the harness is not vacuous: a context that contradicts its type fails", () => {
        const { code } = convert(
            'stateDiagram-v2\n    %% @machine bad\n    %% @context type: { n: number }\n    %% @context initial: { n: "one" }\n    [*] --> a\n',
            { fileName: "bad.mmd" },
        );
        const diagnostics = typecheckGenerated(code, "bad.generated.ts");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/^bad\.generated\.ts\(\d+,\d+\): TS2322/);
    });

    it("the harness is not vacuous: an action reading a payload of another event fails", () => {
        // `add` is referenced only by `ADD`; the narrowed event has no `other` property.
        const { code } = convert(
            "stateDiagram-v2\n    %% @machine bad\n    %% @context type: { n: number }\n    %% @context initial: { n: 0 }\n    %% @event ADD: { amount: number }\n    %% @action add: context.n += event.other\n    [*] --> a\n    a --> a: ADD / add\n",
            { fileName: "bad.mmd" },
        );
        const diagnostics = typecheckGenerated(code, "bad.generated.ts");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]).toMatch(/^bad\.generated\.ts\(\d+,\d+\): TS2339/);
    });

    describe.each(roundTripFixtures)("round-trip fixture $name converted from toMermaid()", (machine) => {
        it("typechecks", () => {
            const text = withDirectives(createMachine(machine.config, machine.implementations).toMermaid(), machine);
            const { code } = convert(text, { fileName: `${machine.name}.mmd` });
            expect(typecheckGenerated(code, `${machine.name}.generated.ts`)).toEqual([]);
        });
    });
});
