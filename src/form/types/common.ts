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
