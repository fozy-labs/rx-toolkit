import type { Issue, IssuePath } from "../../types";
import type { QueryRecord } from "../definition/records";
import { notImplemented } from "../runtime/guard";

import type { NodeCore } from "./NodeCore";

/**
 * The query nodes of one node (Stage 4). The node reads them only through this interface: its
 * public `queries`, the `queries` of its rule context, its `isPending$` and its own issues.
 */
export interface NodeQueries {
    /** `queries` of the public node: `<k>` and the `<k>$` aliases. */
    readonly nodes: object;
    /** `queries` of the callback contexts: `<k>$` and `<k>.isDebouncing$`. */
    readonly views: object;
    /** A query of the node is in flight or debouncing. */
    isPending(): boolean;
    /** Appends the `callback` issues of failed query keys. */
    collectIssues(path: IssuePath, out: Issue[]): void;
}

const NO_QUERIES: NodeQueries = Object.freeze({
    nodes: Object.freeze({}),
    views: Object.freeze({}),
    isPending: () => false,
    collectIssues: () => {},
});

/** `ctx` is the context of the query keys, see the Contexts table of the design. */
export function createQueries(owner: NodeCore, records: Readonly<Record<string, QueryRecord>>, ctx: object) {
    void owner;
    void ctx;
    if (Object.keys(records).length > 0) throw notImplemented("queries");
    return NO_QUERIES;
}
