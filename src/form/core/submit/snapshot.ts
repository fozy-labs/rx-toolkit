import type { Issue } from "../../types";
import type { FieldCore } from "../nodes/FieldCore";
import type { GroupCore } from "../nodes/GroupCore";
import type { ListCore } from "../nodes/ListCore";

// The attempt snapshot: what a submit sent. It is taken right after the handler, on every attempt,
// a retry included, and serves the attempt's settle: `_commit()` makes it the base, and the
// server issues are laid out by it. It holds the node cores, so a list row removed during the
// flight is still reachable.

export interface FieldSnapshot {
    readonly kind: "field";
    readonly core: FieldCore;
    readonly value: unknown;
}

/** A group: its enabled children only, as a disabled child was not sent. */
export interface GroupSnapshot {
    readonly kind: "group";
    readonly core: GroupCore;
    readonly children: ReadonlyMap<string, AttemptSnapshot>;
}

/** A list: its key order and the items by key. */
export interface ListSnapshot {
    readonly kind: "list";
    readonly core: ListCore;
    readonly keys: readonly string[];
    readonly items: ReadonlyMap<string, AttemptSnapshot>;
}

export type AttemptSnapshot = FieldSnapshot | GroupSnapshot | ListSnapshot;

/**
 * `_commit()`: what was sent becomes the base of every node in the snapshot — except the subtree of
 * a group whose `initialize()` wrote bases after `since` (the generation the flight captured): an
 * initialize wins over what was sent for the bases it writes.
 */
export function commitSnapshot(snapshot: AttemptSnapshot, since: number): void {
    switch (snapshot.kind) {
        case "field":
            return snapshot.core.commit(snapshot);
        case "group":
            return snapshot.core.commit(snapshot, since);
        case "list":
            return snapshot.core.commit(snapshot, since);
    }
}

/**
 * Lays server issues out by the attempt snapshot: a list index is resolved through the snapshot's
 * key order to the item alive now. A path whose target was not in the snapshot, or whose row was
 * removed since, lands on the deepest node on the way that was. An issue that lands on a field
 * whose value is no longer `equals` to the one sent is dropped: it is about a value that is gone.
 * `Issue.path` stays as the server sent it.
 */
export function layoutServerIssues(root: GroupSnapshot, issues: readonly Issue[]): void {
    const byNode = new Map<AttemptSnapshot["core"], Issue[]>();
    for (const issue of issues) {
        let target: AttemptSnapshot = root;
        for (const segment of issue.path) {
            const next = childOf(target, segment);
            if (!next) break;
            target = next;
        }
        if (target.kind === "field" && !target.core.hasValue(target.value)) continue;
        const list = byNode.get(target.core);
        if (list) list.push(issue);
        else byNode.set(target.core, [issue]);
    }
    for (const [core, list] of byNode) core.addServerIssues(list);
}

function childOf(snapshot: AttemptSnapshot, segment: string | number): AttemptSnapshot | undefined {
    switch (snapshot.kind) {
        case "field":
            return undefined;
        case "group":
            return snapshot.children.get(String(segment));
        case "list": {
            const index = typeof segment === "number" ? segment : /^\d+$/.test(segment) ? Number(segment) : NaN;
            const key = Number.isInteger(index) ? snapshot.keys[index] : undefined;
            return key !== undefined && snapshot.core.hasItem(key) ? snapshot.items.get(key) : undefined;
        }
    }
}
