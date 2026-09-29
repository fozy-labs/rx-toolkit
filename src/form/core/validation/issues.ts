import type { Issue, IssuePath, IssueSeverity, ShowErrors } from "../../types";
import type { NodeCore } from "../nodes/NodeCore";
import { errorMessage } from "../runtime/guard";

import type { SchemaIssue } from "./parse";

/**
 * Appends the issues the rules address to `node`, as of now: its own rules first, then the
 * rules of its ancestors from the nearest one, each in declaration order.
 */
export function collectRuleIssues(node: NodeCore, path: IssuePath, out: Issue[]): void {
    for (let owner: NodeCore | null = node; owner; owner = owner.parent) {
        for (const rule of owner.rules) {
            for (const hit of rule.hits$()) {
                if (hit.target !== node) continue;
                const issue: Issue = { path, message: hit.message, severity: hit.severity, source: rule.source };
                if (hit.code !== undefined) issue.code = hit.code;
                out.push(issue);
            }
        }
    }
}

export function schemaIssue(path: IssuePath, issue: SchemaIssue): Issue {
    const result: Issue = {
        path: issue.path.length ? [...path, ...issue.path] : path,
        message: issue.message,
        severity: "error",
        source: { type: "schema" },
    };
    if (issue.code !== undefined) result.code = issue.code;
    return result;
}

/** The issue of a failed callback (`computed`, `disabled`, a query key) on its declaring node. */
export function callbackIssue(owner: NodeCore, path: IssuePath, name: string, error: unknown): Issue {
    return {
        path,
        message: errorMessage(error),
        severity: "error",
        source: { type: "callback", path: [...owner.segments], name },
    };
}

export function withSeverity(issues: readonly Issue[], severity: IssueSeverity): Issue[] {
    return issues.filter((issue) => issue.severity === severity);
}

/**
 * Whether the issues a node owns are visible under its policy. The node's flags are its
 * aggregates, so for a group issue without a field `touched` means "the group is touched".
 * The `submitted` flag shows them under any policy.
 */
export function isShown(policy: ShowErrors, node: NodeCore): boolean {
    if (policy === "always" || node.isSubmitted$()) return true;
    if (policy === "touched") return node.isTouched$();
    if (policy === "modified") return node.isModified$();
    return false;
}
