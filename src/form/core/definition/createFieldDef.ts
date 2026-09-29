import type { StandardSchemaV1 } from "@/common/standard-schema";

import { FormConfigError } from "../FormConfigError";

import {
    assertFunction,
    assertOptions,
    checkContext,
    checkQueries,
    checkRules,
    checkShowErrors,
    describeValue,
} from "./checks";
import { registerDefinition, type FieldRecord } from "./records";

const FIELD_OPTIONS = [
    "schema",
    "defaultValue",
    "required",
    "equals",
    "showErrors",
    "context",
    "queries",
    "validate",
] as const;

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
    const props: unknown = (value as Record<string, unknown>)["~standard"];
    return (
        typeof props === "object" && props !== null && typeof (props as { validate?: unknown }).validate === "function"
    );
}

export function createFieldDef(input: unknown): FieldRecord {
    const options = assertOptions(input, FIELD_OPTIONS, "field");
    if (!isStandardSchema(options.schema)) {
        throw new FormConfigError("schema", `must be a Standard Schema (got ${describeValue(options.schema)})`);
    }
    if (!("defaultValue" in options)) {
        throw new FormConfigError("defaultValue", "is required");
    }
    if (options.required !== undefined && typeof options.required !== "boolean") {
        throw new FormConfigError("required", `must be a boolean (got ${describeValue(options.required)})`);
    }
    return registerDefinition<FieldRecord>({
        kind: "field",
        schema: options.schema,
        defaultValue: options.defaultValue,
        required: options.required === true,
        equals: options.equals === undefined ? undefined : assertFunction(options.equals, "equals"),
        showErrors: checkShowErrors(options.showErrors, "showErrors"),
        hasContext: checkContext(options.context, "context"),
        queries: checkQueries(options.queries, "queries"),
        rules: checkRules(options.validate, "validate"),
    });
}
