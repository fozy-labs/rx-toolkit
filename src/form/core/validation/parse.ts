import type { StandardSchemaV1, StandardSchemaV1Issue } from "@/common/standard-schema";

import type { IssuePath, Parsed } from "../../types";
import { errorMessage, passConfigError } from "../runtime/guard";
import { NOT_PARSED } from "../runtime/values";

/** A schema issue relative to the field: its path is appended to the field's path when read. */
export interface SchemaIssue {
    readonly message: string;
    readonly path: IssuePath;
    readonly code?: string;
}

export interface ParseResult {
    readonly parsed: Parsed<unknown>;
    readonly issues: readonly SchemaIssue[];
}

export const ASYNC_SCHEMA_MESSAGE = "Async schemas are not supported";

/**
 * Runs `~standard.validate` on a value. A throw becomes one schema issue; a promise becomes one
 * schema issue too (its rejection is swallowed) and `onAsync` is called to report it.
 */
export function parseValue(schema: StandardSchemaV1, value: unknown, where: string, onAsync: () => void): ParseResult {
    try {
        const result = schema["~standard"].validate(value);
        if (isPromiseLike(result)) {
            result.then(undefined, () => {});
            onAsync();
            return failure(ASYNC_SCHEMA_MESSAGE);
        }
        if (result.issues !== undefined) {
            return { parsed: NOT_PARSED, issues: result.issues.map(normalizeIssue) };
        }
        return { parsed: { isParsed: true, value: result.value }, issues: [] };
    } catch (error) {
        return failure(errorMessage(passConfigError(error, where)));
    }
}

function failure(message: string): ParseResult {
    return { parsed: NOT_PARSED, issues: [{ message, path: [] }] };
}

/** Path segments `{ key }` become plain keys; `code` is taken as is when a vendor adds one. */
export function normalizeIssue(issue: StandardSchemaV1Issue): SchemaIssue {
    const path = (issue.path ?? []).map((segment) => {
        const key = typeof segment === "object" && segment !== null ? segment.key : segment;
        return typeof key === "number" ? key : String(key);
    });
    const code: unknown = (issue as { code?: unknown }).code;
    return typeof code === "string" ? { message: issue.message, path, code } : { message: issue.message, path };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return typeof (value as { then?: unknown } | null)?.then === "function";
}
