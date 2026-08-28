import { describe, expect, it } from "vitest";

import { convert } from "./convert.js";
import { parse } from "./parse/parse.js";
import { StatechartParseError } from "./StatechartParseError.js";
import { type MachineConfigJson, type ParseResult, type StateInfo } from "./types.js";
import { statePathOfConfigPath, validateMachineConfig } from "./validateMachineConfig.js";

/** A `ParseResult` around a hand-built config (the parser cannot produce most invalid configs). */
function parseResult(
    config: Omit<MachineConfigJson, "source"> & { source?: string },
    states: StateInfo[],
): ParseResult {
    return {
        machineId: config.id,
        config: { source: "stateDiagram-v2\n", ...config },
        context: {},
        events: {},
        eventTypes: [],
        guards: {},
        actions: {},
        delays: {},
        references: { guards: {}, actions: {} },
        states,
    };
}

function failing(action: () => void): StatechartParseError {
    try {
        action();
    } catch (error) {
        if (error instanceof StatechartParseError) return error;
        throw error;
    }
    throw new Error("expected a StatechartParseError");
}

describe("statePathOfConfigPath", () => {
    it("keeps the state keys of the leading `states.<key>` pairs and drops the rest", () => {
        expect(statePathOfConfigPath("")).toBe("");
        expect(statePathOfConfigPath("states")).toBe("");
        expect(statePathOfConfigPath("implementations.actions")).toBe("");
        expect(statePathOfConfigPath("states.a")).toBe("a");
        expect(statePathOfConfigPath("states.a.initial")).toBe("a");
        expect(statePathOfConfigPath("states.a.states.b.on.X[1]")).toBe("a.b");
        expect(statePathOfConfigPath("states.a.states.b.after.100[0].actions")).toBe("a.b");
        expect(statePathOfConfigPath("states.working.states.$final")).toBe("working.$final");
    });

    it("is not fooled by state keys or event names that read like config keys", () => {
        expect(statePathOfConfigPath("states.states.states.b")).toBe("states.b");
        expect(statePathOfConfigPath("states.on.on.X")).toBe("on");
        expect(statePathOfConfigPath("states.a.on.states.guard")).toBe("a");
    });
});

describe("validateMachineConfig", () => {
    it("accepts a valid parsed diagram and leaves the parse result untouched", () => {
        const parsed = parse("stateDiagram-v2\n%% @machine m\n[*] --> a\na --> b: X\n");
        expect(() => validateMachineConfig(parsed)).not.toThrow();
        // `createMachine` freezes what it accepts; the gate must run on a copy.
        expect(Object.isFrozen(parsed.config.states)).toBe(false);
        expect(Object.isFrozen(parsed.config.states.a)).toBe(false);
    });

    it("maps a root error to the header line without a path", () => {
        const parsed = parseResult(
            { id: "m", initial: "nope", states: { a: {} }, source: "%% intro\n\nstateDiagram-v2\n[*] --> a\n" },
            [{ id: "a", path: "a", line: 4 }],
        );
        const error = failing(() => validateMachineConfig(parsed));
        expect(error.message).toBe('Initial state node "nope" not found on parent state node #m');
        expect(error.line).toBe(3);
        expect(error.column).toBeUndefined();
        expect(error.path).toBeUndefined();
        expect(error.format()).toBe('3: Initial state node "nope" not found on parent state node #m');
    });

    it("falls back to line 1 for a root error when the source has no header", () => {
        const parsed = parseResult({ id: "m", initial: "nope", states: { a: {} }, source: "" }, [
            { id: "a", path: "a", line: 7 },
        ]);
        expect(failing(() => validateMachineConfig(parsed)).line).toBe(1);
    });

    it("maps a nested error to the line and path of the owning state", () => {
        const parsed = parseResult({ id: "m", initial: "a", states: { a: { initial: "zz", states: { b: {} } } } }, [
            { id: "a", path: "a", line: 4 },
            { id: "b", path: "a.b", parent: "a", line: 6 },
        ]);
        const error = failing(() => validateMachineConfig(parsed));
        expect(error.message).toBe('states.a: Initial state node "zz" not found on parent state node #m.a');
        expect(error.line).toBe(4);
        expect(error.path).toBe("a");
    });

    it("attributes a transition error (`states.a.states.b.on.X[1]`) to the source state", () => {
        const parsed = parseResult(
            {
                id: "m",
                initial: "a",
                states: {
                    a: { initial: "b", states: { b: { on: { X: [{ target: "c" }, { target: "nowhere" }] } }, c: {} } },
                },
            },
            [
                { id: "a", path: "a", line: 4 },
                { id: "b", path: "a.b", parent: "a", line: 6 },
                { id: "c", path: "a.c", parent: "a", line: 7 },
            ],
        );
        const error = failing(() => validateMachineConfig(parsed));
        expect(error.message).toBe("states.a.states.b.on.X[1]: Child state 'nowhere' does not exist on 'm.a'");
        expect(error.line).toBe(6);
        expect(error.path).toBe("a.b");
    });

    it("uses the nearest listed ancestor's line for a `$final` state (not listed in `states`)", () => {
        const parsed = parseResult(
            {
                id: "m",
                initial: "a",
                states: { a: { initial: "b", states: { b: {}, $final: { type: "final", initial: "b" } } } },
            },
            [
                { id: "a", path: "a", line: 4 },
                { id: "b", path: "a.b", parent: "a", line: 5 },
            ],
        );
        const error = failing(() => validateMachineConfig(parsed));
        expect(error.message).toBe("states.a.states.$final: 'initial' is not allowed on final state nodes");
        expect(error.line).toBe(4);
        expect(error.path).toBe("a.$final");
    });

    it("propagates errors that are not the library's config error", () => {
        // A function is not cloneable: `structuredClone` throws a DOMException, not a MachineConfigError.
        const parsed = parseResult({ id: "m", initial: "a", states: { a: { on: { X: (() => "a") as never } } } }, [
            { id: "a", path: "a", line: 3 },
        ]);
        expect(() => validateMachineConfig(parsed)).toThrow(/could not be cloned/);
    });
});

describe("convert(): the createMachine gate", () => {
    it("rejects a diagram the parser accepts but the library does not, with the line of the state", () => {
        // `Infinity` is a NAME for the label grammar (a named delay), but a numeric delay key for the library.
        const text = [
            "stateDiagram-v2",
            "%% @machine m",
            "%% @delay Infinity: 1000",
            "[*] --> a",
            "state a {",
            "    [*] --> b",
            "    b --> c: after Infinity",
            "}",
            "",
        ].join("\n");
        expect(() => parse(text)).not.toThrow();
        const error = failing(() => convert(text, { fileName: "m.mmd" }));
        expect(error.message).toBe(
            "states.a.states.b.after.Infinity: numeric delay must be a non-negative finite number (got Infinity)",
        );
        expect(error.line).toBe(6);
        expect(error.path).toBe("a.b");
        expect(error.format()).toBe(
            "6: states.a.states.b.after.Infinity: numeric delay must be a non-negative finite number (got Infinity) (at a.b)",
        );
    });
});
