import type { StandardSchemaV1Issue } from "@/common/standard-schema";
import { untracked } from "@/signals/base/untracked";

import type { Issue, IssueInput } from "../../types";
import { normalizeIssue } from "../validation/parse";

/** The message of the built-in mapper for an error it cannot read. */
export const UNKNOWN_SUBMIT_ERROR = "The form could not be submitted";

const SERVER_SOURCE = Object.freeze({ type: "server" as const });

/**
 * The server issues of a failed submit: `mapSubmitError` (the definition's, else the plugin's),
 * else the built-in mapper. A mapper that throws or returns something other than issue inputs is
 * reported and replaced by the built-in one. The form sets `source`; `severity` defaults to
 * `"error"`.
 */
export function toServerIssues(error: unknown, mapSubmitError: ((error: unknown) => unknown) | undefined): Issue[] {
    if (mapSubmitError) {
        try {
            const inputs = untracked(() => mapSubmitError(error));
            if (!Array.isArray(inputs)) throw new TypeError("mapSubmitError must return an array of issues");
            return inputs.map(toServerIssue);
        } catch (failure) {
            console.error(
                "[rx-toolkit] mapSubmitError threw; falling back to the built-in mapper of unstable_FormSignal.",
                failure,
            );
        }
    }
    return defaultSubmitIssues(error).map(toServerIssue);
}

/**
 * The built-in mapper: `issues` in the Standard Schema shape are laid out by path; otherwise a
 * non-empty string `message` becomes one form issue; otherwise one form issue with a fixed
 * message and `code: "unknown"`. Every issue has severity `"error"`.
 */
export function defaultSubmitIssues(error: unknown): IssueInput[] {
    const issues = readKey(error, "issues");
    if (Array.isArray(issues) && issues.length > 0 && issues.every(isSchemaIssue)) {
        return issues.map((issue) => {
            const { message, path, code } = normalizeIssue(issue);
            return code === undefined ? { path, message } : { path, message, code };
        });
    }
    const message = readKey(error, "message");
    if (typeof message === "string" && message !== "") return [{ message }];
    return [{ message: UNKNOWN_SUBMIT_ERROR, code: "unknown" }];
}

function toServerIssue(input: IssueInput): Issue {
    if (typeof input !== "object" || input === null || typeof input.message !== "string") {
        throw new TypeError("an issue returned by mapSubmitError must be an object with a string message");
    }
    const issue: Issue = {
        path: Array.isArray(input.path) ? input.path : [],
        message: input.message,
        severity: input.severity === "warning" ? "warning" : "error",
        source: SERVER_SOURCE,
    };
    if (typeof input.code === "string") issue.code = input.code;
    return issue;
}

function readKey(value: unknown, key: string): unknown {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function isSchemaIssue(value: unknown): value is StandardSchemaV1Issue {
    if (typeof value !== "object" || value === null) return false;
    const { message, path } = value as { message?: unknown; path?: unknown };
    return typeof message === "string" && (path === undefined || Array.isArray(path));
}
