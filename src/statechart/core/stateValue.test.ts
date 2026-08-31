import { unstable_createMachine as createMachine } from "../createMachine";
import { getMachineModel } from "../MachineDefinition";
import type { AnyEventObject, MachineContext } from "../types";

import { MachineConfigError } from "./MachineConfigError";
import type { MachineModel, StateNode } from "./model";
import {
    collectTags,
    getStateNodeById,
    getStateNodeByPath,
    getStateValue,
    matchesState,
    pathToStateValue,
    toStatePath,
} from "./stateValue";

type AnyModel = MachineModel<MachineContext, AnyEventObject>;
type AnyNode = StateNode<MachineContext, AnyEventObject>;

const model: AnyModel = getMachineModel(
    createMachine({
        id: "m",
        initial: "a",
        tags: ["root", "shared"],
        states: {
            a: { tags: "shared", on: { GO: "b" } },
            b: {
                initial: "b1",
                tags: ["b"],
                states: {
                    b1: {},
                    b2: { initial: "b21", states: { b21: {}, b22: {} } },
                    bh: { type: "history" },
                },
            },
            p: {
                type: "parallel",
                states: {
                    x: { initial: "x1", states: { x1: {}, x2: { tags: "x2" } } },
                    y: {},
                    z: { type: "final" },
                },
            },
        },
    }),
);

function node(id: string): AnyNode {
    const found = model.idMap.get(id);
    if (found === undefined) throw new Error(`test: node '${id}' not found`);
    return found;
}

/** A configuration from node ids, in the given (insertion) order. */
function configuration(...ids: string[]): ReadonlySet<AnyNode> {
    return new Set(ids.map(node));
}

describe("toStatePath", () => {
    it("splits on dots", () => {
        expect(toStatePath("a")).toEqual(["a"]);
        expect(toStatePath("a.b.c")).toEqual(["a", "b", "c"]);
        expect(toStatePath("#m.a")).toEqual(["#m", "a"]);
    });

    it("keeps empty segments (leading / trailing / double dots)", () => {
        expect(toStatePath(".a")).toEqual(["", "a"]);
        expect(toStatePath("a.")).toEqual(["a", ""]);
        expect(toStatePath("a..b")).toEqual(["a", "", "b"]);
        expect(toStatePath("")).toEqual([""]);
    });

    it("treats a backslash as an escape for the next character", () => {
        expect(toStatePath("a\\.b.c")).toEqual(["a.b", "c"]);
        expect(toStatePath("a\\\\b")).toEqual(["a\\b"]);
        expect(toStatePath("a\\")).toEqual(["a"]);
    });
});

describe("pathToStateValue", () => {
    it("keeps a single segment as a string", () => {
        expect(pathToStateValue(["a"])).toBe("a");
    });

    it("nests the segments, the last one as a string", () => {
        expect(pathToStateValue(["a", "b"])).toEqual({ a: "b" });
        expect(pathToStateValue(["a", "b", "c"])).toEqual({ a: { b: "c" } });
        expect(pathToStateValue(["a", "b", "c", "d"])).toEqual({ a: { b: { c: "d" } } });
    });

    it("returns an empty object for an empty path", () => {
        expect(pathToStateValue([])).toEqual({});
    });
});

describe("matchesState", () => {
    it("compares atomic values as strings", () => {
        expect(matchesState("a", "a")).toBe(true);
        expect(matchesState("a", "b")).toBe(false);
    });

    it("expands a string parent into a path", () => {
        expect(matchesState("b", { b: "b1" })).toBe(true);
        expect(matchesState("b.b1", { b: "b1" })).toBe(true);
        expect(matchesState("b.b2", { b: "b1" })).toBe(false);
        expect(matchesState("b.b2", { b: { b2: "b21" } })).toBe(true);
        expect(matchesState("b.b2.b21", { b: { b2: "b21" } })).toBe(true);
        expect(matchesState("b.b2.b22", { b: { b2: "b21" } })).toBe(false);
    });

    it("treats an object parent as a partial prefix of the child", () => {
        expect(matchesState({ b: "b1" }, { b: "b1" })).toBe(true);
        expect(matchesState({ b: { b2: "b21" } }, { b: { b2: "b21" } })).toBe(true);
        expect(matchesState({ b: "b2" }, { b: { b2: "b21" } })).toBe(true);
        expect(matchesState({ b: {} }, { b: { b2: "b21" } })).toBe(true);
        expect(matchesState({ b: { b2: "b22" } }, { b: { b2: "b21" } })).toBe(false);
    });

    it("never matches a parent more specific than the child", () => {
        expect(matchesState({ a: "x" }, "a")).toBe(false);
        expect(matchesState("a.x", "a")).toBe(false);
        expect(matchesState({ b: { b2: "b21" } }, { b: "b1" })).toBe(false);
    });

    it("matches every key of a parallel parent", () => {
        const parallel = { p: { x: "x1", y: {}, z: {} } };
        expect(matchesState({ p: { x: "x1" } }, parallel)).toBe(true);
        expect(matchesState({ p: { x: "x1", y: {} } }, parallel)).toBe(true);
        expect(matchesState({ p: { x: "x2" } }, parallel)).toBe(false);
        expect(matchesState({ p: { w: {} } }, parallel)).toBe(false);
        expect(matchesState("p.x.x1", parallel)).toBe(true);
    });

    it("rejects undefined values inside a parent object", () => {
        expect(matchesState({ b: undefined }, { b: "b1" })).toBe(false);
    });
});

describe("getStateValue", () => {
    it("renders a compound node with an atomic child as the child's key", () => {
        expect(getStateValue(model, configuration("m", "m.a"))).toBe("a");
        expect(getStateValue(model, configuration("m", "m.b", "m.b.b1"))).toEqual({ b: "b1" });
    });

    it("nests non-atomic children", () => {
        expect(getStateValue(model, configuration("m", "m.b", "m.b.b2", "m.b.b2.b21"))).toEqual({
            b: { b2: "b21" },
        });
    });

    it("renders every parallel region; atomic and final regions become {}", () => {
        expect(getStateValue(model, configuration("m", "m.p", "m.p.x", "m.p.x.x2", "m.p.y", "m.p.z"))).toEqual({
            p: { x: "x2", y: {}, z: {} },
        });
    });

    it("orders parallel regions by the configuration's insertion order (XState)", () => {
        const value = getStateValue(model, configuration("m", "m.p", "m.p.y", "m.p.z", "m.p.x", "m.p.x.x1"));
        expect(Object.keys((value as { p: object }).p)).toEqual(["y", "z", "x"]);
    });

    it("completes a partial configuration with initial states (XState getAllStateNodes)", () => {
        expect(getStateValue(model, configuration("m"))).toBe("a");
        expect(getStateValue(model, configuration("m", "m.b"))).toEqual({ b: "b1" });
        expect(getStateValue(model, configuration("m", "m.p"))).toEqual({ p: { x: "x1", y: {}, z: {} } });
        expect(getStateValue(model, configuration("m.b.b2.b22"))).toEqual({ b: { b2: "b22" } });
    });

    it("returns deeply frozen objects", () => {
        const value = getStateValue(model, configuration("m", "m.b", "m.b.b2", "m.b.b2.b21")) as {
            b: { b2: string };
        };
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.b)).toBe(true);
    });
});

describe("getStateNodeById", () => {
    it("resolves '#id' and bare ids", () => {
        expect(getStateNodeById(model, "#m.b")).toBe(node("m.b"));
        expect(getStateNodeById(model, "m.b")).toBe(node("m.b"));
        expect(getStateNodeById(model, "#m")).toBe(model.root);
    });

    it("walks child keys after the id", () => {
        // `m.b` is an id; the remaining segments are child keys of that node.
        const custom = getMachineModel(
            createMachine({ id: "c", initial: "a", states: { a: { id: "A", initial: "x", states: { x: {} } } } }),
        );
        expect(getStateNodeById(custom, "#A.x").id).toBe("c.a.x");
    });

    it("throws XState's message as a MachineConfigError for unknown ids and children", () => {
        expect(() => getStateNodeById(model, "#nope")).toThrow(
            new MachineConfigError("", "Child state node '#nope' does not exist on machine 'm'"),
        );
        expect(() => getStateNodeById(model, "#m.b.zzz")).toThrow(
            new MachineConfigError("", "Child state 'zzz' does not exist on 'm.b'"),
        );
    });
});

describe("getStateNodeByPath", () => {
    it("walks string or array paths from the given node", () => {
        expect(getStateNodeByPath(model.root, "b.b2.b21")).toBe(node("m.b.b2.b21"));
        expect(getStateNodeByPath(model.root, ["b", "b2"])).toBe(node("m.b.b2"));
        expect(getStateNodeByPath(node("m.b"), "b1")).toBe(node("m.b.b1"));
    });

    it("stops at an empty segment ('.' resolves to the node itself)", () => {
        expect(getStateNodeByPath(node("m.b"), "")).toBe(node("m.b"));
        expect(getStateNodeByPath(model.root, "b..b1")).toBe(node("m.b"));
    });

    it("throws for an unknown child", () => {
        expect(() => getStateNodeByPath(model.root, "b.nope")).toThrow(
            new MachineConfigError("", "Child state 'nope' does not exist on 'm.b'"),
        );
    });
});

describe("collectTags", () => {
    it("collects tags in document order, deduplicated, regardless of set order", () => {
        expect(collectTags(configuration("m.p.x.x2", "m.p.x", "m.p", "m"))).toEqual(["root", "shared", "x2"]);
        expect(collectTags(configuration("m", "m.a"))).toEqual(["root", "shared"]);
        expect(collectTags(configuration("m", "m.b", "m.b.b1"))).toEqual(["root", "shared", "b"]);
    });

    it("returns a frozen array", () => {
        expect(Object.isFrozen(collectTags(configuration("m")))).toBe(true);
    });
});
