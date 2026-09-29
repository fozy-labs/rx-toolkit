import type { PendingQueries } from "../../types";
import { FormConfigError } from "../FormConfigError";

import {
    assertFunction,
    assertName,
    assertOptions,
    assertRecord,
    checkCallbacks,
    checkContext,
    checkQueries,
    checkRules,
    checkShowErrors,
    describeValue,
    joinPath,
} from "./checks";
import { isDefinition, registerDefinition, type DefinitionRecord, type GroupRecord } from "./records";

const GROUP_OPTIONS = [
    "name",
    "fields",
    "showErrors",
    "context",
    "computed",
    "queries",
    "validate",
    "disabled",
    "submit",
    "mapSubmitError",
    "pendingQueries",
] as const;

const ROOT_ONLY_OPTIONS = ["name", "submit", "mapSubmitError", "pendingQueries"] as const;

const PENDING_QUERIES: ReadonlySet<unknown> = new Set<PendingQueries>(["wait", "ignore", "reject"]);

/** Rejects a child that cannot be nested: not a definition, or a group with root-only options. */
export function assertChild(child: unknown, path: string): DefinitionRecord {
    if (!isDefinition(child)) {
        throw new FormConfigError(
            path,
            `must be a definition created by field(), group() or list() (got ${describeValue(child)})`,
        );
    }
    if (child.kind === "group" && child.rootOnly) {
        throw new FormConfigError(
            path,
            `a nested group must not have root-only options (${ROOT_ONLY_OPTIONS.join(", ")})`,
        );
    }
    return child;
}

export function createGroupDef(input: unknown): GroupRecord {
    const options = assertOptions(input, GROUP_OPTIONS, "group");

    const fields: Record<string, DefinitionRecord> = {};
    for (const [name, child] of Object.entries(assertRecord(options.fields, "fields"))) {
        const path = joinPath("fields", name);
        assertName(name, path);
        fields[name] = assertChild(child, path);
    }

    const disabled = checkCallbacks(options.disabled, "disabled", false);
    for (const name of Object.keys(disabled)) {
        if (!(name in fields)) {
            throw new FormConfigError(joinPath("disabled", name), `'${name}' is not a child of this group`);
        }
    }

    if (options.name !== undefined && typeof options.name !== "string") {
        throw new FormConfigError("name", `must be a string (got ${describeValue(options.name)})`);
    }
    if (options.pendingQueries !== undefined && !PENDING_QUERIES.has(options.pendingQueries)) {
        throw new FormConfigError(
            "pendingQueries",
            `must be "wait", "ignore" or "reject" (got ${String(options.pendingQueries)})`,
        );
    }

    return registerDefinition<GroupRecord>({
        kind: "group",
        fields: Object.freeze(fields),
        showErrors: checkShowErrors(options.showErrors, "showErrors"),
        hasContext: checkContext(options.context, "context"),
        computed: checkCallbacks(options.computed, "computed", true),
        queries: checkQueries(options.queries, "queries"),
        rules: checkRules(options.validate, "validate"),
        disabled,
        rootOnly: ROOT_ONLY_OPTIONS.some((key) => options[key] !== undefined),
        name: options.name,
        submit: options.submit === undefined ? undefined : assertFunction(options.submit, "submit"),
        mapSubmitError:
            options.mapSubmitError === undefined ? undefined : assertFunction(options.mapSubmitError, "mapSubmitError"),
        pendingQueries: options.pendingQueries as PendingQueries | undefined,
    });
}
