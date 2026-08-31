import { unstable_createMachine as createMachine } from "../createMachine";
import { getMachineModel } from "../MachineDefinition";
import type { AnyEventObject, MachineContext } from "../types";

import {
    areStateNodeCollectionsEqual,
    findLeastCommonAncestor,
    getAllStateNodes,
    getChildren,
    getHistoryNodes,
    getInitialChild,
    getInitialStateNodes,
    getInitialStateNodesWithTheirAncestors,
    getProperAncestors,
    hasIntersection,
    isAtomicStateNode,
    isDescendant,
    isInFinalState,
} from "./configuration";
import type { MachineModel, StateNode } from "./model";

type AnyModel = MachineModel<MachineContext, AnyEventObject>;
type AnyNode = StateNode<MachineContext, AnyEventObject>;

const model: AnyModel = getMachineModel(
    createMachine({
        id: "m",
        initial: "a",
        states: {
            a: {
                initial: "a1",
                states: { a1: {}, a2: { initial: "a21", states: { a21: {}, a22: {} } }, ah: { type: "history" } },
            },
            p: {
                type: "parallel",
                states: {
                    x: { initial: "x1", states: { x1: {}, xf: { type: "final" } } },
                    y: { initial: "y1", states: { y1: {}, yf: { type: "final" } } },
                    z: { type: "final" },
                },
            },
            f: { type: "final" },
        },
    }),
);

const n = (id: string): AnyNode => {
    const found = model.idMap.get(id);
    if (found === undefined) throw new Error(`test: node '${id}' not found`);
    return found;
};
const ids = (nodes: Iterable<AnyNode>): string[] => [...nodes].map((node) => node.id);

describe("configuration helpers", () => {
    it("isAtomicStateNode: atomic and final leaves only", () => {
        expect(isAtomicStateNode(n("m.a.a1"))).toBe(true);
        expect(isAtomicStateNode(n("m.f"))).toBe(true);
        expect(isAtomicStateNode(n("m.a"))).toBe(false);
        expect(isAtomicStateNode(n("m.p"))).toBe(false);
        expect(isAtomicStateNode(n("m.a.ah"))).toBe(false);
    });

    it("getChildren excludes history nodes; getHistoryNodes returns only them", () => {
        expect(ids(getChildren(n("m.a")))).toEqual(["m.a.a1", "m.a.a2"]);
        expect(ids(getHistoryNodes(n("m.a")))).toEqual(["m.a.ah"]);
        expect(getHistoryNodes(n("m.p"))).toEqual([]);
    });

    it("getProperAncestors: up to (excluding) the given node; null reaches the root", () => {
        expect(ids(getProperAncestors(n("m.a.a2.a21"), null))).toEqual(["m.a.a2", "m.a", "m"]);
        expect(ids(getProperAncestors(n("m.a.a2.a21"), n("m.a")))).toEqual(["m.a.a2"]);
        expect(getProperAncestors(n("m.a"), n("m.a"))).toEqual([]);
        expect(getProperAncestors(model.root, null)).toEqual([]);
        // an unrelated "toNode" is never reached: every ancestor up to the root is returned
        expect(ids(getProperAncestors(n("m.a.a1"), n("m.p")))).toEqual(["m.a", "m"]);
    });

    it("isDescendant is strict; null matches every node including the root", () => {
        expect(isDescendant(n("m.a.a2.a21"), n("m.a"))).toBe(true);
        expect(isDescendant(n("m.a.a2.a21"), model.root)).toBe(true);
        expect(isDescendant(n("m.a"), n("m.a"))).toBe(false);
        expect(isDescendant(n("m.a"), n("m.p"))).toBe(false);
        expect(isDescendant(model.root, model.root)).toBe(false);
        expect(isDescendant(model.root, null)).toBe(true);
        expect(isDescendant(n("m.a.a1"), null)).toBe(true);
    });

    it("findLeastCommonAncestor: closest common proper ancestor, null when the root is among the nodes", () => {
        expect(findLeastCommonAncestor([n("m.a.a1"), n("m.a.a2.a21")])).toBe(n("m.a"));
        expect(findLeastCommonAncestor([n("m.a.a1"), n("m.p.x.x1")])).toBe(model.root);
        expect(findLeastCommonAncestor([n("m.a.a2.a21"), n("m.a")])).toBe(model.root);
        expect(findLeastCommonAncestor([n("m.a.a1")])).toBe(n("m.a"));
        expect(findLeastCommonAncestor([n("m.a.a1"), model.root])).toBeNull();
        expect(findLeastCommonAncestor([model.root, n("m.a.a1")])).toBeNull();
        expect(findLeastCommonAncestor([])).toBeNull();
    });

    it("getInitialStateNodes follows initial / regions, node first, history excluded", () => {
        expect(ids(getInitialStateNodes(model.root))).toEqual(["m", "m.a", "m.a.a1"]);
        expect(ids(getInitialStateNodes(n("m.p")))).toEqual(["m.p", "m.p.x", "m.p.x.x1", "m.p.y", "m.p.y.y1", "m.p.z"]);
        expect(ids(getInitialStateNodes(n("m.f")))).toEqual(["m.f"]);
    });

    it("getInitialStateNodesWithTheirAncestors adds the ancestors below the node", () => {
        expect(ids(getInitialStateNodesWithTheirAncestors(n("m.a.a2")))).toEqual(["m.a.a2", "m.a.a2.a21"]);
        const fromRoot = getInitialStateNodesWithTheirAncestors(model.root);
        expect(ids(fromRoot)).toEqual(["m", "m.a", "m.a.a1"]);
    });

    it("getAllStateNodes completes partial sets and leaves complete ones unchanged", () => {
        expect(ids(getAllStateNodes([n("m.a.a2.a22")]))).toEqual(["m.a.a2.a22", "m.a.a2", "m.a", "m"]);
        expect(ids(getAllStateNodes([n("m.a.a2")]))).toEqual(["m.a.a2", "m.a.a2.a21", "m.a", "m"]);
        expect(ids(getAllStateNodes([n("m.p"), n("m.p.x"), n("m.p.x.xf")]))).toEqual([
            "m.p",
            "m.p.x",
            "m.p.x.xf",
            "m.p.y",
            "m.p.y.y1",
            "m.p.z",
            "m",
        ]);
        const complete = [model.root, n("m.a"), n("m.a.a1")];
        expect(ids(getAllStateNodes(complete))).toEqual(ids(complete));
    });

    it("isInFinalState: compound needs an active final child, parallel needs every region final", () => {
        const set = new Set([model.root, n("m.p"), n("m.p.x"), n("m.p.x.xf"), n("m.p.y"), n("m.p.y.y1"), n("m.p.z")]);
        expect(isInFinalState(set, n("m.p.x"))).toBe(true);
        expect(isInFinalState(set, n("m.p.y"))).toBe(false);
        expect(isInFinalState(set, n("m.p.z"))).toBe(true);
        expect(isInFinalState(set, n("m.p"))).toBe(false);
        set.delete(n("m.p.y.y1"));
        set.add(n("m.p.y.yf"));
        expect(isInFinalState(set, n("m.p"))).toBe(true);
        expect(isInFinalState(set, model.root)).toBe(false);
        expect(isInFinalState(new Set([model.root, n("m.f")]), model.root)).toBe(true);
        expect(isInFinalState(set, n("m.a.a1"))).toBe(false);
    });

    it("hasIntersection / areStateNodeCollectionsEqual", () => {
        expect(hasIntersection([1, 2], [3, 2])).toBe(true);
        expect(hasIntersection([1, 2], [3])).toBe(false);
        expect(hasIntersection([], [])).toBe(false);
        expect(areStateNodeCollectionsEqual(new Set([n("m"), n("m.a")]), new Set([n("m.a"), n("m")]))).toBe(true);
        expect(areStateNodeCollectionsEqual(new Set([n("m"), n("m.a")]), new Set([n("m"), n("m.p")]))).toBe(false);
        expect(areStateNodeCollectionsEqual(new Set([n("m")]), new Set([n("m"), n("m.a")]))).toBe(false);
    });

    it("getInitialChild returns the initial target and rejects non-compound nodes", () => {
        expect(getInitialChild(n("m.a"))).toBe(n("m.a.a1"));
        expect(() => getInitialChild(n("m.p"))).toThrow(
            "State node 'm.p' of type 'parallel' has no initial transition",
        );
    });
});
