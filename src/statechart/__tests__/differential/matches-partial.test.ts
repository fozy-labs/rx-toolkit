/**
 * Round 2 differential scenarios: `matches()` with partial nested object
 * values at every depth of compound → parallel → compound nesting, dotted
 * paths, empty objects, values more specific than the current state, and the
 * `{}` shape of atomic regions directly under a parallel node.
 */
import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "matches with partial nested objects at every depth of compound → parallel → compound",
        config: {
            id: "m",
            initial: "outer",
            states: {
                outer: {
                    initial: "par",
                    on: { LEAF: ".leaf", BACK: ".par" },
                    states: {
                        par: {
                            type: "parallel",
                            states: {
                                r1: {
                                    initial: "x",
                                    states: {
                                        x: {
                                            initial: "x1",
                                            states: { x1: { on: { NEXT: "x2" } }, x2: {} },
                                        },
                                        z: {},
                                    },
                                },
                                r2: {
                                    initial: "y",
                                    states: { y: { on: { NEXT: "w" } }, w: {} },
                                },
                            },
                        },
                        leaf: {},
                    },
                },
                other: {},
            },
        },
        events: [{ type: "NEXT" }, { type: "LEAF" }, { type: "BACK" }],
        probes: {
            matches: [
                "outer",
                "other",
                "outer.par",
                "outer.leaf",
                "outer.par.r1",
                "outer.par.r1.x",
                "outer.par.r1.x.x1",
                "outer.par.r1.x.x2",
                "outer.par.r1.z",
                "outer.par.r2.y",
                "outer.par.r2.w",
                { outer: "par" },
                { outer: "leaf" },
                { outer: { par: "r1" } },
                { outer: { par: { r1: "x" } } },
                { outer: { par: { r1: { x: "x1" } } } },
                { outer: { par: { r1: { x: "x2" } } } },
                { outer: { par: { r1: "x", r2: "y" } } },
                { outer: { par: { r1: { x: "x2" }, r2: "w" } } },
                { outer: { par: { r1: { x: "x2" }, r2: "y" } } },
                { outer: { par: { r2: "y" } } },
                { outer: { par: {} } },
                { outer: { leaf: {} } },
                { outer: {} },
                {},
            ],
        },
    },
    {
        name: "matches on a parallel node with atomic regions: region keys, empty objects, dotted paths",
        config: {
            id: "m",
            initial: "idle",
            states: {
                idle: { on: { GO: "par" } },
                par: {
                    type: "parallel",
                    states: {
                        a: {},
                        b: { initial: "b1", states: { b1: { on: { NEXT: "b2" } }, b2: {} } },
                    },
                    on: { LEAVE: "idle" },
                },
            },
        },
        events: [{ type: "GO" }, { type: "NEXT" }, { type: "LEAVE" }],
        probes: {
            matches: [
                "idle",
                "par",
                "par.a",
                "par.b",
                "par.b.b1",
                "par.b.b2",
                { par: "a" },
                { par: "b" },
                { par: { a: {} } },
                { par: { a: {}, b: "b2" } },
                { par: { b: "b1" } },
                { par: { b: {} } },
                { par: {} },
                { idle: {} },
                "idle.anything",
                { par: { c: {} } },
            ],
        },
    },
    {
        name: "matches on a parallel root with nested parallel regions",
        config: {
            id: "m",
            type: "parallel",
            states: {
                r1: {
                    type: "parallel",
                    states: {
                        n1: { initial: "a", states: { a: { on: { NEXT: "b" } }, b: {} } },
                        n2: {},
                    },
                },
                r2: { initial: "x", states: { x: { on: { NEXT: "y" } }, y: {} } },
            },
        },
        events: [{ type: "NEXT" }],
        probes: {
            matches: [
                "r1",
                "r2",
                "r1.n1",
                "r1.n1.a",
                "r1.n1.b",
                "r1.n2",
                "r2.x",
                "r2.y",
                { r1: "n1" },
                { r1: { n1: "a" } },
                { r1: { n1: "b", n2: {} } },
                { r1: { n1: "b" }, r2: "y" },
                { r1: { n1: "b" }, r2: "x" },
                { r1: {}, r2: {} },
                {},
            ],
        },
    },
    {
        name: "matches during a done machine and a stopped machine keeps answering for the last configuration",
        config: {
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: { a: { on: { NEXT: "b" } }, b: { on: { FINISH: "#m.f" } } },
                },
                f: { type: "final" },
            },
        },
        events: [{ type: "NEXT" }, { stop: true }],
        probes: { matches: ["p", { p: "a" }, { p: "b" }, "f", "p.b"] },
    },
    {
        name: "matches on a done machine reflects the final configuration",
        config: {
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: { a: { on: { NEXT: "b" } }, b: { on: { FINISH: "#m.f" } } },
                },
                f: { type: "final" },
            },
        },
        events: [{ type: "NEXT" }, { type: "FINISH" }],
        probes: { matches: ["p", { p: "b" }, "f", {}] },
    },
];

describeScenarios("differential: matches with partial nested values", scenarios);
