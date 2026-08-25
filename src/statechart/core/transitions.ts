/**
 * Transition algebra — ports of the XState `stateUtils` functions that relate
 * transitions to the configuration: event descriptor matching and candidate
 * lookup (`matchesEventDescriptor`, `getCandidates`), history resolution
 * (`resolveHistoryDefaultTransition`, `getEffectiveTargetStates`), the
 * transition domain and exit set (`getTransitionDomain`, `computeExitSet`),
 * conflict resolution (`removeConflictingTransitions`) and the entry set
 * (`computeEntrySet` with `addDescendantStatesToEnter` /
 * `addAncestorStatesToEnter`). Pure functions; the "no node is `null`"
 * convention of `configuration.ts` applies to the domain.
 */
import type { EventObject, MachineContext } from "../types";

import {
    findLeastCommonAncestor,
    getChildren,
    getInitialChild,
    getProperAncestors,
    hasIntersection,
    isDescendant,
    isHistoryNode,
} from "./configuration";
import { STATE_DELIMITER, WILDCARD } from "./constants";
import type { MachineState, StateNode, Transition } from "./model";

/** History node id -> nodes recorded when its parent was last exited. */
export type HistoryValue<TContext extends MachineContext, TEvent extends EventObject> = MachineState<
    TContext,
    TEvent
>["historyValue"];

// --- candidates ------------------------------------------------------------

/**
 * XState `matchesEventDescriptor`: exact match, the catch-all `"*"`, or a
 * partial `"prefix.*"` whose leading tokens equal the event's. Infix
 * wildcards never match (the normalizer rejects them anyway).
 */
export function matchesEventDescriptor(eventType: string, descriptor: string): boolean {
    if (descriptor === eventType || descriptor === WILDCARD) return true;
    if (!descriptor.endsWith(`${STATE_DELIMITER}${WILDCARD}`)) return false;

    const descriptorTokens = descriptor.split(STATE_DELIMITER);
    const eventTokens = eventType.split(STATE_DELIMITER);
    for (let index = 0; index < descriptorTokens.length; index++) {
        const descriptorToken = descriptorTokens[index];
        if (descriptorToken === WILDCARD) return index === descriptorTokens.length - 1;
        if (descriptorToken !== eventTokens[index]) return false;
    }
    return true;
}

const candidatesCache = new WeakMap<StateNode<any, any>, Map<string, readonly Transition<any, any>[]>>();

/**
 * XState `getCandidates`: the transitions of `node` that may handle
 * `eventType` — the exact descriptor's list first, then the matching
 * wildcard descriptors from the most specific (longest) to the least, each
 * list in config order. Memoized per node and event type like XState.
 */
export function getCandidates<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    eventType: string,
): readonly Transition<TContext, TEvent>[] {
    let byEvent = candidatesCache.get(node);
    if (byEvent === undefined) {
        byEvent = new Map();
        candidatesCache.set(node, byEvent);
    }
    const cached = byEvent.get(eventType);
    if (cached !== undefined) return cached as readonly Transition<TContext, TEvent>[];

    const exact = node.transitions.get(eventType) ?? [];
    const wildcard = [...node.transitions.keys()]
        .filter((descriptor) => descriptor !== eventType && matchesEventDescriptor(eventType, descriptor))
        .sort((a, b) => b.length - a.length)
        .flatMap((descriptor) => node.transitions.get(descriptor) ?? []);
    const candidates = Object.freeze([...exact, ...wildcard]);
    byEvent.set(eventType, candidates);
    return candidates;
}

// --- history ---------------------------------------------------------------

export interface HistoryDefaultTransition<TContext extends MachineContext, TEvent extends EventObject> {
    readonly target: readonly StateNode<TContext, TEvent>[];
    /** True when the parent's `initial` transition was used (the parent then joins `statesForDefaultEntry`). */
    readonly isParentInitial: boolean;
}

/**
 * XState `resolveHistoryDefaultTransition`: where a history node leads when
 * nothing was recorded — its own `target`, else the parallel parent itself,
 * else the compound parent's `initial` child.
 */
export function resolveHistoryDefaultTransition<TContext extends MachineContext, TEvent extends EventObject>(
    historyNode: StateNode<TContext, TEvent>,
): HistoryDefaultTransition<TContext, TEvent> {
    const parent = historyNode.parent;
    if (parent === null) throw new Error(`History state node '${historyNode.id}' has no parent`);
    if (historyNode.historyTarget !== null) return { target: historyNode.historyTarget, isParentInitial: false };
    if (parent.type === "parallel") return { target: [parent], isParentInitial: false };
    return { target: [getInitialChild(parent)], isParentInitial: true };
}

/**
 * XState `getEffectiveTargetStates`: the targets with history nodes replaced
 * by their recorded nodes (or their default targets, recursively).
 * Deduplicated, in first-seen order.
 */
export function getEffectiveTargetStates<TContext extends MachineContext, TEvent extends EventObject>(
    targets: readonly StateNode<TContext, TEvent>[] | null,
    historyValue: HistoryValue<TContext, TEvent>,
): StateNode<TContext, TEvent>[] {
    if (targets === null) return [];
    const result = new Set<StateNode<TContext, TEvent>>();
    for (const target of targets) {
        if (!isHistoryNode(target)) {
            result.add(target);
            continue;
        }
        const recorded = getRecordedHistory(historyValue, target);
        if (recorded !== undefined) {
            for (const node of recorded) result.add(node);
        } else {
            const defaults = getEffectiveTargetStates(resolveHistoryDefaultTransition(target).target, historyValue);
            for (const node of defaults) result.add(node);
        }
    }
    return [...result];
}

function getRecordedHistory<TContext extends MachineContext, TEvent extends EventObject>(
    historyValue: HistoryValue<TContext, TEvent>,
    historyNode: StateNode<TContext, TEvent>,
): readonly StateNode<TContext, TEvent>[] | undefined {
    return Object.hasOwn(historyValue, historyNode.id) ? historyValue[historyNode.id] : undefined;
}

// --- domain and exit set ---------------------------------------------------

/**
 * XState `getTransitionDomain`: the node whose descendants are exited by the
 * transition. The source itself for internal transitions (`reenter: false`
 * and every target inside the source), else the least common ancestor of the
 * source and the effective targets. `null` ("no domain": everything, root
 * included, is exited and re-entered) for a root-sourced `reenter: true`
 * transition; the root when the LCA is missing otherwise (a target that is
 * the root itself).
 */
export function getTransitionDomain<TContext extends MachineContext, TEvent extends EventObject>(
    transition: Transition<TContext, TEvent>,
    historyValue: HistoryValue<TContext, TEvent>,
): StateNode<TContext, TEvent> | null {
    const targetStates = getEffectiveTargetStates(transition.target, historyValue);
    const { source } = transition;
    if (!transition.reenter && targetStates.every((target) => target === source || isDescendant(target, source))) {
        return source;
    }
    const lca = findLeastCommonAncestor([...targetStates, source]);
    if (lca !== null) return lca;
    if (transition.reenter) return null;
    return getRoot(source);
}

function getRoot<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
): StateNode<TContext, TEvent> {
    let root = node;
    while (root.parent !== null) root = root.parent;
    return root;
}

/**
 * XState `computeExitSet`: every active descendant of each transition's
 * domain, plus the domain itself when the transition re-enters its own
 * source. Targetless transitions exit nothing. Insertion order (not yet
 * sorted; `exitStates` sorts by document order descending).
 */
export function computeExitSet<TContext extends MachineContext, TEvent extends EventObject>(
    transitions: readonly Transition<TContext, TEvent>[],
    stateNodeSet: ReadonlySet<StateNode<TContext, TEvent>>,
    historyValue: HistoryValue<TContext, TEvent>,
): StateNode<TContext, TEvent>[] {
    const statesToExit = new Set<StateNode<TContext, TEvent>>();
    for (const transition of transitions) {
        if (transition.target === null || transition.target.length === 0) continue;
        const domain = getTransitionDomain(transition, historyValue);
        if (transition.reenter && transition.source === domain) statesToExit.add(domain);
        for (const node of stateNodeSet) {
            if (isDescendant(node, domain)) statesToExit.add(node);
        }
    }
    return [...statesToExit];
}

/**
 * XState `removeConflictingTransitions` (SCXML): when two enabled transitions
 * would exit overlapping sets, the one sourced from the deeper node wins;
 * otherwise the earlier one stays. Order of the survivors = order of first
 * acceptance.
 */
export function removeConflictingTransitions<TContext extends MachineContext, TEvent extends EventObject>(
    enabledTransitions: readonly Transition<TContext, TEvent>[],
    stateNodeSet: ReadonlySet<StateNode<TContext, TEvent>>,
    historyValue: HistoryValue<TContext, TEvent>,
): Transition<TContext, TEvent>[] {
    const filtered = new Set<Transition<TContext, TEvent>>();
    for (const candidate of enabledTransitions) {
        let preempted = false;
        const toRemove = new Set<Transition<TContext, TEvent>>();
        for (const accepted of filtered) {
            const overlaps = hasIntersection(
                computeExitSet([candidate], stateNodeSet, historyValue),
                computeExitSet([accepted], stateNodeSet, historyValue),
            );
            if (!overlaps) continue;
            if (isDescendant(candidate.source, accepted.source)) {
                toRemove.add(accepted);
            } else {
                preempted = true;
                break;
            }
        }
        if (preempted) continue;
        for (const transition of toRemove) filtered.delete(transition);
        filtered.add(candidate);
    }
    return [...filtered];
}

// --- entry set -------------------------------------------------------------

export interface EntrySet<TContext extends MachineContext, TEvent extends EventObject> {
    /** Nodes to enter (unsorted; `enterStates` sorts by document order ascending). */
    readonly statesToEnter: Set<StateNode<TContext, TEvent>>;
    /** Nodes entered through their own `initial` (as opposed to a deep explicit target). */
    readonly statesForDefaultEntry: Set<StateNode<TContext, TEvent>>;
}

/** XState `computeEntrySet`: the nodes entered by the given (conflict-free) transitions. */
export function computeEntrySet<TContext extends MachineContext, TEvent extends EventObject>(
    transitions: readonly Transition<TContext, TEvent>[],
    historyValue: HistoryValue<TContext, TEvent>,
): EntrySet<TContext, TEvent> {
    const statesToEnter = new Set<StateNode<TContext, TEvent>>();
    const statesForDefaultEntry = new Set<StateNode<TContext, TEvent>>();
    const entry: EntrySet<TContext, TEvent> = { statesToEnter, statesForDefaultEntry };

    for (const transition of transitions) {
        const domain = getTransitionDomain(transition, historyValue);
        for (const target of transition.target ?? []) {
            if (
                !isHistoryNode(target) &&
                // a target other than the source is definitely entered; so is the source when the
                // domain lies outside it or the transition re-enters
                (transition.source !== target || transition.source !== domain || transition.reenter)
            ) {
                statesToEnter.add(target);
                statesForDefaultEntry.add(target);
            }
            addDescendantStatesToEnter(target, historyValue, entry);
        }
        for (const target of getEffectiveTargetStates(transition.target, historyValue)) {
            const ancestors = getProperAncestors(target, domain);
            if (domain?.type === "parallel") ancestors.push(domain);
            addAncestorStatesToEnter(
                ancestors,
                historyValue,
                entry,
                transition.source.parent === null && transition.reenter ? null : domain,
            );
        }
    }
    return entry;
}

/** XState `addDescendantStatesToEnter`. */
function addDescendantStatesToEnter<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    historyValue: HistoryValue<TContext, TEvent>,
    entry: EntrySet<TContext, TEvent>,
): void {
    const { statesToEnter, statesForDefaultEntry } = entry;
    if (isHistoryNode(node)) {
        const parent = node.parent;
        const recorded = getRecordedHistory(historyValue, node);
        if (recorded !== undefined) {
            for (const recordedNode of recorded) {
                statesToEnter.add(recordedNode);
                addDescendantStatesToEnter(recordedNode, historyValue, entry);
            }
            for (const recordedNode of recorded) {
                addProperAncestorStatesToEnter(recordedNode, parent, historyValue, entry);
            }
        } else {
            const defaultTransition = resolveHistoryDefaultTransition(node);
            for (const target of defaultTransition.target) {
                statesToEnter.add(target);
                if (defaultTransition.isParentInitial && parent !== null) statesForDefaultEntry.add(parent);
                addDescendantStatesToEnter(target, historyValue, entry);
            }
            for (const target of defaultTransition.target) {
                addProperAncestorStatesToEnter(target, parent, historyValue, entry);
            }
        }
        return;
    }
    if (node.type === "compound") {
        const initialChild = getInitialChild(node);
        if (!isHistoryNode(initialChild)) {
            statesToEnter.add(initialChild);
            statesForDefaultEntry.add(initialChild);
        }
        addDescendantStatesToEnter(initialChild, historyValue, entry);
        addProperAncestorStatesToEnter(initialChild, node, historyValue, entry);
        return;
    }
    if (node.type === "parallel") {
        for (const child of getChildren(node)) {
            if ([...statesToEnter].some((entered) => isDescendant(entered, child))) continue;
            statesToEnter.add(child);
            statesForDefaultEntry.add(child);
            addDescendantStatesToEnter(child, historyValue, entry);
        }
    }
}

/**
 * XState `addAncestorStatesToEnter`. `reentrancyDomain === null` means "no
 * filter" (XState `undefined`): every ancestor is entered. Parallel ancestors
 * additionally enter every region that no target already covers.
 */
function addAncestorStatesToEnter<TContext extends MachineContext, TEvent extends EventObject>(
    ancestors: readonly StateNode<TContext, TEvent>[],
    historyValue: HistoryValue<TContext, TEvent>,
    entry: EntrySet<TContext, TEvent>,
    reentrancyDomain: StateNode<TContext, TEvent> | null,
): void {
    const { statesToEnter } = entry;
    for (const ancestor of ancestors) {
        if (reentrancyDomain === null || isDescendant(ancestor, reentrancyDomain)) statesToEnter.add(ancestor);
        if (ancestor.type !== "parallel") continue;
        for (const child of getChildren(ancestor)) {
            if ([...statesToEnter].some((entered) => isDescendant(entered, child))) continue;
            statesToEnter.add(child);
            addDescendantStatesToEnter(child, historyValue, entry);
        }
    }
}

/** XState `addProperAncestorStatesToEnter`: ancestors of `node` below `toNode`, unfiltered. */
function addProperAncestorStatesToEnter<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    toNode: StateNode<TContext, TEvent> | null,
    historyValue: HistoryValue<TContext, TEvent>,
    entry: EntrySet<TContext, TEvent>,
): void {
    addAncestorStatesToEnter(getProperAncestors(node, toNode), historyValue, entry, null);
}
