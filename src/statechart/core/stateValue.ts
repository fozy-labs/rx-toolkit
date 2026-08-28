/**
 * Configuration <-> StateValue helpers (ports of XState `stateUtils`):
 * `getStateValue`, `matchesState`, `toStatePath`, `pathToStateValue`,
 * `getStateNodeById`, `getStateNodeByPath`. Spec: section 3.8. `normalize`
 * reuses the lookups (with a config path for its errors) and `toStatePath`.
 */
import type { EventObject, MachineContext, StateValue, StateValueMap } from "../types";

import { getAdjacencyList, getAllStateNodes, isAtomicStateNode } from "./configuration";
import { STATE_DELIMITER, STATE_IDENTIFIER } from "./constants";
import { MachineConfigError } from "./MachineConfigError";
import type { MachineModel, StateNode } from "./model";

/** Splits `"a.b.c"` into `["a", "b", "c"]`; a backslash escapes the next character. */
export function toStatePath(stateId: string): string[] {
    const result: string[] = [];
    let segment = "";
    for (let index = 0; index < stateId.length; index++) {
        const char = stateId[index];
        if (char === "\\") {
            segment += stateId[index + 1] ?? "";
            index++;
            continue;
        }
        if (char === STATE_DELIMITER) {
            result.push(segment);
            segment = "";
            continue;
        }
        segment += char;
    }
    result.push(segment);
    return result;
}

/** `["a", "b", "c"]` -> `{ a: { b: "c" } }`; a single segment stays a string. */
export function pathToStateValue(statePath: readonly string[]): StateValue {
    if (statePath.length === 1) return statePath[0];
    const value: StateValueMap = {};
    let marker = value;
    for (let index = 0; index < statePath.length - 1; index++) {
        if (index === statePath.length - 2) {
            marker[statePath[index]] = statePath[index + 1];
        } else {
            const previous = marker;
            marker = {};
            previous[statePath[index]] = marker;
        }
    }
    return value;
}

function toStateValue(stateValue: StateValue): StateValue {
    return typeof stateValue === "string" ? pathToStateValue(toStatePath(stateValue)) : stateValue;
}

/**
 * XState `matchesState`: is `parentStateValue` (string path or partial object)
 * a prefix of `childStateValue`? Strings are expanded with `toStatePath` first,
 * so `"a.b"` matches `{ a: "b" }` and `{ a: { b: "c" } }`.
 */
export function matchesState(parentStateValue: StateValue, childStateValue: StateValue): boolean {
    const parent = toStateValue(parentStateValue);
    const child = toStateValue(childStateValue);
    if (typeof child === "string") {
        // A string parent must equal the child; an object parent is more specific than the child.
        return typeof parent === "string" && child === parent;
    }
    if (typeof parent === "string") return parent in child;
    return Object.keys(parent).every((key) => {
        const parentValue = parent[key];
        const childValue = child[key];
        if (parentValue === undefined || childValue === undefined || !(key in child)) return false;
        return matchesState(parentValue, childValue);
    });
}

/**
 * XState `getStateValue`: state value of a configuration. A compound node
 * with an atomic/final active child -> the child's key; a compound node with
 * a non-atomic child -> `{ key: <child value> }`; a parallel node -> an object
 * with every region (an atomic region renders as `{}`). The result is deeply
 * frozen. A partial configuration is completed with initial states first
 * (XState `getAllStateNodes`), so the pre-initial `{ root }` already reads as
 * the initial value.
 */
export function getStateValue<TContext extends MachineContext, TEvent extends EventObject>(
    model: MachineModel<TContext, TEvent>,
    configuration: ReadonlySet<StateNode<TContext, TEvent>>,
): StateValue {
    const adjacency = getAdjacencyList(getAllStateNodes(configuration));
    return getValueFromAdjacency(model.root, adjacency);
}

function getValueFromAdjacency<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    adjacency: ReadonlyMap<StateNode<TContext, TEvent>, readonly StateNode<TContext, TEvent>[]>,
): StateValue {
    const children = adjacency.get(node);
    if (children === undefined) return Object.freeze({});
    if (node.type === "compound") {
        const child = children[0];
        if (child === undefined) return Object.freeze({});
        if (isAtomicStateNode(child)) return child.key;
    }
    const value: StateValueMap = {};
    for (const child of children) value[child.key] = getValueFromAdjacency(child, adjacency);
    return Object.freeze(value);
}

/**
 * What `#id` resolution needs: the machine id (for the error message) and the
 * id map. A finished `MachineModel` satisfies it; `normalize` passes its build
 * context while the model is still being assembled.
 */
export interface StateNodeLookup<TContext extends MachineContext, TEvent extends EventObject> {
    readonly id: string;
    readonly idMap: ReadonlyMap<string, StateNode<TContext, TEvent>>;
}

/**
 * XState `getStateNodeById`: `"#id"` / `"id"` optionally followed by
 * `".child.path"`. Throws `MachineConfigError` (XState's message) when unknown;
 * `configPath` is the path the error is attributed to (`""` = root).
 */
export function getStateNodeById<TContext extends MachineContext, TEvent extends EventObject>(
    lookup: StateNodeLookup<TContext, TEvent>,
    stateId: string,
    configPath = "",
): StateNode<TContext, TEvent> {
    const fullPath = toStatePath(stateId);
    const head = fullPath[0] ?? "";
    const resolvedId = head.startsWith(STATE_IDENTIFIER) ? head.slice(STATE_IDENTIFIER.length) : head;
    const node = lookup.idMap.get(resolvedId);
    if (node === undefined) {
        throw new MachineConfigError(
            configPath,
            `Child state node '#${resolvedId}' does not exist on machine '${lookup.id}'`,
        );
    }
    return getStateNodeByPath(node, fullPath.slice(1), configPath);
}

/**
 * XState `getStateNodeByPath`: walks child keys from `node`. An empty segment
 * stops the walk (`"."` resolves to `node` itself). Throws `MachineConfigError`
 * (XState's message) when a key does not exist; `configPath` is the path the
 * error is attributed to (`""` = root).
 */
export function getStateNodeByPath<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    statePath: string | readonly string[],
    configPath = "",
): StateNode<TContext, TEvent> {
    const segments = typeof statePath === "string" ? toStatePath(statePath) : statePath;
    let current = node;
    for (const segment of segments) {
        if (segment.length === 0) break;
        const child = current.childrenByKey.get(segment);
        if (child === undefined) {
            throw new MachineConfigError(configPath, `Child state '${segment}' does not exist on '${current.id}'`);
        }
        current = child;
    }
    return current;
}

/** Deduplicated tags of a configuration, in document order of the nodes; frozen. */
export function collectTags<TContext extends MachineContext, TEvent extends EventObject>(
    configuration: ReadonlySet<StateNode<TContext, TEvent>>,
): readonly string[] {
    const tags = new Set<string>();
    for (const node of [...configuration].sort((a, b) => a.order - b.order)) {
        for (const tag of node.tags) tags.add(tag);
    }
    return Object.freeze([...tags]);
}
