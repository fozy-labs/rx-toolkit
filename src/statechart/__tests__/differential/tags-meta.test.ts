/**
 * Round 2 differential scenarios: `tags` (root, history restore, deduplication,
 * parallel regions, a done machine) and `description` / `meta` on state nodes
 * and transitions — they must not influence behaviour and must be kept on the
 * raw config both libraries expose.
 */
import { createMachine as createXStateMachine } from "xstate";

import { createMachine } from "@/statechart";

import { describeScenarios, type Scenario } from "./harness";

export const scenarios: Scenario[] = [
    {
        name: "tags on the root, deduplicated across ancestor and leaf, after a history restore, and on a top-level final while done",
        config: {
            id: "m",
            initial: "p",
            tags: ["root"],
            states: {
                p: {
                    tags: ["p", "shared"],
                    initial: "x",
                    states: {
                        x: { tags: "shared", on: { NEXT: "y" } },
                        y: { tags: ["y", "root"] },
                        hist: { type: "history" },
                    },
                    on: { OUT: "q", FINISH: "f" },
                },
                q: { tags: "q", on: { BACK: "#m.p.hist" } },
                f: { type: "final", tags: ["final", "shared"] },
            },
        },
        events: [{ type: "NEXT" }, { type: "OUT" }, { type: "BACK" }, { type: "FINISH" }, { type: "NEXT" }],
    },
    {
        name: "tags of parallel regions with nested compound states; regions without tags contribute nothing",
        config: {
            id: "m",
            initial: "idle",
            states: {
                idle: { tags: "idle", on: { GO: "par" } },
                par: {
                    type: "parallel",
                    tags: "par",
                    states: {
                        r1: {
                            initial: "a",
                            states: {
                                a: { tags: ["a", "leaf"], on: { NEXT: "b" } },
                                b: {
                                    tags: "b",
                                    initial: "b1",
                                    states: { b1: { tags: ["b1", "leaf"] } },
                                },
                            },
                        },
                        r2: { initial: "x", states: { x: { on: { NEXT: "y" } }, y: { tags: "y" } } },
                    },
                    on: { LEAVE: "idle" },
                },
            },
        },
        events: [{ type: "GO" }, { type: "NEXT" }, { type: "LEAVE" }],
    },
    {
        name: "tags are unchanged by targetless transitions and by a stop()",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { tags: "a", on: { PING: { actions: lib.record("ping") }, NEXT: "b" } },
                b: { tags: ["b"], after: { 10: "a" } },
            },
        }),
        events: [{ type: "PING" }, { type: "NEXT" }, { stop: true }, { advance: 10 }],
    },
    {
        name: "description and meta on states and transitions (on / always / after / onDone) do not affect behaviour",
        config: (lib) => ({
            id: "m",
            initial: "a",
            description: "root description",
            meta: { level: "root" },
            context: { go: false },
            states: {
                a: {
                    description: "state a",
                    meta: { level: "a", nested: { deep: true } },
                    on: {
                        GO: {
                            target: "b",
                            description: "a → b",
                            meta: { kind: "on" },
                            actions: lib.record("go"),
                        },
                    },
                },
                b: {
                    description: "state b",
                    meta: { level: "b" },
                    after: { 10: { target: "p", description: "timeout", meta: { kind: "after" } } },
                },
                p: {
                    initial: "w",
                    meta: { level: "p" },
                    states: {
                        w: {
                            description: "waiting",
                            always: {
                                target: "f",
                                guard: ({ context }: any) => context.go,
                                description: "eventless",
                                meta: { kind: "always" },
                            },
                            on: { SET: { actions: lib.assign({ go: true }), description: "set flag" } },
                        },
                        f: { type: "final", meta: { level: "f" }, description: "done" },
                    },
                    onDone: {
                        target: "end",
                        description: "p done",
                        meta: { kind: "onDone" },
                        actions: lib.record("pDone"),
                    },
                },
                end: { type: "final", description: "the end", meta: { level: "end" } },
            },
        }),
        events: [{ type: "GO" }, { advance: 10 }, { type: "SET" }],
    },
];

describeScenarios("differential: tags, description and meta", scenarios);

describe("differential: description / meta pass-through on the raw config", () => {
    const config = {
        id: "m",
        initial: "a",
        description: "root description",
        meta: { level: "root" },
        states: {
            a: {
                description: "state a",
                meta: { level: "a", nested: { deep: true } },
                on: {
                    GO: { target: "b", description: "a → b", meta: { kind: "on" } },
                    STAY: [{ guard: () => false, description: "never" }, { meta: { kind: "fallback" } }],
                },
            },
            b: { description: "state b", meta: { level: "b" } },
        },
    };

    it("keeps description and meta on state nodes and transitions exactly as authored", () => {
        const ours = createMachine(config as any).config as any;
        const theirs = createXStateMachine(config as any).config as any;

        for (const path of [
            ["description"],
            ["meta"],
            ["states", "a", "description"],
            ["states", "a", "meta"],
            ["states", "a", "on", "GO", "description"],
            ["states", "a", "on", "GO", "meta"],
            ["states", "a", "on", "STAY", "0", "description"],
            ["states", "a", "on", "STAY", "1", "meta"],
            ["states", "b", "description"],
            ["states", "b", "meta"],
        ]) {
            const pick = (root: any) => path.reduce((node, key) => node[key], root);
            expect(pick(ours)).toEqual(pick(theirs));
            expect(pick(ours)).toEqual(pick(config));
        }
    });

    it("xstate exposes the same meta on the state node; our definition keeps it reachable through the config", () => {
        const theirs = createXStateMachine(config as any);
        const ours = createMachine(config as any);
        expect(theirs.getStateNodeById("m.a").meta).toEqual(ours.config.states?.a?.meta);
        expect(theirs.getStateNodeById("m.a").description).toEqual(ours.config.states?.a?.description);
        expect(theirs.root.meta).toEqual(ours.config.meta);
    });
});
