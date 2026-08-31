import {
    emit,
    enqueueActions,
    forwardTo,
    sendParent,
    sendTo,
    spawnChild,
    stopChild,
    and as xstateAnd,
    assign as xstateAssign,
    cancel as xstateCancel,
    log as xstateLog,
    not as xstateNot,
    or as xstateOr,
    raise as xstateRaise,
    stateIn as xstateStateIn,
} from "xstate";

import { assign, cancel, log, mutate, raise } from "../actions";
import { and, not, or, stateIn } from "../guards";
import type { AnyEventObject, MachineConfig, MachineContext } from "../types";
import { BUILTIN } from "../types/brand";

import { createBuiltin, isBuiltin } from "./createBuiltin";
import { deepFreeze } from "./deepFreeze";
import { MachineConfigError } from "./MachineConfigError";
import type { MachineModel, StateNode, Transition } from "./model";
import { normalize } from "./normalize";

type AnyModel = MachineModel<MachineContext, AnyEventObject>;
type AnyNode = StateNode<MachineContext, AnyEventObject>;
type AnyTransition = Transition<MachineContext, AnyEventObject>;

/** Normalizes an arbitrary (possibly invalid) config the way `createMachine` does: deep-frozen first. */
function build(config: unknown): AnyModel {
    return normalize(deepFreeze(config, { except: ["context"] }) as MachineConfig<MachineContext, AnyEventObject>);
}

function node(model: AnyModel, id: string): AnyNode {
    const found = model.idMap.get(id);
    if (!found) throw new Error(`test: node '${id}' not found`);
    return found;
}

function transitions(model: AnyModel, id: string, eventType: string): readonly AnyTransition[] {
    return node(model, id).transitions.get(eventType) ?? [];
}

function targetIds(transition: AnyTransition): string[] | null {
    return transition.target?.map((t) => t.id) ?? null;
}

/** Asserts a `MachineConfigError` with the exact path and a detail matching `detail`. */
function expectConfigError(config: unknown, path: string, detail: string | RegExp): MachineConfigError {
    let caught: unknown;
    try {
        build(config);
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(MachineConfigError);
    const error = caught as MachineConfigError;
    expect(error.path).toBe(path);
    if (typeof detail === "string") {
        expect(error.detail).toContain(detail);
    } else {
        expect(error.detail).toMatch(detail);
    }
    expect(error.message).toBe(path ? `${path}: ${error.detail}` : error.detail);
    return error;
}

/** Builds a malformed builtin the creators would not produce (type checks bypassed on purpose). */
function malformedBuiltin(brand: string, type: string, props: Record<string, unknown>): unknown {
    return createBuiltin<{ readonly [BUILTIN]: string; readonly type: string }>(brand, brand, type, props);
}

const trafficLight = {
    id: "trafficLight",
    initial: "green",
    context: { ready: false },
    states: {
        green: { after: { 3000: "yellow" } },
        yellow: { on: { TIMER: { target: "red", guard: "isReady", actions: "warn" } } },
        red: { on: { TIMER: "green" } },
    },
};

describe("normalize — model", () => {
    describe("nodes", () => {
        it("builds the root with the machine id, an empty path and document order 0", () => {
            const model = build(trafficLight);
            expect(model.id).toBe("trafficLight");
            expect(model.root.id).toBe("trafficLight");
            expect(model.root.key).toBe("trafficLight");
            expect(model.root.path).toEqual([]);
            expect(model.root.configPath).toBe("");
            expect(model.root.order).toBe(0);
            expect(model.root.parent).toBeNull();
            expect(model.root.type).toBe("compound");
            expect(model.config).toBe(trafficLight);
        });

        it("defaults the machine id to '(machine)'", () => {
            const model = build({ initial: "a", states: { a: {} } });
            expect(model.id).toBe("(machine)");
            expect(node(model, "(machine).a").id).toBe("(machine).a");
        });

        it("generates ids from the path, keeps explicit ids and registers every node in idMap", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: { initial: "b", states: { b: {}, c: { id: "custom" } } },
                    d: {},
                },
            });
            expect([...model.idMap.keys()]).toEqual(["m", "m.a", "m.a.b", "custom", "m.d"]);
            expect(node(model, "custom").key).toBe("c");
            expect(node(model, "custom").path).toEqual(["a", "c"]);
            expect(node(model, "custom").configPath).toBe("states.a.states.c");
            expect(node(model, "m.a").children.map((c) => c.key)).toEqual(["b", "c"]);
            expect(node(model, "m.a").childrenByKey.get("c")).toBe(node(model, "custom"));
            expect(node(model, "m.a.b").parent).toBe(node(model, "m.a"));
        });

        it("assigns document order depth-first (parent before children, config key order)", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: { initial: "b", states: { b: {}, c: {} } },
                    d: {},
                },
            });
            expect(model.nodes.map((n) => n.id)).toEqual(["m", "m.a", "m.a.b", "m.a.c", "m.d"]);
            model.nodes.forEach((n, index) => expect(n.order).toBe(index));
        });

        it("infers the node type from `states` / `history` and keeps explicit types", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        initial: "b",
                        states: { b: {}, h: { history: true }, hd: { type: "history", history: "deep" } },
                    },
                    p: { type: "parallel", states: { x: {}, y: {} } },
                    f: { type: "final" },
                    z: {},
                },
            });
            expect(node(model, "m.a").type).toBe("compound");
            expect(node(model, "m.a.b").type).toBe("atomic");
            expect(node(model, "m.a.h").type).toBe("history");
            expect(node(model, "m.a.h").history).toBe("shallow");
            expect(node(model, "m.a.hd").history).toBe("deep");
            expect(node(model, "m.p").type).toBe("parallel");
            expect(node(model, "m.f").type).toBe("final");
            expect(node(model, "m.z").type).toBe("atomic");
            expect(node(model, "m.z").history).toBeNull();
        });

        it("defaults `history` to shallow on `type: 'history'` nodes without a `history` key", () => {
            const model = build({ id: "m", initial: "a", states: { a: {}, h: { type: "history" } } });
            expect(node(model, "m.h").history).toBe("shallow");
        });

        it("keeps tags (string or array), description and meta", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: { tags: "one", description: "A", meta: { x: 1 } },
                    b: { tags: ["one", "two"] },
                },
            });
            expect(node(model, "m.a").tags).toEqual(["one"]);
            expect(node(model, "m.b").tags).toEqual(["one", "two"]);
            expect(node(model, "m.a").description).toBe("A");
            expect(node(model, "m.a").meta).toEqual({ x: 1 });
            expect(model.root.tags).toEqual([]);
        });

        it("keeps `output` for final nodes and the root only", () => {
            const rootOutput = () => 1;
            const finalOutput = { done: true };
            const model = build({
                id: "m",
                initial: "a",
                output: rootOutput,
                states: { a: {}, f: { type: "final", output: finalOutput } },
            });
            expect(model.root.output).toBe(rootOutput);
            expect(node(model, "m.f").output).toBe(finalOutput);
            expect(node(model, "m.a").output).toBeUndefined();
        });

        it("keeps entry / exit actions as raw values", () => {
            const inline = () => undefined;
            const model = build({
                id: "m",
                initial: "a",
                entry: "rootEntry",
                states: { a: { entry: ["enter", { type: "p", params: { x: 1 } }, inline], exit: "leave" } },
            });
            expect(model.root.entry).toEqual(["rootEntry"]);
            expect(node(model, "m.a").entry).toEqual(["enter", { type: "p", params: { x: 1 } }, inline]);
            expect(node(model, "m.a").exit).toEqual(["leave"]);
            expect(model.root.exit).toEqual([]);
        });

        it("ignores the `types` key", () => {
            expect(() => build({ types: { context: {}, events: {} }, initial: "a", states: { a: {} } })).not.toThrow();
        });
    });

    describe("context", () => {
        it("wraps an object context in a factory returning the same (unfrozen) object", () => {
            const context = { ready: false };
            const model = build({ initial: "a", context, states: { a: {} } });
            expect(model.context()).toBe(context);
            expect(Object.isFrozen(context)).toBe(false);
        });

        it("keeps a context factory as is", () => {
            const factory = () => ({ n: 1 });
            const model = build({ initial: "a", context: factory, states: { a: {} } });
            expect(model.context).toBe(factory);
        });

        it("yields a fresh empty object per call when `context` is absent", () => {
            const model = build({ initial: "a", states: { a: {} } });
            expect(model.context()).toEqual({});
            expect(model.context()).not.toBe(model.context());
        });
    });

    describe("initial transitions", () => {
        it("creates an initial transition for every compound node", () => {
            const model = build({ id: "m", initial: "a", states: { a: { initial: "b", states: { b: {} } } } });
            const rootInitial = model.root.initial!;
            expect(rootInitial.source).toBe(model.root);
            expect(rootInitial.target).toEqual([node(model, "m.a")]);
            expect(rootInitial.actions).toEqual([]);
            expect(rootInitial.guard).toBeNull();
            expect(rootInitial.reenter).toBe(false);
            expect(rootInitial.eventType).toBeNull();
            expect(rootInitial.delay).toBeNull();
            expect(rootInitial.configPath).toBe("initial");
            expect(node(model, "m.a").initial!.configPath).toBe("states.a.initial");
            expect(node(model, "m.a").initial!.target[0]).toBe(node(model, "m.a.b"));
            expect(node(model, "m.a.b").initial).toBeNull();
        });

        it("parallel nodes have no initial transition", () => {
            const model = build({ id: "m", type: "parallel", states: { a: {}, b: {} } });
            expect(model.root.initial).toBeNull();
        });
    });

    describe("`on` transitions", () => {
        it("normalizes a string, an object and an array into candidates in config order", () => {
            const guard = () => true;
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        on: {
                            GO: "b",
                            STEP: {
                                target: "b",
                                actions: ["x", "y"],
                                guard,
                                reenter: true,
                                description: "d",
                                meta: { m: 1 },
                            },
                            MULTI: [{ target: "b", guard: "g1" }, "c", { actions: "only" }],
                        },
                    },
                    b: {},
                    c: {},
                },
            });
            const a = node(model, "m.a");
            expect([...a.transitions.keys()]).toEqual(["GO", "STEP", "MULTI"]);

            const [go] = transitions(model, "m.a", "GO");
            expect(go.source).toBe(a);
            expect(targetIds(go)).toEqual(["m.b"]);
            expect(go.actions).toEqual([]);
            expect(go.guard).toBeNull();
            expect(go.reenter).toBe(false);
            expect(go.eventType).toBe("GO");
            expect(go.delay).toBeNull();
            expect(go.configPath).toBe("states.a.on.GO[0]");

            const [step] = transitions(model, "m.a", "STEP");
            expect(step.actions).toEqual(["x", "y"]);
            expect(step.guard).toBe(guard);
            expect(step.reenter).toBe(true);
            expect(step.description).toBe("d");
            expect(step.meta).toEqual({ m: 1 });

            const multi = transitions(model, "m.a", "MULTI");
            expect(multi.map(targetIds)).toEqual([["m.b"], ["m.c"], null]);
            expect(multi.map((t) => t.configPath)).toEqual([
                "states.a.on.MULTI[0]",
                "states.a.on.MULTI[1]",
                "states.a.on.MULTI[2]",
            ]);
            expect(multi[0].guard).toBe("g1");
            expect(multi[2].actions).toEqual(["only"]);
        });

        it("treats an omitted, undefined or empty-string target as targetless", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        on: {
                            A: { actions: "x" },
                            B: { target: "" },
                            C: undefined,
                            D: [undefined, { target: undefined }],
                        },
                    },
                },
            });
            expect(targetIds(transitions(model, "m.a", "A")[0])).toBeNull();
            expect(targetIds(transitions(model, "m.a", "B")[0])).toBeNull();
            expect(targetIds(transitions(model, "m.a", "C")[0])).toBeNull();
            expect(transitions(model, "m.a", "D").map(targetIds)).toEqual([null, null]);
        });

        it("accepts wildcard descriptors ('*', 'user.*') and keeps them verbatim", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: { a: { on: { "*": "b", "user.*": "b", "user.login": "b" } }, b: {} },
            });
            expect([...node(model, "m.a").transitions.keys()]).toEqual(["*", "user.*", "user.login"]);
        });

        it("keeps an empty transition array as an empty candidate list (XState parity)", () => {
            const model = build({ id: "m", initial: "a", states: { a: { on: { E: [] } } } });
            expect(transitions(model, "m.a", "E")).toEqual([]);
        });

        it("supports transitions on the root and on final nodes (XState allows both)", () => {
            const model = build({
                id: "m",
                initial: "p",
                on: { RESET: ".p" },
                states: {
                    p: {
                        initial: "a",
                        states: {
                            a: { on: { GO: "f" } },
                            f: {
                                type: "final",
                                on: { BACK: "a" },
                                always: [{ guard: "never", target: "a" }],
                                after: { 10: "a" },
                            },
                        },
                    },
                },
            });
            expect(targetIds(transitions(model, "m", "RESET")[0])).toEqual(["m.p"]);
            expect(targetIds(transitions(model, "m.p.f", "BACK")[0])).toEqual(["m.p.a"]);
            expect(node(model, "m.p.f").always).toHaveLength(1);
            expect(node(model, "m.p.f").after).toHaveLength(1);
        });
    });

    describe("target resolution", () => {
        const nested = {
            id: "m",
            initial: "a",
            on: { ROOT: ".b" },
            states: {
                a: {
                    initial: "x",
                    on: {
                        SIBLING: "b",
                        DOTTED: "b.y",
                        BY_ID: "#deep",
                        BY_ID_PATH: "#m.b.y",
                        CHILD: ".x",
                        SELF: ".",
                    },
                    states: { x: { on: { UP: "#m.a" } } },
                },
                b: { initial: "y", states: { y: { id: "deep" } } },
            },
        };

        it("resolves sibling keys, dotted sibling paths, '#id', '#id.path', '.child' and '.'", () => {
            const model = build(nested);
            expect(targetIds(transitions(model, "m.a", "SIBLING")[0])).toEqual(["m.b"]);
            expect(targetIds(transitions(model, "m.a", "DOTTED")[0])).toEqual(["deep"]);
            expect(targetIds(transitions(model, "m.a", "BY_ID")[0])).toEqual(["deep"]);
            expect(targetIds(transitions(model, "m.a", "BY_ID_PATH")[0])).toEqual(["deep"]);
            expect(targetIds(transitions(model, "m.a", "CHILD")[0])).toEqual(["m.a.x"]);
            expect(targetIds(transitions(model, "m.a", "SELF")[0])).toEqual(["m.a"]);
            expect(targetIds(transitions(model, "m.a.x", "UP")[0])).toEqual(["m.a"]);
        });

        it("resolves '.child' relative to the root for root transitions", () => {
            const model = build(nested);
            expect(targetIds(transitions(model, "m", "ROOT")[0])).toEqual(["m.b"]);
        });

        it("resolves a history node as a target and keeps it in the transition", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: { initial: "x", states: { x: {}, h: { type: "history" } } },
                    b: { on: { BACK: "a.h" } },
                },
            });
            expect(targetIds(transitions(model, "m.b", "BACK")[0])).toEqual(["m.a.h"]);
        });

        it("accepts multiple targets across regions of one parallel state (also nested regions)", () => {
            const model = build({
                id: "m",
                initial: "idle",
                states: {
                    idle: { on: { GO: { target: ["#p.r1.b", "#p.r2.d.e"] } } },
                    p: {
                        id: "p",
                        type: "parallel",
                        states: {
                            r1: { initial: "a", states: { a: {}, b: {} } },
                            r2: { initial: "c", states: { c: {}, d: { initial: "e", states: { e: {} } } } },
                        },
                    },
                },
            });
            expect(targetIds(transitions(model, "m.idle", "GO")[0])).toEqual(["m.p.r1.b", "m.p.r2.d.e"]);
        });

        it("accepts a backslash-escaped '.' in target paths (XState `toStatePath`)", () => {
            // Keys with dots are rejected, so the escape only ever resolves to a plain segment.
            const model = build({ id: "m", initial: "a", states: { a: { on: { GO: "b\\x" } }, bx: {} } });
            expect(targetIds(transitions(model, "m.a", "GO")[0])).toEqual(["m.bx"]);
        });
    });

    describe("`onDone`", () => {
        it("synthesizes the `xstate.done.state.<id>` descriptor on compound and parallel nodes", () => {
            const model = build({
                id: "m",
                initial: "p",
                states: {
                    p: { initial: "a", states: { a: {}, f: { type: "final" } }, onDone: "q" },
                    q: {
                        type: "parallel",
                        states: { r1: { type: "final" }, r2: { type: "final" } },
                        onDone: [{ target: "p", guard: "g" }, { actions: "noop" }],
                    },
                },
            });
            const [done] = transitions(model, "m.p", "xstate.done.state.m.p");
            expect(done.eventType).toBe("xstate.done.state.m.p");
            expect(targetIds(done)).toEqual(["m.q"]);
            expect(done.configPath).toBe("states.p.onDone[0]");
            const q = transitions(model, "m.q", "xstate.done.state.m.q");
            expect(q).toHaveLength(2);
            expect(q[1].configPath).toBe("states.q.onDone[1]");
            expect(targetIds(q[1])).toBeNull();
        });
    });

    describe("`after`", () => {
        it("turns numeric keys into numeric delays and named keys into delay references", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        entry: "enterA",
                        exit: "exitA",
                        after: { 3000: "b", SHORT: [{ target: "b", guard: "g" }, { actions: "tick" }] },
                    },
                    b: {},
                },
            });
            const a = node(model, "m.a");
            expect(a.after.map((t) => [t.eventType, t.delay, t.configPath])).toEqual([
                ["xstate.after.3000.m.a", 3000, "states.a.after.3000[0]"],
                ["xstate.after.SHORT.m.a", "SHORT", "states.a.after.SHORT[0]"],
                ["xstate.after.SHORT.m.a", "SHORT", "states.a.after.SHORT[1]"],
            ]);
            expect(transitions(model, "m.a", "xstate.after.3000.m.a")).toEqual([a.after[0]]);
            expect(transitions(model, "m.a", "xstate.after.SHORT.m.a")).toEqual([a.after[1], a.after[2]]);
            expect(targetIds(a.after[0])).toEqual(["m.b"]);
            expect(model.references.delays).toEqual(new Set(["SHORT"]));
        });

        it("appends one raise/cancel pair per key after the configured entry / exit actions", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: { a: { entry: "enterA", exit: "exitA", after: { 3000: "b", SHORT: "b" } }, b: {} },
            });
            const a = node(model, "m.a");
            expect(a.entry).toHaveLength(3);
            expect(a.exit).toHaveLength(3);
            expect(a.entry[0]).toBe("enterA");
            expect(a.exit[0]).toBe("exitA");

            const raised = a.entry.slice(1) as unknown as {
                type: string;
                event: { type: string };
                id: string;
                delay: unknown;
            }[];
            expect(raised.every(isBuiltin)).toBe(true);
            expect(raised.map((r) => [r.type, r.event.type, r.id, r.delay])).toEqual([
                ["xstate.raise", "xstate.after.3000.m.a", "xstate.after.3000.m.a", 3000],
                ["xstate.raise", "xstate.after.SHORT.m.a", "xstate.after.SHORT.m.a", "SHORT"],
            ]);

            const cancelled = a.exit.slice(1) as unknown as { type: string; sendId: string }[];
            expect(cancelled.map((c) => [c.type, c.sendId])).toEqual([
                ["xstate.cancel", "xstate.after.3000.m.a"],
                ["xstate.cancel", "xstate.after.SHORT.m.a"],
            ]);
        });

        it("keeps `on` descriptors before `onDone` and `after` descriptors in the transitions map", () => {
            const model = build({
                id: "m",
                initial: "p",
                states: {
                    p: {
                        initial: "a",
                        states: { a: {}, f: { type: "final" } },
                        after: { 10: { actions: "x" } },
                        onDone: { actions: "y" },
                        on: { E: { actions: "z" } },
                    },
                },
            });
            expect([...node(model, "m.p").transitions.keys()]).toEqual([
                "E",
                "xstate.done.state.m.p",
                "xstate.after.10.m.p",
            ]);
        });

        it("accepts a numeric string key with an exponent the way XState does (`+key`)", () => {
            const model = build({ id: "m", initial: "a", states: { a: { after: { "1e3": "b" } }, b: {} } });
            expect(node(model, "m.a").after[0].delay).toBe(1000);
            expect(node(model, "m.a").after[0].eventType).toBe("xstate.after.1000.m.a");
        });
    });

    describe("`always`", () => {
        it("creates eventless transitions with the null event descriptor", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: { a: { always: [{ target: "b", guard: "g" }, "c"] }, b: {}, c: {} },
            });
            const always = node(model, "m.a").always;
            expect(always.map((t) => [t.eventType, targetIds(t), t.configPath])).toEqual([
                ["", ["m.b"], "states.a.always[0]"],
                ["", ["m.c"], "states.a.always[1]"],
            ]);
            expect(node(model, "m.a").transitions.has("")).toBe(false);
            expect(node(model, "m.b").always).toEqual([]);
        });
    });

    describe("history nodes", () => {
        it("resolves the default target relative to the parent (sibling, '#id') and keeps null when absent", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        initial: "x",
                        states: {
                            x: { initial: "y", states: { y: { id: "deepest" } } },
                            z: {},
                            h1: { type: "history", target: "z" },
                            h2: { type: "history", history: "deep", target: "#deepest" },
                            h3: { type: "history", target: "x.y" },
                            h4: { history: true },
                        },
                    },
                },
            });
            expect(node(model, "m.a.h1").historyTarget!.map((t) => t.id)).toEqual(["m.a.z"]);
            expect(node(model, "m.a.h2").historyTarget!.map((t) => t.id)).toEqual(["deepest"]);
            expect(node(model, "m.a.h3").historyTarget!.map((t) => t.id)).toEqual(["deepest"]);
            expect(node(model, "m.a.h4").historyTarget).toBeNull();
        });

        it("allows history nodes under parallel parents (XState resolves them to the parent)", () => {
            const model = build({
                id: "m",
                type: "parallel",
                states: { r1: {}, r2: {}, h: { type: "history" } },
            });
            expect(node(model, "m.h").type).toBe("history");
            expect(node(model, "m.h").historyTarget).toBeNull();
        });
    });

    describe("references", () => {
        it("collects names from every action / guard / delay position, not inline functions", () => {
            const model = build({
                id: "m",
                initial: "a",
                entry: ["rootEntry", assign({ x: 1 }), raise({ type: "E" }, { delay: "RAISE_DELAY" })],
                states: {
                    a: {
                        entry: { type: "objEntry", params: 1 },
                        exit: () => undefined,
                        after: { NAMED: { actions: "afterAction" }, 100: "b" },
                        always: {
                            guard: and(["g1", { type: "g2" }, not("g3"), or([() => true, "g4"]), stateIn("#m.b")]),
                        },
                        on: { E: { guard: "g5", actions: [log("x"), cancel("id"), "onAction"] } },
                    },
                    b: { on: { F: { guard: () => false } } },
                },
            });
            expect(model.references.actions).toEqual(new Set(["rootEntry", "objEntry", "afterAction", "onAction"]));
            expect(model.references.guards).toEqual(new Set(["g1", "g2", "g3", "g4", "g5"]));
            expect(model.references.delays).toEqual(new Set(["RAISE_DELAY", "NAMED"]));
        });
    });

    describe("immutability", () => {
        it("freezes the model, the nodes and their arrays", () => {
            const model = build(trafficLight);
            expect(Object.isFrozen(model)).toBe(true);
            expect(Object.isFrozen(model.nodes)).toBe(true);
            expect(Object.isFrozen(model.references)).toBe(true);
            for (const n of model.nodes) {
                expect(Object.isFrozen(n)).toBe(true);
                expect(Object.isFrozen(n.children)).toBe(true);
                expect(Object.isFrozen(n.entry)).toBe(true);
                expect(Object.isFrozen(n.exit)).toBe(true);
                expect(Object.isFrozen(n.after)).toBe(true);
                expect(Object.isFrozen(n.always)).toBe(true);
                expect(Object.isFrozen(n.tags)).toBe(true);
                for (const list of n.transitions.values()) {
                    expect(Object.isFrozen(list)).toBe(true);
                    for (const t of list) {
                        expect(Object.isFrozen(t)).toBe(true);
                        expect(Object.isFrozen(t.actions)).toBe(true);
                        if (t.target) expect(Object.isFrozen(t.target)).toBe(true);
                    }
                }
            }
        });
    });
});

describe("normalize — validation", () => {
    describe("config shape", () => {
        it.each([undefined, null, 42, "x", [], new Map()])("rejects a non-object config (%s)", (config) => {
            expectConfigError(config, "", "machine config must be a plain object");
        });
    });

    describe("unsupported keys", () => {
        it.each([
            "invoke",
            "services",
            "actors",
            "activities",
            "spawn",
            "emit",
            "input",
            "system",
            "version",
            "options",
            "strict",
            "predictableActionArguments",
            "preserveActionOrder",
            "schema",
            "tsTypes",
            "parallel",
            "cond",
            "internal",
            "in",
            "route",
        ])("rejects '%s' on the root", (key) => {
            expectConfigError({ initial: "a", states: { a: {} }, [key]: {} }, "", `'${key}' is not supported`);
        });

        it("rejects unsupported keys on nested nodes with the node path", () => {
            expectConfigError(
                { initial: "a", states: { a: { initial: "b", states: { b: { invoke: { src: "x" } } } } } },
                "states.a.states.b",
                "'invoke' is not supported",
            );
        });

        it("rejects `context`, `types` and `source` below the root", () => {
            expectConfigError(
                { initial: "a", states: { a: { context: {} } } },
                "states.a",
                "'context' is only allowed on the root state node",
            );
            expectConfigError(
                { initial: "a", states: { a: { types: {} } } },
                "states.a",
                "'types' is only allowed on the root state node",
            );
            expectConfigError(
                { initial: "a", states: { a: { source: "stateDiagram-v2" } } },
                "states.a",
                "'source' is only allowed on the root state node",
            );
        });

        it("keeps `source` (the verbatim .mmd text) on the root as an opaque string", () => {
            const source = "stateDiagram-v2\n    [*] --> a\n";
            const model = build({ initial: "a", source, states: { a: {} } });
            expect(model.config.source).toBe(source);
            expect(build({ initial: "a", states: { a: {} } }).config.source).toBeUndefined();
        });
    });

    describe("ids", () => {
        it.each([
            ["", "must be a non-empty string"],
            ["#x", "must not start with '#'"],
            ["a.b", "must not contain '.'"],
            [42, "must be a non-empty string"],
        ])("rejects the id %j", (id, detail) => {
            expectConfigError({ id, initial: "a", states: { a: {} } }, "", detail);
            expectConfigError({ initial: "a", states: { a: { id } } }, "states.a", detail);
        });

        it("rejects duplicate explicit ids naming the earlier node", () => {
            expectConfigError(
                { initial: "a", states: { a: { id: "dup" }, b: { id: "dup" } } },
                "states.b",
                "duplicate state node id 'dup' (already used by 'states.a')",
            );
        });

        it("rejects an explicit id equal to the machine id", () => {
            expectConfigError(
                { id: "m", initial: "a", states: { a: { id: "m" } } },
                "states.a",
                "duplicate state node id 'm' (already used by the root)",
            );
        });
    });

    describe("state node types", () => {
        it("rejects an unknown `type`", () => {
            expectConfigError({ initial: "a", states: { a: { type: "nested" } } }, "states.a", "'type' must be one of");
        });

        it("rejects a root without child states", () => {
            expectConfigError({}, "", "the root state node must declare at least one child state");
            expectConfigError({ states: {} }, "", "the root state node must declare at least one child state");
        });

        it.each(["atomic", "final", "history"])("rejects an explicit root type '%s'", (type) => {
            expectConfigError(
                { type, initial: "a", states: { a: {} } },
                "",
                `root state node type '${type}' is not supported`,
            );
        });

        it("requires `initial` on compound nodes with the XState message", () => {
            expectConfigError(
                { initial: "a", states: { a: { states: { first: {}, second: {} } } } },
                "states.a",
                'No initial state specified for compound state node "#(machine).a". Try adding { initial: "first" } to the state config.',
            );
            expectConfigError(
                { states: { a: {} } },
                "",
                'No initial state specified for compound state node "#(machine)"',
            );
        });

        it("rejects `initial` naming a missing or a history child, or not being a string", () => {
            expectConfigError(
                { initial: "zzz", states: { a: {} } },
                "",
                'Initial state node "zzz" not found on parent state node #(machine)',
            );
            expectConfigError(
                { initial: "h", states: { a: {}, h: { type: "history" } } },
                "",
                "'initial' must name a regular child state, not the history state node \"h\"",
            );
            expectConfigError({ initial: 1, states: { a: {} } }, "", "'initial' must be a non-empty string");
            expectConfigError({ initial: "", states: { a: {} } }, "", "'initial' must be a non-empty string");
        });

        it("rejects an explicit compound / parallel node without children", () => {
            expectConfigError(
                { initial: "a", states: { a: { type: "compound" } } },
                "states.a",
                "a compound state node must declare at least one child",
            );
            expectConfigError(
                { initial: "a", states: { a: { type: "parallel", states: {} } } },
                "states.a",
                "a parallel state node must declare at least one region",
            );
        });

        it("rejects `initial` on parallel, atomic and final nodes", () => {
            expectConfigError(
                { type: "parallel", initial: "a", states: { a: {}, b: {} } },
                "",
                "'initial' is not allowed on parallel state nodes",
            );
            expectConfigError(
                { initial: "a", states: { a: { type: "atomic", initial: "x" } } },
                "states.a",
                "'initial' is not allowed on atomic state nodes",
            );
            expectConfigError(
                { initial: "a", states: { a: { type: "final", initial: "x" } } },
                "states.a",
                "'initial' is not allowed on final state nodes",
            );
        });

        it("rejects `states` on explicit atomic and final nodes", () => {
            expectConfigError(
                { initial: "a", states: { a: { type: "atomic", states: { x: {} } } } },
                "states.a",
                "'states' is not allowed on atomic state nodes",
            );
            expectConfigError(
                { initial: "a", states: { a: { type: "final", states: { x: {} } } } },
                "states.a",
                "'states' is not allowed on final state nodes",
            );
        });

        it.each(["states", "initial", "on", "always", "after", "entry", "exit", "tags"])(
            "rejects '%s' on history nodes",
            (key) => {
                expectConfigError(
                    {
                        initial: "a",
                        states: { a: {}, h: { type: "history", [key]: key === "states" ? { x: {} } : "x" } },
                    },
                    "states.h",
                    `'${key}' is not allowed on history state nodes`,
                );
            },
        );

        it("rejects `output` on history nodes and non-final nodes", () => {
            expectConfigError(
                { initial: "a", states: { a: {}, h: { type: "history", output: 1 } } },
                "states.h",
                "'output' is only allowed on final state nodes and the root",
            );
            expectConfigError(
                { initial: "a", states: { a: { output: 1 } } },
                "states.a",
                "'output' is only allowed on final state nodes and the root",
            );
        });

        it("rejects `history` on non-history nodes and invalid history kinds", () => {
            expectConfigError(
                { initial: "a", states: { a: { type: "atomic", history: true } } },
                "states.a",
                "'history' is only allowed on history state nodes",
            );
            expectConfigError(
                { initial: "a", states: { a: {}, h: { type: "history", history: "medium" } } },
                "states.h",
                '\'history\' must be "shallow", "deep" or true',
            );
        });

        it("rejects `target` on non-history nodes and non-string history targets", () => {
            expectConfigError(
                { initial: "a", states: { a: { target: "b" }, b: {} } },
                "states.a",
                "'target' is only allowed on history state nodes",
            );
            expectConfigError(
                { initial: "a", states: { a: {}, h: { type: "history", target: ["a"] } } },
                "states.h",
                "'target' must be a non-empty string",
            );
        });

        it("rejects an unresolvable history default target", () => {
            expectConfigError(
                { initial: "a", states: { a: {}, h: { type: "history", target: "nope" } } },
                "states.h.target",
                "Child state 'nope' does not exist on '(machine)'",
            );
        });

        it("rejects a history default target that is a history node (self-target)", () => {
            expectConfigError(
                { initial: "a", states: { a: {}, h: { type: "history", target: "h" } } },
                "states.h.target",
                "'target' of a history state node must be a regular state, not the history state node",
            );
        });

        it("rejects a history default target that is another history node (chain)", () => {
            // Even a non-cyclic chain is rejected: default targets must resolve directly.
            expectConfigError(
                {
                    initial: "a",
                    states: {
                        a: {},
                        h1: { type: "history", target: "h2" },
                        h2: { type: "history", target: "a" },
                    },
                },
                "states.h1.target",
                "'target' of a history state node must be a regular state, not the history state node",
            );
        });

        it("rejects mutually cyclic history default targets", () => {
            expectConfigError(
                {
                    initial: "a",
                    states: {
                        a: {},
                        h1: { type: "history", target: "h2" },
                        h2: { type: "history", target: "h1" },
                    },
                },
                "states.h1.target",
                "'target' of a history state node must be a regular state, not the history state node",
            );
        });

        it("still accepts a history node with a regular default target, targeted by a transition", () => {
            const model = build({
                id: "m",
                initial: "a",
                states: {
                    a: { on: { GO: "#m.p.h" } },
                    p: {
                        initial: "x",
                        states: {
                            x: {},
                            y: {},
                            h: { type: "history", target: "y" },
                        },
                    },
                },
            });
            expect(node(model, "m.p.h").historyTarget!.map((t) => t.id)).toEqual(["m.p.y"]);
            expect(targetIds(transitions(model, "m.a", "GO")[0]!)).toEqual(["m.p.h"]);
        });

        it("rejects `onDone` on the root and on atomic / final nodes", () => {
            expectConfigError(
                { initial: "a", onDone: { actions: "x" }, states: { a: { type: "final" } } },
                "",
                "'onDone' is not allowed on the root state node",
            );
            expectConfigError(
                { initial: "a", states: { a: { onDone: "b" }, b: {} } },
                "states.a",
                "'onDone' is only allowed on compound and parallel state nodes (this node is 'atomic')",
            );
            expectConfigError(
                { initial: "a", states: { a: { type: "final", onDone: "b" }, b: {} } },
                "states.a",
                "'onDone' is only allowed on compound and parallel state nodes (this node is 'final')",
            );
        });

        it("rejects `always` and `after` on... nothing: they are transitions and stay allowed on final nodes", () => {
            expect(() =>
                build({
                    initial: "p",
                    states: { p: { initial: "f", states: { f: { type: "final", after: { 1: "f" }, always: [] } } } },
                }),
            ).not.toThrow();
        });
    });

    describe("`states` keys and values", () => {
        it("rejects empty keys, keys with '.', non-object children and a non-object `states`", () => {
            expectConfigError(
                { initial: "a", states: { a: {}, "": {} } },
                "states",
                "state keys must be non-empty strings",
            );
            expectConfigError(
                { initial: "a", states: { "a.b": {} } },
                "states",
                "state key 'a.b' must not contain '.'",
            );
            expectConfigError(
                { initial: "a", states: { a: "atomic" } },
                "states.a",
                "state node config must be a plain object",
            );
            expectConfigError({ initial: "a", states: [] }, "states", "'states' must be a plain object");
        });
    });

    describe("scalar node keys", () => {
        it("validates tags, description, meta, context and types", () => {
            expectConfigError({ initial: "a", states: { a: { tags: [1] } } }, "states.a", "'tags[0]' must be a string");
            expectConfigError({ initial: "a", states: { a: { tags: 1 } } }, "states.a", "'tags[0]' must be a string");
            expectConfigError(
                { initial: "a", states: { a: { description: 1 } } },
                "states.a",
                "'description' must be a string",
            );
            expectConfigError(
                { initial: "a", states: { a: { meta: [] } } },
                "states.a",
                "'meta' must be a plain object",
            );
            expectConfigError(
                { initial: "a", context: [], states: { a: {} } },
                "",
                "'context' must be a plain object or a factory",
            );
            expectConfigError(
                { initial: "a", context: null, states: { a: {} } },
                "",
                "'context' must be a plain object or a factory",
            );
            expectConfigError(
                { initial: "a", types: "x", states: { a: {} } },
                "types",
                "'types' must be a plain object",
            );
            expectConfigError(
                { initial: "a", source: 42, states: { a: {} } },
                "",
                "'source' must be a string (got number)",
            );
            expectConfigError(
                { initial: "a", source: null, states: { a: {} } },
                "",
                "'source' must be a string (got null)",
            );
        });
    });

    describe("event descriptors", () => {
        it("rejects the null event key with the XState message", () => {
            expectConfigError(
                { initial: "a", states: { a: { on: { "": "b" } }, b: {} } },
                "states.a.on",
                'Null events ("") cannot be specified as a transition key. Use always: { ... } instead.',
            );
        });

        it.each(["a.*.b", "a*", "*a", "*.a", "a.**"])("rejects the wildcard descriptor '%s'", (descriptor) => {
            expectConfigError(
                { initial: "a", states: { a: { on: { [descriptor]: "b" } }, b: {} } },
                "states.a.on",
                `invalid event descriptor '${descriptor}'`,
            );
        });

        it("rejects a non-object `on`", () => {
            expectConfigError(
                { initial: "a", states: { a: { on: ["b"] }, b: {} } },
                "states.a.on",
                "'on' must be a plain object",
            );
        });
    });

    describe("transition shapes", () => {
        it("rejects unknown transition values and array items", () => {
            expectConfigError(
                { initial: "a", states: { a: { on: { E: 42 } } } },
                "states.a.on.E",
                "unknown transition shape (got number)",
            );
            expectConfigError(
                { initial: "a", states: { a: { on: { E: [{ actions: "x" }, null] } } } },
                "states.a.on.E[1]",
                "unknown transition shape (got null)",
            );
        });

        it("rejects v4 keys with hints and other unknown keys", () => {
            const base = (transition: Record<string, unknown>) => ({
                initial: "a",
                states: { a: { on: { E: { target: "b", ...transition } } }, b: {} },
            });
            expectConfigError(base({ cond: "x" }), "states.a.on.E[0]", "'cond' has been renamed to 'guard'");
            expectConfigError(
                base({ internal: true }),
                "states.a.on.E[0]",
                "'internal' is not supported, use reenter: false",
            );
            expectConfigError(base({ in: "x" }), "states.a.on.E[0]", "'in' is not supported, use the stateIn() guard");
            expectConfigError(base({ invoke: {} }), "states.a.on.E[0]", "'invoke' is not supported");
        });

        it("validates reenter, description and meta", () => {
            expectConfigError(
                { initial: "a", states: { a: { on: { E: { target: "b", reenter: 1 } } }, b: {} } },
                "states.a.on.E[0]",
                "'reenter' must be a boolean",
            );
            expectConfigError(
                { initial: "a", states: { a: { on: { E: { description: 1 } } } } },
                "states.a.on.E[0]",
                "'description' must be a string",
            );
            expectConfigError(
                { initial: "a", states: { a: { on: { E: { meta: "x" } } } } },
                "states.a.on.E[0]",
                "'meta' must be a plain object",
            );
        });

        it("rejects string items and undefined values in `after` / `onDone`", () => {
            expectConfigError(
                { initial: "a", states: { a: { after: { 100: ["b"] } }, b: {} } },
                "states.a.after.100[0]",
                "'after' arrays must contain transition objects (got string)",
            );
            expectConfigError(
                { initial: "a", states: { a: { after: { 100: undefined } } } },
                "states.a.after.100",
                "'after' transition must be a target string, an object or an array of objects",
            );
            expectConfigError(
                {
                    initial: "p",
                    states: { p: { initial: "f", states: { f: { type: "final" } }, onDone: ["q"] }, q: {} },
                },
                "states.p.onDone[0]",
                "'onDone' arrays must contain transition objects",
            );
        });

        it("validates `after` keys and the `after` object", () => {
            expectConfigError(
                { initial: "a", states: { a: { after: [] } } },
                "states.a.after",
                "'after' must be a plain object",
            );
            expectConfigError(
                { initial: "a", states: { a: { after: { "": "a" } } } },
                "states.a.after",
                "delay keys must be non-empty",
            );
            expectConfigError(
                { initial: "a", states: { a: { after: { "-5": "a" } } } },
                "states.a.after.-5",
                "numeric delay must be a non-negative finite number",
            );
            expectConfigError(
                { initial: "a", states: { a: { after: { Infinity: "a" } } } },
                "states.a.after.Infinity",
                "numeric delay must be a non-negative finite number",
            );
        });
    });

    describe("targets", () => {
        const withTarget = (target: unknown, extra: Record<string, unknown> = {}) => ({
            id: "m",
            initial: "a",
            states: { a: { on: { E: { target } } }, b: {}, ...extra },
        });

        it("rejects invalid target values", () => {
            expectConfigError(withTarget(42), "states.a.on.E[0]", "'target' must be a string or an array of strings");
            expectConfigError(withTarget([]), "states.a.on.E[0]", "'target' array must not be empty");
            expectConfigError(withTarget(["b", ""]), "states.a.on.E[0]", "'target[1]' must be a non-empty string");
            expectConfigError(withTarget(["b", 1]), "states.a.on.E[0]", "'target[1]' must be a non-empty string");
        });

        it("rejects unknown siblings, paths and ids with the XState messages", () => {
            expectConfigError(withTarget("nope"), "states.a.on.E[0]", "Child state 'nope' does not exist on 'm'");
            expectConfigError(withTarget("b.nope"), "states.a.on.E[0]", "Child state 'nope' does not exist on 'm.b'");
            expectConfigError(withTarget(".nope"), "states.a.on.E[0]", "Child state 'nope' does not exist on 'm.a'");
            expectConfigError(
                withTarget("#nope"),
                "states.a.on.E[0]",
                "Child state node '#nope' does not exist on machine 'm'",
            );
            expectConfigError(withTarget("#m.nope"), "states.a.on.E[0]", "Child state 'nope' does not exist on 'm'");
        });

        it("rejects sibling-style targets from the root with the XState hint", () => {
            expectConfigError(
                { id: "m", initial: "a", on: { RESET: "a" }, states: { a: {} } },
                "on.RESET[0]",
                'Invalid target: "a" is not a valid target from the root node. Did you mean ".a"?',
            );
        });

        it("rejects multiple targets that are not in different regions of one parallel state", () => {
            const parallel = {
                id: "m",
                initial: "idle",
                states: {
                    idle: {},
                    p: {
                        id: "p",
                        type: "parallel",
                        states: {
                            r1: { initial: "a", states: { a: {}, b: {} } },
                            r2: { initial: "c", states: { c: {}, d: {} } },
                        },
                    },
                    q: { initial: "x", states: { x: {}, y: {} } },
                },
            };
            const withTargets = (target: string[]) => ({
                ...parallel,
                states: { ...parallel.states, idle: { on: { GO: { target } } } },
            });
            const detail = "multiple targets must lie in different regions of one parallel state";
            // same region
            expectConfigError(
                withTargets(["#p.r1.a", "#p.r1.b"]),
                "states.idle.on.GO[0]",
                `${detail} ('#m.p.r1.a' and '#m.p.r1.b' do not)`,
            );
            // compound LCA
            expectConfigError(withTargets(["#m.q.x", "#m.q.y"]), "states.idle.on.GO[0]", detail);
            // one is an ancestor of the other
            expectConfigError(withTargets(["#p", "#p.r1.a"]), "states.idle.on.GO[0]", detail);
            expectConfigError(withTargets(["#p.r1.a", "#p"]), "states.idle.on.GO[0]", detail);
            // the same node twice
            expectConfigError(withTargets(["#p.r1.a", "#p.r1.a"]), "states.idle.on.GO[0]", detail);
            // unrelated top-level siblings
            expectConfigError(withTargets(["#p.r1.a", "#m.q"]), "states.idle.on.GO[0]", detail);
            // three targets, two of which collide
            expectConfigError(withTargets(["#p.r1.a", "#p.r2.c", "#p.r2.d"]), "states.idle.on.GO[0]", detail);
        });
    });

    describe("actions", () => {
        const withAction = (action: unknown) => ({ initial: "a", states: { a: { entry: action } } });

        it("rejects empty names, malformed reference objects and unknown shapes", () => {
            expectConfigError(withAction(""), "states.a.entry[0]", "action name must be a non-empty string");
            expectConfigError(
                withAction({}),
                "states.a.entry[0]",
                "action 'type' must be a non-empty string (got undefined)",
            );
            expectConfigError(
                withAction({ type: "" }),
                "states.a.entry[0]",
                "action 'type' must be a non-empty string",
            );
            expectConfigError(
                withAction({ type: "x", extra: 1 }),
                "states.a.entry[0]",
                "'extra' is not supported in an action object",
            );
            expectConfigError(withAction(42), "states.a.entry[0]", "unknown action shape (got number)");
            expectConfigError(withAction([null]), "states.a.entry[0]", "unknown action shape (got null)");
            expectConfigError(withAction(["ok", 42]), "states.a.entry[1]", "unknown action shape (got number)");
        });

        it("rejects hand-written builtin objects", () => {
            expectConfigError(
                withAction({ type: "xstate.assign", params: {} }),
                "states.a.entry[0]",
                "'xstate.assign' looks like a builtin action written as a plain object",
            );
        });

        it("rejects guard builtins in action positions", () => {
            expectConfigError(
                withAction(and(["g"])),
                "states.a.entry[0]",
                "'xstate.and' is a guard builtin and cannot be used as an action",
            );
            expectConfigError(withAction(stateIn("a")), "states.a.entry[0]", "'xstate.stateIn' is a guard builtin");
        });

        it("rejects unknown builtin brands", () => {
            expectConfigError(
                withAction(malformedBuiltin("emit", "xstate.emit", {})),
                "states.a.entry[0]",
                "unknown builtin 'xstate.emit'",
            );
        });

        it("validates the payload of assign / mutate / raise / cancel / log", () => {
            expectConfigError(
                withAction(malformedBuiltin("assign", "xstate.assign", { assignment: 42 })),
                "states.a.entry[0]",
                "assign() expects a partial object or a function",
            );
            expectConfigError(
                withAction(malformedBuiltin("mutate", "rx-toolkit.mutate", { recipe: { x: 1 } })),
                "states.a.entry[0]",
                "mutate() expects a recipe function (got object)",
            );
            expectConfigError(
                withAction(malformedBuiltin("raise", "xstate.raise", { event: "E" })),
                "states.a.entry[0]",
                "raise() expects an event object with a non-empty string 'type' or a function",
            );
            expectConfigError(
                withAction(malformedBuiltin("raise", "xstate.raise", { event: {} })),
                "states.a.entry[0]",
                "raise() expects an event object",
            );
            expectConfigError(
                withAction(raise({ type: "*" })),
                "states.a.entry[0]",
                "raise() cannot raise an event of the wildcard type",
            );
            expectConfigError(
                withAction(raise({ type: "E" }, { delay: -1 })),
                "states.a.entry[0]",
                "delay must be a non-negative finite number (got -1)",
            );
            expectConfigError(
                withAction(raise({ type: "E" }, { delay: Number.NaN })),
                "states.a.entry[0]",
                "delay must be a non-negative finite number",
            );
            expectConfigError(
                withAction(raise({ type: "E" }, { delay: "" })),
                "states.a.entry[0]",
                "named delay must be a non-empty string",
            );
            expectConfigError(
                withAction(malformedBuiltin("raise", "xstate.raise", { event: { type: "E" }, delay: true })),
                "states.a.entry[0]",
                "delay must be a number, a named delay or a function (got boolean)",
            );
            expectConfigError(
                withAction(raise({ type: "E" }, { id: "" })),
                "states.a.entry[0]",
                "raise() 'id' must be a non-empty string",
            );
            expectConfigError(
                withAction(malformedBuiltin("raise", "xstate.raise", { event: { type: "E" }, id: 1 })),
                "states.a.entry[0]",
                "raise() 'id' must be a non-empty string (got number)",
            );
            expectConfigError(
                withAction(cancel("")),
                "states.a.entry[0]",
                "cancel() expects a non-empty string id or a function",
            );
            expectConfigError(
                withAction(malformedBuiltin("log", "xstate.log", { value: 1, label: 1 })),
                "states.a.entry[0]",
                "log() label must be a string (got number)",
            );
        });

        it("accepts every valid action shape, including builtins with expressions", () => {
            expect(() =>
                build({
                    initial: "a",
                    states: {
                        a: {
                            entry: [
                                "name",
                                { type: "ref" },
                                { type: "ref", params: () => ({}) },
                                () => undefined,
                                assign({ x: 1 }),
                                assign(() => ({})),
                                mutate(() => undefined),
                                raise({ type: "E" }),
                                raise(() => ({ type: "E" }), { delay: () => 1, id: "x" }),
                                raise({ type: "E" }, { delay: "NAMED" }),
                                raise({ type: "E" }, { delay: 0 }),
                                cancel("x"),
                                cancel(() => "x"),
                                log(),
                                log("v", "label"),
                                log(() => 1),
                            ],
                        },
                    },
                }),
            ).not.toThrow();
        });

        it("reports the path of transition actions", () => {
            expectConfigError(
                { initial: "a", states: { a: { on: { E: { actions: ["ok", 1] } } } } },
                "states.a.on.E[0].actions[1]",
                "unknown action shape",
            );
        });
    });

    describe("guards", () => {
        const withGuard = (guard: unknown) => ({ initial: "a", states: { a: { on: { E: { guard } } } } });

        it("rejects empty names, malformed reference objects and unknown shapes", () => {
            expectConfigError(withGuard(""), "states.a.on.E[0].guard", "guard name must be a non-empty string");
            expectConfigError(withGuard({}), "states.a.on.E[0].guard", "guard 'type' must be a non-empty string");
            expectConfigError(
                withGuard({ type: "x", cond: 1 }),
                "states.a.on.E[0].guard",
                "'cond' is not supported in a guard object",
            );
            expectConfigError(withGuard(42), "states.a.on.E[0].guard", "unknown guard shape (got number)");
            expectConfigError(withGuard(null), "states.a.on.E[0].guard", "unknown guard shape (got null)");
            expectConfigError(withGuard([]), "states.a.on.E[0].guard", "unknown guard shape (got an array)");
        });

        it("rejects hand-written builtin objects and action builtins in guard positions", () => {
            expectConfigError(
                withGuard({ type: "xstate.and" }),
                "states.a.on.E[0].guard",
                "'xstate.and' looks like a builtin guard written as a plain object",
            );
            expectConfigError(
                withGuard(assign({})),
                "states.a.on.E[0].guard",
                "'xstate.assign' is an action builtin and cannot be used as a guard",
            );
            expectConfigError(
                withGuard(mutate(() => undefined)),
                "states.a.on.E[0].guard",
                "'rx-toolkit.mutate' is an action builtin and cannot be used as a guard",
            );
            expectConfigError(
                withGuard(malformedBuiltin("emit", "xstate.emit", {})),
                "states.a.on.E[0].guard",
                "unknown builtin 'xstate.emit'",
            );
        });

        it("validates nested guards of and / or / not with nested paths", () => {
            expectConfigError(
                withGuard(and(["ok", 42 as never])),
                "states.a.on.E[0].guard.guards[1]",
                "unknown guard shape (got number)",
            );
            expectConfigError(
                withGuard(or([not("" as never)])),
                "states.a.on.E[0].guard.guards[0].guard",
                "guard name must be a non-empty string",
            );
            expectConfigError(
                withGuard(malformedBuiltin("and", "xstate.and", { guards: "x" })),
                "states.a.on.E[0].guard",
                "and() expects an array of guards (got string)",
            );
        });

        it("validates stateIn values and resolves '#id' references", () => {
            expectConfigError(
                withGuard(stateIn("")),
                "states.a.on.E[0].guard",
                "stateIn() expects a non-empty state value",
            );
            expectConfigError(
                withGuard(stateIn(42 as never)),
                "states.a.on.E[0].guard",
                "stateIn() expects a state value string or object",
            );
            expectConfigError(
                withGuard(stateIn("#missing")),
                "states.a.on.E[0].guard",
                "Child state node '#missing' does not exist on machine '(machine)'",
            );
            expectConfigError(
                withGuard(stateIn("#(machine).nope")),
                "states.a.on.E[0].guard",
                "Child state 'nope' does not exist on '(machine)'",
            );
            expect(() => build(withGuard(stateIn("#(machine).a")))).not.toThrow();
            expect(() => build(withGuard(stateIn({ a: "x" })))).not.toThrow();
            expect(() => build(withGuard(stateIn("a")))).not.toThrow();
        });

        it("accepts every valid guard shape", () => {
            expect(() =>
                build(
                    withGuard(
                        and([
                            "name",
                            { type: "ref" },
                            { type: "ref", params: { x: 1 } },
                            () => true,
                            or([]),
                            not(stateIn("a")),
                        ]),
                    ),
                ),
            ).not.toThrow();
        });
    });
});

// XState's creators are plain functions (`fn.type = "xstate.*"` for actions,
// `fn.check` for guards) without our brand: accepted as inline functions they
// would run as silent no-ops, so they are rejected with a pointer at ours.
describe("normalize — creators imported from the xstate package are rejected", () => {
    const withAction = (action: unknown) => ({ initial: "a", states: { a: { entry: action } } });
    const withTransitionAction = (action: unknown) => ({
        initial: "a",
        states: { a: { on: { E: { actions: [action] } } } },
    });
    const withGuard = (guard: unknown) => ({ initial: "a", states: { a: { on: { E: { guard } } } } });

    const mirroredActions: [name: string, action: unknown, detail: string][] = [
        [
            "assign",
            xstateAssign({}),
            "'xstate.assign' was created by the xstate package; use the assign() creator exported by @fozy-labs/rx-toolkit instead",
        ],
        [
            "raise",
            xstateRaise({ type: "X" }),
            "'xstate.raise' was created by the xstate package; use the raise() creator",
        ],
        ["cancel", xstateCancel("id"), "'xstate.cancel' was created by the xstate package; use the cancel() creator"],
        ["log", xstateLog("hello"), "'xstate.log' was created by the xstate package; use the log() creator"],
    ];

    it.each(mirroredActions)(
        "rejects xstate's %s in entry and transition actions, pointing at ours",
        (_, action, detail) => {
            expectConfigError(withAction(action), "states.a.entry[0]", detail);
            expectConfigError(withTransitionAction(action), "states.a.on.E[0].actions[0]", detail);
        },
    );

    const unsupportedActions: [name: string, action: unknown, type: string][] = [
        ["sendTo", sendTo("child", { type: "X" }), "xstate.sendTo"],
        ["sendParent", sendParent({ type: "X" }), "xstate.sendTo"],
        ["forwardTo", forwardTo("child"), "xstate.sendTo"],
        ["enqueueActions", enqueueActions(() => undefined), "xstate.enqueueActions"],
        ["emit", emit({ type: "X" }), "xstate.emit"],
        ["spawnChild", spawnChild("child"), "xstate.spawnChild"],
        ["stopChild", stopChild("child"), "xstate.stopChild"],
    ];

    it.each(unsupportedActions)("rejects xstate's unsupported %s as an action", (_, action, type) => {
        expectConfigError(
            withAction(action),
            "states.a.entry[0]",
            `'${type}' is an XState builtin that is not supported (actors, emit and enqueueActions are out of scope)`,
        );
        expectConfigError(
            withTransitionAction(action),
            "states.a.on.E[0].actions[0]",
            `'${type}' is an XState builtin`,
        );
    });

    const guards: [name: string, guard: unknown, detail: string][] = [
        [
            "and",
            xstateAnd([() => true]),
            "'and' guard was created by the xstate package; use the and() creator exported by @fozy-labs/rx-toolkit instead",
        ],
        ["or", xstateOr([() => true]), "'or' guard was created by the xstate package; use the or() creator"],
        ["not", xstateNot(() => true), "'not' guard was created by the xstate package; use the not() creator"],
        ["stateIn", xstateStateIn("a"), "'stateIn' guard was created by the xstate package; use the stateIn() creator"],
    ];

    it.each(guards)("rejects xstate's %s guard, also nested inside our and(), pointing at ours", (_, guard, detail) => {
        expectConfigError(withGuard(guard), "states.a.on.E[0].guard", detail);
        expectConfigError(withGuard(and([guard as never])), "states.a.on.E[0].guard.guards[0]", detail);
    });

    it("rejects xstate creators in the wrong slot as well (action as guard, guard as action)", () => {
        expectConfigError(
            withGuard(xstateAssign({})),
            "states.a.on.E[0].guard",
            "'xstate.assign' was created by the xstate package",
        );
        expectConfigError(
            withAction(xstateAnd([() => true])),
            "states.a.entry[0]",
            "'and' guard was created by the xstate package",
        );
    });

    it("still accepts plain inline functions and our own creators", () => {
        expect(() =>
            build({
                initial: "a",
                states: {
                    a: {
                        entry: [() => undefined, assign({}), raise({ type: "X" }), cancel("x"), log("l")],
                        on: { E: { guard: and([() => true, or([not("g"), stateIn("a")])]) } },
                    },
                },
            }),
        ).not.toThrow();
    });
});

describe("normalize — reserved xstate event descriptors", () => {
    const withOn = (descriptor: string) => ({
        initial: "a",
        states: { a: { on: { [descriptor]: { actions: () => undefined } } } },
    });

    it.each(["xstate.init", "xstate.stop"])("rejects '%s': no transition is ever selected for it", (descriptor) => {
        expectConfigError(
            withOn(descriptor),
            "states.a.on",
            `'${descriptor}' is a reserved XState system event: no transition is ever selected for it, so the handler could never fire`,
        );
    });

    it.each([
        "xstate.error.actor.child",
        "xstate.error.*",
        "xstate.done.actor.child",
        "xstate.done.actor.*",
        "xstate.snapshot.child",
        "xstate.promise.resolve",
    ])("rejects the actor-system descriptor '%s'", (descriptor) => {
        expectConfigError(
            withOn(descriptor),
            "states.a.on",
            `'${descriptor}' is a reserved XState actor-system event; actors/invoke are not supported, so the handler could never fire`,
        );
    });

    it("rejects them on the root as well", () => {
        expectConfigError(
            { initial: "a", on: { "xstate.done.actor.x": { actions: () => undefined } }, states: { a: {} } },
            "on",
            "'xstate.done.actor.x' is a reserved XState actor-system event",
        );
    });

    it("keeps the descriptors that do fire (XState parity): xstate.* wildcards, the done-state and after families", () => {
        const model = build({
            id: "m",
            initial: "a",
            on: {
                "xstate.*": { actions: () => undefined },
                "xstate.after.*": { actions: () => undefined },
                "xstate.done.state.*": { actions: () => undefined },
                "xstate.done.*": { actions: () => undefined },
            },
            states: {
                a: { on: { "xstate.done.state.m.p": "b", "xstate.after.100.m.a": "b" } },
                b: {},
                p: { initial: "x", states: { x: {} } },
            },
        });
        expect([...model.root.transitions.keys()]).toEqual([
            "xstate.*",
            "xstate.after.*",
            "xstate.done.state.*",
            "xstate.done.*",
        ]);
        expect(transitions(model, "m.a", "xstate.done.state.m.p")).toHaveLength(1);
        expect(transitions(model, "m.a", "xstate.after.100.m.a")).toHaveLength(1);
    });
});

describe("normalize — purity with respect to the config", () => {
    it("neither mutates nor freezes the caller's config (createMachine freezes after validation)", () => {
        const config = {
            id: "m",
            initial: "a",
            states: {
                a: { entry: ["x"], on: { GO: [{ target: "b", actions: ["y", assign({})] }] } },
                b: { after: { 100: { target: "a", actions: "z" } } },
            },
        };
        const snapshot = JSON.stringify(config);
        normalize(config as MachineConfig<MachineContext, AnyEventObject>);
        expect(JSON.stringify(config)).toBe(snapshot);
        expect(Object.isFrozen(config)).toBe(false);
        expect(Object.isFrozen(config.states.a.entry)).toBe(false);
        expect(Object.isFrozen(config.states.a.on.GO)).toBe(false);
        expect(Object.isFrozen(config.states.a.on.GO[0].actions)).toBe(false);
        expect(Object.isFrozen(config.states.b.after[100])).toBe(false);
    });
});
