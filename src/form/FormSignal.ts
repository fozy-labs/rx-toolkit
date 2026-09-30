import type { StandardSchemaV1 } from "@/common/standard-schema";

import { createInstance } from "./core/createInstance";
import { createFieldDef } from "./core/definition/createFieldDef";
import { createGroupDef } from "./core/definition/createGroupDef";
import { createListDef } from "./core/definition/createListDef";
import { createContextToken } from "./core/definition/records";
import type {
    AnyGroupDef,
    AnyItemDef,
    Children,
    ContextRequirement,
    FieldDef,
    FieldOptions,
    FormContextToken,
    FormInitArgs,
    FormInstance,
    GroupDef,
    GroupOptions,
    IsRootOnly,
    ListDef,
    ListOptions,
    MappedIssues,
    PendingQueries,
    SubmitResult,
} from "./types";
import type { SchemaInput, SchemaOutput } from "./types/common";
import type { SubmitErrorOf } from "./types/definition";

/**
 * The form primitives: the definition builders `field` / `group` / `list`, the context
 * declaration and `state()`, which creates an instance from a root definition.
 */
export class unstable_FormSignal {
    /** A field definition. The input and output types come from `schema`. */
    static field<S extends StandardSchemaV1, Q, V extends string, Context = unknown>(
        options: FieldOptions<S, Q, V, Context>,
    ): FieldDef<SchemaInput<S>, SchemaOutput<S>, Q, Context> {
        return createFieldDef(options) as unknown as FieldDef<SchemaInput<S>, SchemaOutput<S>, Q, Context>;
    }

    /** A group definition; also the root of a form. */
    static group<
        F extends Children,
        C,
        Q,
        V extends string,
        DK extends keyof F = never,
        Context = unknown,
        Name extends string = never,
        Submit extends SubmitResult = never,
        Pending extends PendingQueries = never,
        Mapped extends MappedIssues = never,
    >(
        options: GroupOptions<F, C, Q, V, DK, Context, Name, Submit, Pending, Mapped, SubmitErrorOf<Submit>>,
    ): GroupDef<F, C, Q, DK, ContextRequirement<Context, F>, Submit, IsRootOnly<Name, Submit, Pending, Mapped>> {
        return createGroupDef(options) as unknown as GroupDef<
            F,
            C,
            Q,
            DK,
            ContextRequirement<Context, F>,
            Submit,
            IsRootOnly<Name, Submit, Pending, Mapped>
        >;
    }

    /** A list definition: a keyed array of `item` nodes. */
    static list<Item extends AnyItemDef, V extends string, Context = unknown>(
        options: ListOptions<Item, V, Context>,
    ): ListDef<Item, ContextRequirement<Context, { item: Item }>> {
        return createListDef(options) as unknown as ListDef<Item, ContextRequirement<Context, { item: Item }>>;
    }

    /** Declares that a definition reads the instance context, and its type. */
    static context<T>(): FormContextToken<T> {
        return createContextToken<T>();
    }

    /** Creates an instance from a root definition. */
    static state<D extends AnyGroupDef>(definition: D, ...init: FormInitArgs<D>): FormInstance<D> {
        return createInstance(definition, init[0]) as FormInstance<D>;
    }
}
