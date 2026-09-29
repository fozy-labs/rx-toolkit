import type { StandardSchemaV1 } from "@/common/standard-schema";

// ==================== Policies ====================

/** When the errors of a node become visible (`visibleErrors$` / `visibleWarnings$`). */
export type ShowErrors = "touched" | "modified" | "submitted" | "always";

/** What `submit()` does while queries are in flight or debouncing. */
export type PendingQueries = "wait" | "ignore" | "reject";

/** The outcome of the last submit attempt, `"submitting"` while one runs. */
export type SubmitStatus = "idle" | "invalid" | "submitting" | "error" | "success";

/** Options of `initialize()`. `keepDirtyLists` defaults to `keepDirtyValues`. */
export interface InitializeOptions {
    keepDirtyValues?: boolean;
    keepDirtyLists?: boolean;
}

// ==================== Schema ====================

/** The input type of a Standard Schema: what a field edits. `unknown` for schemas without `types`. */
export type SchemaInput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["input"];

/** The output type of a Standard Schema: what a parsed field holds. */
export type SchemaOutput<S extends StandardSchemaV1> = NonNullable<S["~standard"]["types"]>["output"];

/** The schema result of a node: the output once every schema on the way passes. */
export type Parsed<Output> = { isParsed: true; value: Output } | { isParsed: false; value: undefined };

/** {@link Parsed} narrowed to the parsed case, as `SubmitCtx.parsed$` returns it. */
export type ParsedOk<Output> = { isParsed: true; value: Output };

// ==================== Names ====================

/**
 * Names of children, rules, `computed` and `queries` that break the source string and devtools
 * paths: a trailing `$` (reserved for the instance aliases), a `.` or a `/`.
 */
export type InvalidName = `${string}$` | `${string}.${string}` | `${string}/${string}`;

/** Type-level error shown on a member with an {@link InvalidName}. */
export type InvalidNameError = "Error: a form name must not end with `$` or contain `.` or `/`";

// ==================== Helpers ====================

/** The values a query key returns to stay idle, besides `SKIP`. */
export type Falsy = false | 0 | 0n | "" | null | undefined;

/**
 * Blocks inference through `T` (native `NoInfer` needs TS 5.4; the consumer minimum is 4.7).
 * Used by the definition checks, so they read the inferred types without taking part in inference.
 */
export type NoInference<T> = [T][T extends any ? 0 : never];

/** Collapses an intersection of object types into one object type. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};
