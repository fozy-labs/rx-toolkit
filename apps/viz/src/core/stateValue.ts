import type { StateValue } from "../types";

/** Mermaid id of the root-level `[*]` end node. */
export const ROOT_END_ID = "root_end";

/** Synthetic config keys that are not mermaid ids. */
export const FINAL_KEY = "$final";

export function isRegionKey(key: string): boolean {
    return /^\$\d+$/.test(key);
}

/**
 * Every active path of a state value, parents before children:
 * `{ p: { $0: "a", $1: "c" } }` → `[["p"], ["p","$0"], ["p","$0","a"], ["p","$1"], ["p","$1","c"]]`.
 */
export function collectActivePaths(value: StateValue): string[][] {
    const paths: string[][] = [];
    const walk = (node: StateValue, prefix: string[]) => {
        if (typeof node === "string") {
            paths.push([...prefix, node]);
            return;
        }
        for (const [key, child] of Object.entries(node)) {
            if (child === undefined) continue;
            const path = [...prefix, key];
            paths.push(path);
            walk(child, path);
        }
    };
    walk(value, []);
    return paths;
}

/**
 * Mermaid id of the SVG node that represents the last key of an active path,
 * or `null` when there is none: region keys (`$0`) are skipped, `$final` maps
 * to the parent's `[*]` end node (`<parent>_end`, `root_end` at the root) and
 * has no stable node inside a region.
 */
export function mermaidIdOfPath(path: string[]): string | null {
    const key = path[path.length - 1];
    if (key === undefined) return null;
    if (key === FINAL_KEY) {
        const parent = path[path.length - 2];
        if (parent === undefined) return ROOT_END_ID;
        return isRegionKey(parent) ? null : `${parent}_end`;
    }
    if (key.startsWith("$")) return null;
    return key;
}

/** Flat set of mermaid ids that are active for a state value. */
export function projectActiveIds(value: StateValue): Set<string> {
    const ids = new Set<string>();
    for (const path of collectActivePaths(value)) {
        const id = mermaidIdOfPath(path);
        if (id !== null) ids.add(id);
    }
    return ids;
}

/** Human-readable form of a state value: `working.green`, `p.($0: b | $1: c)`. */
export function formatStateValue(value: StateValue): string {
    if (typeof value === "string") return value;
    return Object.entries(value)
        .filter((entry): entry is [string, StateValue] => entry[1] !== undefined)
        .map(([key, child]) => `${key}.${typeof child === "string" ? child : `(${formatStateValue(child)})`}`)
        .join(" | ");
}
