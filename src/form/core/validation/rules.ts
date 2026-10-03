import type { ReadonlySignal } from "@/signals/types";

import type { IssueOptions, IssueSeverity, IssueSource } from "../../types";
import type { RuleRecord } from "../definition/records";
import { FormConfigError } from "../FormConfigError";
import { coreOf, derived, isInSubtree, memberPath, nodeKey, type NodeCore } from "../nodes/NodeCore";
import { errorMessage, guard } from "../runtime/guard";

/** One `error` / `warn` call of a rule run, addressed to a node of the rule's subtree. */
export interface RuleHit {
    readonly target: NodeCore;
    readonly severity: IssueSeverity;
    readonly message: string;
    readonly code?: string;
}

/** A rule of a node: its own computation, recomputed only from what it read. */
export interface RuleSignal {
    readonly source: IssueSource;
    readonly hits$: ReadonlySignal<readonly RuleHit[]>;
}

/**
 * Creates the computation of one rule declared on `owner`. `ctx` is the rule context without the
 * collectors; each run gets its own `error` / `warn`, so a late call from a finished run is
 * ignored. A throw drops the partial hits of the run and gives one error on `owner`.
 */
export function createRule(owner: NodeCore, record: RuleRecord, ctx: object): RuleSignal {
    const segments = owner.segments;
    // Short form: named after the node (the root by its `name`), under the parent's path.
    // Map form: the rule key under the node's path.
    const source: IssueSource =
        record.name === null
            ? {
                  type: "rule",
                  path: segments.slice(0, -1),
                  name: segments.length ? segments[segments.length - 1] : owner.scope.rootName,
              }
            : { type: "rule", path: [...segments], name: record.name };
    const member = record.name === null ? "validate" : `validate.${record.name}`;
    const where = memberPath(segments, member);

    const hits$ = derived(
        `${nodeKey(owner.scope, segments)}/${member}`,
        (): readonly RuleHit[] => {
            const hits: RuleHit[] = [];
            let isOpen = true;
            const collector =
                (severity: IssueSeverity) =>
                (...args: unknown[]): void => {
                    if (!isOpen) return;
                    const addressed = typeof args[0] !== "string";
                    const target = addressed ? resolveTarget(args[0], owner, where) : owner;
                    const message = String(addressed ? args[1] : args[0]);
                    const options = (addressed ? args[2] : args[1]) as IssueOptions | undefined;
                    hits.push(
                        typeof options?.code === "string"
                            ? { target, severity, message, code: options.code }
                            : { target, severity, message },
                    );
                };
            const outcome = guard(
                () => record.fn({ ...ctx, error: collector("error"), warn: collector("warning") }),
                where,
            );
            isOpen = false;
            if (outcome.ok) return hits;
            return [{ target: owner, severity: "error", message: errorMessage(outcome.error) }];
        },
        hitsEqual,
    );

    return { source, hits$ };
}

function resolveTarget(node: unknown, owner: NodeCore, where: string): NodeCore {
    const target = coreOf(node);
    if (!target || !isInSubtree(target, owner)) {
        throw new FormConfigError(where, "error() / warn() can address only the nodes of the rule's own subtree");
    }
    return target;
}

function hitsEqual(a: readonly RuleHit[], b: readonly RuleHit[]): boolean {
    return (
        a.length === b.length &&
        a.every(
            (hit, index) =>
                hit.target === b[index].target &&
                hit.severity === b[index].severity &&
                hit.message === b[index].message &&
                hit.code === b[index].code,
        )
    );
}
