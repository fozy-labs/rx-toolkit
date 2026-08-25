/**
 * Pure queries over the state node tree — ports of the XState `stateUtils`
 * helpers that do not depend on a transition or a history value
 * (`isAtomicStateNode`, `getChildren`, `getProperAncestors`, `isDescendant`,
 * `findLeastCommonAncestor`, `getInitialStateNodes`, `getAllStateNodes`,
 * `isInFinalState`, ...). No state, no side effects.
 *
 * One convention differs from XState (spec 3.4): "no node" is `null`, never
 * `undefined`. XState's root has `parent === undefined`, so
 * `isDescendant(node, undefined)` is true for every node and
 * `getProperAncestors(node, undefined)` reaches the root; our root has
 * `parent: null` and the helpers below reproduce exactly that behaviour for
 * `null`.
 */
import type { EventObject, MachineContext } from "../types";

import type { StateNode } from "./model";

/** XState `isAtomicStateNode`: leaves of the tree, i.e. `atomic` and `final` nodes. */
export function isAtomicStateNode<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): boolean {
    return node.type === "atomic" || node.type === "final";
}

export function isHistoryNode<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): boolean {
    return node.type === "history";
}

/** XState `getChildren`: children in document order, history nodes excluded. */
export function getChildren<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): StateNode<TContext, TEvent>[] {
    return node.children.filter((child) => child.type !== "history");
}

/** XState `getHistoryNodes`: the history children of a node, in document order. */
export function getHistoryNodes<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): StateNode<TContext, TEvent>[] {
    return node.children.filter((child) => child.type === "history");
}

/**
 * XState `getProperAncestors`: the ancestors of `node` from its parent up to,
 * but excluding, `toNode`. With `toNode === null` every ancestor up to and
 * including the root is returned; `toNode === node` yields `[]`.
 */
export function getProperAncestors<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    toNode: StateNode<TContext, TEvent> | null,
): StateNode<TContext, TEvent>[] {
    const ancestors: StateNode<TContext, TEvent>[] = [];
    if (toNode === node) return ancestors;
    let marker = node.parent;
    while (marker !== null && marker !== toNode) {
        ancestors.push(marker);
        marker = marker.parent;
    }
    return ancestors;
}

/**
 * XState `isDescendant`: strict descendant test (`isDescendant(a, a)` is
 * false). `ancestor === null` means "the virtual parent of the root", so it
 * matches every node including the root.
 */
export function isDescendant<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    ancestor: StateNode<TContext, TEvent> | null,
): boolean {
    let marker = node;
    while (marker.parent !== null && marker.parent !== ancestor) {
        marker = marker.parent;
    }
    return marker.parent === ancestor;
}

/**
 * XState `findLeastCommonAncestor`: the closest proper ancestor of the first
 * node that every other node descends from. `null` when there is none — which
 * happens when the root itself is among the nodes (the root descends from
 * nothing).
 */
export function findLeastCommonAncestor<TContext extends MachineContext, TEvent extends EventObject>(
    nodes: readonly StateNode<TContext, TEvent>[],
): StateNode<TContext, TEvent> | null {
    const [head, ...tail] = nodes;
    if (head === undefined) return null;
    for (const ancestor of getProperAncestors(head, null)) {
        if (tail.every((node) => isDescendant(node, ancestor))) return ancestor;
    }
    return null;
}

/**
 * XState `getInitialStateNodes`: `node` itself plus the nodes reached by
 * following `initial` through compound nodes and every region of parallel
 * nodes. Insertion order = visiting order (node before its descendants).
 */
export function getInitialStateNodes<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): Set<StateNode<TContext, TEvent>> {
    const result = new Set<StateNode<TContext, TEvent>>();
    const visit = (current: StateNode<TContext, TEvent>): void => {
        if (result.has(current)) return;
        result.add(current);
        if (current.type === "compound") {
            visit(getInitialChild(current));
        } else if (current.type === "parallel") {
            for (const child of getChildren(current)) visit(child);
        }
    };
    visit(node);
    return result;
}

/** XState `getInitialStateNodesWithTheirAncestors`: `getInitialStateNodes(node)` plus the ancestors below `node`. */
export function getInitialStateNodesWithTheirAncestors<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): Set<StateNode<TContext, TEvent>> {
    const nodes = getInitialStateNodes(node);
    for (const initialNode of nodes) {
        for (const ancestor of getProperAncestors(initialNode, node)) nodes.add(ancestor);
    }
    return nodes;
}

/**
 * XState `getAllStateNodes`: completes a (possibly partial) node set into a
 * full configuration — compound nodes without an active child and parallel
 * regions that are missing get their initial descendants, then every ancestor
 * is added. A complete configuration comes back unchanged (same order); the
 * set is iterated while it grows, exactly like the original.
 */
export function getAllStateNodes<TContext extends MachineContext, TEvent extends EventObject>(
    stateNodes: Iterable<StateNode<TContext, TEvent>>,
): Set<StateNode<TContext, TEvent>> {
    const nodeSet = new Set(stateNodes);
    const adjacency = getAdjacencyList(nodeSet);

    for (const node of nodeSet) {
        if (node.type === "compound" && (adjacency.get(node)?.length ?? 0) === 0) {
            for (const initialNode of getInitialStateNodesWithTheirAncestors(node)) nodeSet.add(initialNode);
        } else if (node.type === "parallel") {
            for (const child of getChildren(node)) {
                if (nodeSet.has(child)) continue;
                for (const initialNode of getInitialStateNodesWithTheirAncestors(child)) nodeSet.add(initialNode);
            }
        }
    }

    for (const node of nodeSet) {
        let marker = node.parent;
        while (marker !== null) {
            nodeSet.add(marker);
            marker = marker.parent;
        }
    }
    return nodeSet;
}

/**
 * XState `getAdjList`: parent -> active children, children in the iteration
 * order of `stateNodes`. Every node of the input gets an entry (possibly
 * empty), which is how `getValueFromAdj` tells an active leaf apart from an
 * absent one.
 */
export function getAdjacencyList<TContext extends MachineContext, TEvent extends EventObject>(
    stateNodes: Iterable<StateNode<TContext, TEvent>>,
): Map<StateNode<TContext, TEvent>, StateNode<TContext, TEvent>[]> {
    const adjacency = new Map<StateNode<TContext, TEvent>, StateNode<TContext, TEvent>[]>();
    for (const node of stateNodes) {
        if (!adjacency.has(node)) adjacency.set(node, []);
        if (node.parent !== null) {
            let siblings = adjacency.get(node.parent);
            if (siblings === undefined) {
                siblings = [];
                adjacency.set(node.parent, siblings);
            }
            siblings.push(node);
        }
    }
    return adjacency;
}

/**
 * XState `isInFinalState`: a compound node is final when one of its `final`
 * children is active; a parallel node when every region is; a leaf when it is
 * itself `final`. The node's own membership in the set is not checked.
 */
export function isInFinalState<TContext extends MachineContext, TEvent extends EventObject>(
    stateNodeSet: ReadonlySet<StateNode<TContext, TEvent>>,
    node: StateNode<TContext, TEvent>,
): boolean {
    if (node.type === "compound") {
        return getChildren(node).some((child) => child.type === "final" && stateNodeSet.has(child));
    }
    if (node.type === "parallel") {
        return getChildren(node).every((child) => isInFinalState(stateNodeSet, child));
    }
    return node.type === "final";
}

/** XState `hasIntersection`: do the two collections share an element? */
export function hasIntersection<T>(first: Iterable<T>, second: Iterable<T>): boolean {
    const secondSet = new Set(second);
    for (const item of first) {
        if (secondSet.has(item)) return true;
    }
    return false;
}

/** XState `areStateNodeCollectionsEqual`: same members, order ignored. */
export function areStateNodeCollectionsEqual<TContext extends MachineContext, TEvent extends EventObject>(
    previous: ReadonlySet<StateNode<TContext, TEvent>>,
    next: ReadonlySet<StateNode<TContext, TEvent>>,
): boolean {
    if (previous.size !== next.size) return false;
    for (const node of previous) {
        if (!next.has(node)) return false;
    }
    return true;
}

/** The `initial` child of a compound node; the model guarantees its presence. */
export function getInitialChild<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): StateNode<TContext, TEvent> {
    if (node.initial === null) {
        throw new Error(`State node '${node.id}' of type '${node.type}' has no initial transition`);
    }
    return node.initial.target[0];
}
