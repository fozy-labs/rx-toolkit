/**
 * Round trip: `parse(withDirectives(createMachine(config).toMermaid()))`
 * gives the config back (proposal, section «Тестирование»). The library is
 * the root `src/` at HEAD (vitest alias), so a mismatch is a bug in
 * `toMermaid` or in the parser, never in a stale build.
 */
import { createMachine } from "@fozy-labs/rx-toolkit";
import { describe, expect, it } from "vitest";

import { parse } from "../src/parse/parse.js";

import { roundTripFixtures, statePathsOf, withDirectives } from "./roundTripFixtures.js";

describe.each(roundTripFixtures)("round trip: $name", (fixture) => {
    const definition = createMachine(fixture.config, fixture.implementations);
    const mermaid = definition.toMermaid();

    it("renders a stable diagram (grammar drift shows up here)", () => {
        expect(mermaid).toMatchSnapshot();
    });

    it("parses back into the same id, initial and states", () => {
        const parsed = parse(withDirectives(mermaid, fixture));
        expect(parsed.config.id).toBe(fixture.config.id);
        expect(parsed.config.initial).toBe(fixture.config.initial);
        expect(parsed.config.states).toEqual(fixture.config.states);
    });

    it("lists every state path", () => {
        const parsed = parse(withDirectives(mermaid, fixture));
        const expected = statePathsOf(fixture.config.states as Record<string, { states?: Record<string, unknown> }>);
        expect([...parsed.states.map((state) => state.path)].sort()).toEqual([...expected].sort());
    });
});

describe("withDirectives", () => {
    it("inserts the context type and one directive per implementation name after the header", () => {
        const text = withDirectives("stateDiagram-v2\n    %% @machine m\n    [*] --> a\n", {
            name: "m",
            contextType: "{ n: number }",
            config: { id: "m", initial: "a", states: { a: {} } },
            implementations: { guards: { g: () => true }, actions: { act: () => {} }, delays: { d: 1 } },
        });
        expect(text).toBe(
            [
                "stateDiagram-v2",
                "    %% @context type: { n: number }",
                "    %% @guard g: true",
                "    %% @action act: void 0",
                "    %% @delay d: 0",
                "    %% @machine m",
                "    [*] --> a",
                "",
            ].join("\n"),
        );
    });
});
