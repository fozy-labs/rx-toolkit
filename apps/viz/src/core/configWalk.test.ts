import { describe, expect, it } from "vitest";

import type { MachineConfigLike } from "../types";

import {
    collectOutgoingEvents,
    describeTarget,
    findStateChain,
    implementationName,
    normalizeTransitions,
} from "./configWalk";

const trafficLight: MachineConfigLike = {
    id: "trafficLight",
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
                red: { after: { 3000: "green" }, on: { FAULT: "$final", POWER_OFF: "#trafficLight.broken" } },
                $final: { type: "final" },
            },
        },
        broken: { on: { RESET: { target: "off", actions: ["retry"] } } },
    },
};

const parallel: MachineConfigLike = {
    id: "parallelDemo",
    initial: "idle",
    states: {
        idle: { on: { START: "p" } },
        p: {
            type: "parallel",
            on: { STOP: "idle" },
            states: {
                $0: { initial: "a", states: { a: { on: { NEXT_A: "b" } }, b: {} } },
                $1: { initial: "c", states: { c: { on: { NEXT_C: "d" } }, d: {} } },
            },
        },
    },
};

function hasPower(): boolean {
    return true;
}

/** A builtin the way the library creates it: a function named like its creator, carrying its `type`. */
const builtinGuard = Object.assign(
    function and(): never {
        throw new Error("declarative");
    },
    { type: "xstate.and" },
);

/** The library's config shape: inline functions, `{ type }` references, readonly arrays, holes. */
const configAuthored: MachineConfigLike = {
    initial: "a",
    states: {
        a: {
            on: {
                GO: [
                    { target: "b", guard: hasPower, actions: [() => undefined, { type: "notify" }] },
                    undefined,
                    { target: ["b"], guard: builtinGuard },
                ] as const,
                SKIP: undefined,
                NOOP: [],
            },
        },
        b: {},
    },
};

describe("implementationName", () => {
    it("names strings, references, functions, anonymous functions and builtins", () => {
        expect(implementationName("hasPower")).toBe("hasPower");
        expect(implementationName({ type: "hasPower" })).toBe("hasPower");
        expect(implementationName(hasPower)).toBe("hasPower");
        expect(implementationName(() => true)).toBe("anonymous");
        expect(implementationName(builtinGuard)).toBe("and");
    });
});

describe("normalizeTransitions", () => {
    it("normalizes strings, objects and arrays", () => {
        expect(normalizeTransitions(undefined)).toEqual([]);
        expect(normalizeTransitions("off")).toEqual([{ target: "off", actions: [] }]);
        expect(normalizeTransitions({ target: "x", guard: "g" })).toEqual([{ target: "x", guard: "g", actions: [] }]);
        expect(normalizeTransitions([{ actions: ["a"] }, "y"])).toEqual([
            { target: undefined, guard: undefined, actions: ["a"] },
            { target: "y", actions: [] },
        ]);
    });

    it("skips holes and names non-string guards and actions", () => {
        expect(normalizeTransitions(configAuthored.states?.a.on?.GO)).toEqual([
            { target: "b", guard: "hasPower", actions: ["anonymous", "notify"] },
            { target: ["b"], guard: "and", actions: [] },
        ]);
        expect(normalizeTransitions([undefined])).toEqual([]);
    });
});

describe("findStateChain", () => {
    it("finds nested states through compound and parallel parents", () => {
        expect(findStateChain(trafficLight, "red")?.map((e) => e.key)).toEqual(["working", "red"]);
        expect(findStateChain(parallel, "d")?.map((e) => e.path.join("."))).toEqual(["p", "p.$1", "p.$1.d"]);
        expect(findStateChain(trafficLight, "off")?.map((e) => e.key)).toEqual(["off"]);
    });

    it("returns null for unknown and synthetic ids, and for configs without states", () => {
        expect(findStateChain(trafficLight, "nope")).toBeNull();
        expect(findStateChain(trafficLight, "$final")).toBeNull();
        expect(findStateChain(parallel, "$0")).toBeNull();
        expect(findStateChain({}, "a")).toBeNull();
    });
});

describe("collectOutgoingEvents", () => {
    it("lists own events before the ancestors' and lets the innermost definition win", () => {
        const events = collectOutgoingEvents(trafficLight, "red");
        expect(events.map((e) => [e.event, e.definedBy])).toEqual([
            ["FAULT", "red"],
            ["POWER_OFF", "red"],
        ]);
        expect(events[1].transitions).toEqual([{ target: "#trafficLight.broken", actions: [] }]);
    });

    it("includes ancestor events for a state without its own", () => {
        expect(collectOutgoingEvents(trafficLight, "green")).toEqual([
            {
                event: "POWER_OFF",
                definedBy: "working",
                definedByPath: ["working"],
                transitions: [{ target: "off", actions: [] }],
            },
        ]);
    });

    it("walks through parallel regions", () => {
        expect(collectOutgoingEvents(parallel, "c").map((e) => [e.event, e.definedBy])).toEqual([
            ["NEXT_C", "c"],
            ["STOP", "p"],
        ]);
    });

    it("skips events without transitions and returns nothing for unknown ids", () => {
        expect(collectOutgoingEvents(configAuthored, "a").map((e) => e.event)).toEqual(["GO"]);
        expect(collectOutgoingEvents(trafficLight, "nope")).toEqual([]);
    });
});

describe("describeTarget", () => {
    it("strips the machine id prefix, joins multiple targets and names targetless transitions", () => {
        expect(describeTarget("working", "trafficLight")).toBe("working");
        expect(describeTarget("#trafficLight.working.$final", "trafficLight")).toBe("working.$final");
        expect(describeTarget(["#p.$0.a", "#p.$1.c"], "p")).toBe("$0.a, $1.c");
        expect(describeTarget(undefined, "trafficLight")).toBe("(internal)");
    });
});
