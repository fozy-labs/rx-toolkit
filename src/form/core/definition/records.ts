import type { StandardSchemaV1 } from "@/common/standard-schema";
import type { IApi } from "@/query/types";

import type { AnyDef, FormContextToken, PendingQueries, ShowErrors } from "../../types";

// The runtime side of a definition. The public types expose only `kind` and the phantom
// members; the instance reads the normalized options through `getDefinitionRecord`.

type Callback = (ctx: any) => unknown;

/** A `queries` entry, normalized: `debounce` is `null` for the function form. */
export interface QueryRecord {
    readonly key: Callback;
    readonly debounce: number | null;
}

/** A rule; `name` is `null` for the short form, which takes the node's name. */
export interface RuleRecord {
    readonly name: string | null;
    readonly fn: Callback;
}

interface RecordBase {
    readonly showErrors: ShowErrors | undefined;
    /** Whether the definition declares a context requirement. */
    readonly hasContext: boolean;
    readonly rules: readonly RuleRecord[];
}

export interface FieldRecord extends RecordBase {
    readonly kind: "field";
    readonly schema: StandardSchemaV1;
    readonly defaultValue: unknown;
    readonly required: boolean;
    readonly equals: ((a: unknown, b: unknown) => boolean) | undefined;
    readonly queries: Readonly<Record<string, QueryRecord>>;
}

export interface GroupRecord extends RecordBase {
    readonly kind: "group";
    readonly fields: Readonly<Record<string, DefinitionRecord>>;
    readonly computed: Readonly<Record<string, Callback>>;
    readonly queries: Readonly<Record<string, QueryRecord>>;
    readonly disabled: Readonly<Record<string, Callback>>;
    /** Whether a root-only option is set: such a group cannot be nested. */
    readonly rootOnly: boolean;
    readonly name: string | undefined;
    readonly submit: Callback | undefined;
    /** The own `mapSubmitError`, else the default of the plugin that defined the form. */
    readonly mapSubmitError: ((error: unknown) => unknown) | undefined;
    readonly pendingQueries: PendingQueries | undefined;
    /** The api of `api.defineForm`: the command of a promise `submit` is created on it. */
    readonly api: IApi | undefined;
    /** Plugin members of every instance this definition is the root of. */
    readonly instanceMembers: InstanceMembers | undefined;
}

/** Property descriptors a plugin adds to a root instance before it is frozen; getters may be lazy. */
export type InstanceMembers = (instance: object) => PropertyDescriptorMap;

export interface ListRecord extends RecordBase {
    readonly kind: "list";
    readonly item: FieldRecord | GroupRecord;
    readonly defaultValue: readonly unknown[];
}

export type DefinitionRecord = FieldRecord | GroupRecord | ListRecord;

const definitions = new WeakSet<object>();
const contextTokens = new WeakSet<object>();

/** Freezes and registers a definition record; the record is the definition object itself. */
export function registerDefinition<R extends DefinitionRecord>(record: R): R {
    Object.freeze(record);
    definitions.add(record);
    return record;
}

export function isDefinition(value: unknown): value is DefinitionRecord {
    return typeof value === "object" && value !== null && definitions.has(value);
}

/** The runtime record of a definition created by `field()` / `group()` / `list()`. */
export function getDefinitionRecord(definition: AnyDef): DefinitionRecord {
    return definition as unknown as DefinitionRecord;
}

export function createContextToken<T>(): FormContextToken<T> {
    const token = Object.freeze({ kind: "context" as const });
    contextTokens.add(token);
    return token as FormContextToken<T>;
}

export function isContextToken(value: unknown): boolean {
    return typeof value === "object" && value !== null && contextTokens.has(value);
}
