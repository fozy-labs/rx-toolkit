/**
 * The Standard Schema V1 interface (https://standardschema.dev), vendored as
 * the spec recommends instead of depending on `@standard-schema/spec`.
 * Implemented by zod (v3.24+ / v4), valibot, arktype, effect/schema and others,
 * so any of them can be passed wherever this type is accepted.
 *
 * The spec's `StandardSchemaV1.*` namespace members are flattened into
 * `StandardSchemaV1*` names; the shapes are identical, and compatibility is
 * structural, so vendor schemas typed against the original spec still fit.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

export interface StandardSchemaV1Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
    readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

export type StandardSchemaV1Result<Output> = StandardSchemaV1SuccessResult<Output> | StandardSchemaV1FailureResult;

export interface StandardSchemaV1SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
}

export interface StandardSchemaV1FailureResult {
    readonly issues: ReadonlyArray<StandardSchemaV1Issue>;
}

export interface StandardSchemaV1Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | StandardSchemaV1PathSegment> | undefined;
}

export interface StandardSchemaV1PathSegment {
    readonly key: PropertyKey;
}

export interface StandardSchemaV1Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
}
