import type {
    ImplementationLike,
    MachineConfigLike,
    StateNodeLike,
    StatesLike,
    TransitionLike,
    TransitionListLike,
    TransitionTargetLike,
} from "../types";

/** A transition in normalized form; `target` absent = targetless (actions only). */
export type TransitionObject = { target?: TransitionTargetLike; guard?: string; actions: string[] };

/** One link of the chain from the root to a state node. */
export type StateChainEntry = { key: string; node: StateNodeLike; path: string[] };

/** An event a state can react to, with the state that defines the reaction. */
export type OutgoingEvent = {
    event: string;
    /** Key of the state whose `on` defines the transitions (the state itself or an ancestor). */
    definedBy: string;
    definedByPath: string[];
    transitions: TransitionObject[];
};

const ANONYMOUS = "anonymous";

/**
 * Display name of a guard / action of the config: a name is itself, a
 * `{ type }` reference is its `type`, a function is its `name` (builtins are
 * named like their creator: `and`, `assign`, `mutate`) or `anonymous`.
 */
export function implementationName(value: ImplementationLike): string {
    if (typeof value === "string") return value;
    if (typeof value === "function") return value.name === "" ? ANONYMOUS : value.name;
    return value.type;
}

function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

/** Bare strings become `{ target }`, arrays are flattened in order, `undefined` items are skipped. */
export function normalizeTransitions(list: TransitionListLike | undefined): TransitionObject[] {
    const result: TransitionObject[] = [];
    for (const item of toArray<TransitionLike>(list)) {
        if (item === undefined) continue;
        if (typeof item === "string") {
            result.push({ target: item, actions: [] });
            continue;
        }
        result.push({
            target: item.target,
            guard: item.guard === undefined ? undefined : implementationName(item.guard),
            actions: toArray(item.actions).map(implementationName),
        });
    }
    return result;
}

/**
 * Chain from the root to the state whose key equals the mermaid id, or `null`.
 * State keys are globally unique mermaid ids; `$`-keys (regions, `$final`) are
 * never looked up but are traversed.
 */
export function findStateChain(config: MachineConfigLike, mermaidId: string): StateChainEntry[] | null {
    if (mermaidId.startsWith("$")) return null;
    const search = (states: StatesLike | undefined, chain: StateChainEntry[]): StateChainEntry[] | null => {
        if (!states) return null;
        for (const [key, node] of Object.entries(states)) {
            const entry = { key, node, path: [...chain.map((c) => c.key), key] };
            const next = [...chain, entry];
            if (key === mermaidId) return next;
            const found = search(node.states, next);
            if (found) return found;
        }
        return null;
    };
    return search(config.states, []);
}

/**
 * Events the given state reacts to: its own `on` first, then the ancestors'
 * (closest first). One entry per event name — the innermost definition wins,
 * as the interpreter selects the innermost matching transition. Keys without
 * a single transition (`on: { X: undefined }`) are skipped.
 */
export function collectOutgoingEvents(config: MachineConfigLike, mermaidId: string): OutgoingEvent[] {
    const chain = findStateChain(config, mermaidId);
    if (!chain) return [];
    const seen = new Set<string>();
    const result: OutgoingEvent[] = [];
    for (let i = chain.length - 1; i >= 0; i--) {
        const { key, node, path } = chain[i];
        for (const [event, list] of Object.entries(node.on ?? {})) {
            if (seen.has(event)) continue;
            const transitions = normalizeTransitions(list);
            if (transitions.length === 0) continue;
            seen.add(event);
            result.push({ event, definedBy: key, definedByPath: path, transitions });
        }
    }
    return result;
}

/**
 * Display form of a transition target: `working`, `#trafficLight.working.$final`
 * → `working.$final`, several targets joined with `, `, targetless → `(internal)`.
 */
export function describeTarget(target: TransitionTargetLike | undefined, machineId: string): string {
    if (target === undefined) return "(internal)";
    const prefix = `#${machineId}.`;
    const strip = (id: string) => (id.startsWith(prefix) ? id.slice(prefix.length) : id);
    return typeof target === "string" ? strip(target) : target.map(strip).join(", ");
}
