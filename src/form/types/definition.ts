import type { StandardSchemaV1 } from "@/common/standard-schema";
import type { TBoundCommand } from "@/query/types";

import type {
    InvalidName,
    InvalidNameError,
    NoInference,
    PendingQueries,
    SchemaInput,
    SchemaOutput,
    ShowErrors,
    Simplify,
} from "./common";
import type {
    FieldQueryCtx,
    FieldValidateCtx,
    FieldView,
    GroupComputedCtx,
    GroupDisabledCtx,
    GroupQueryCtx,
    GroupValidateCtx,
    GroupView,
    ListValidateCtx,
    ListView,
    SubmitCtx,
} from "./context";
import type { IssueInput } from "./issue";
import type { FieldNode, FormRootNode, GroupNode, ListNode, SubmissionState } from "./node";
import type { QueryEntry } from "./query";

// A definition carries the types of its instance as phantom members (`__node`, `__view`, ...):
// they exist only in the types, never at runtime. `g()` / `l()` compose them from the children
// once per call, so no type is recomputed on every access.

// ==================== Context requirement ====================

/** What `FormSignal.context<T>()` returns: declares that a definition reads a context of type `T`. */
export interface FormContextToken<T> {
    readonly kind: "context";
    /** Phantom. */
    readonly __context: T;
}

// ==================== Definitions ====================

/** Phantom members of every definition. */
export interface Definition<Node, View, Input, Output, Initial, Context> {
    readonly kind: "field" | "group" | "list";
    readonly __node: Node;
    readonly __view: View;
    readonly __input: Input;
    readonly __output: Output;
    readonly __initial: Initial;
    /** The context the instance must provide: the own declaration, else the children's. */
    readonly __context: Context;
    /** `true` for a group with root-only options (`name`, `submit`, `mapSubmitError`, `pendingQueries`). */
    readonly __rootOnly: boolean;
}

export type AnyDef = Definition<any, any, any, any, any, any>;

/** A field definition. `Q` maps query names to their bound resources. */
export interface FieldDef<Input, Output = Input, Q = unknown, Context = unknown> extends Definition<
    FieldNode<Input, Output, Q>,
    FieldView<Input, Output>,
    Input,
    Output,
    Input,
    Context
> {
    readonly kind: "field";
    readonly __rootOnly: false;
}

/**
 * A group definition. `F` maps child names to child definitions; `DK` are the children listed in
 * `disabled`; `Submit` is what `submit` returns.
 */
export interface GroupDef<
    F extends Children,
    C,
    Q,
    DK extends PropertyKey,
    Context,
    Submit,
    RootOnly extends boolean,
> extends Definition<
    GroupNode<NodesOf<F>, GroupInput<F, DK>, GroupOutput<F, DK>, C, Q, GroupInitial<F>>,
    GroupView<ViewsOf<F>, GroupInput<F, DK>, GroupOutput<F, DK>>,
    GroupInput<F, DK>,
    GroupOutput<F, DK>,
    GroupInitial<F>,
    Context
> {
    readonly kind: "group";
    readonly __rootOnly: RootOnly;
    /** Phantom: the instance created from this definition as the root. */
    readonly __instance: FormRootNode<
        NodesOf<F>,
        GroupInput<F, DK>,
        GroupOutput<F, DK>,
        C,
        Q,
        GroupInitial<F>,
        Context,
        SubmissionOf<Submit>
    >;
}

/** A list definition over an item definition `Item`. */
export interface ListDef<Item extends AnyItemDef, Context = unknown> extends Definition<
    ListNode<Item["__node"], Item["__input"][], Item["__output"][], Item["__initial"]>,
    ListView<Item["__view"], Item["__input"][], Item["__output"][]>,
    Item["__input"][],
    Item["__output"][],
    Item["__initial"][],
    Context
> {
    readonly kind: "list";
    readonly __rootOnly: false;
}

export type AnyFieldDef = FieldDef<any, any, any, any>;
export type AnyGroupDef = GroupDef<any, any, any, any, any, any, boolean>;
export type AnyListDef = ListDef<any, any>;
/** What a list item can be. */
export type AnyItemDef = AnyFieldDef | AnyGroupDef;

// ==================== Composition ====================

/** The children of a group: names to definitions. */
export type Children = Record<string, AnyDef>;

// Module-local, so a consumer's declaration inlines them (see `types/index.ts`).
type NodesOf<F extends Children> = { [K in keyof F]: F[K]["__node"] };
type ViewsOf<F extends Children> = { [K in keyof F]: F[K]["__view"] };
type GroupInitial<F extends Children> = { [K in keyof F]?: F[K]["__initial"] };

/** The value of a group: children listed in `disabled` (`DK`) are optional. */
type GroupInput<F extends Children, DK extends PropertyKey> = WithOptionalKeys<{ [K in keyof F]: F[K]["__input"] }, DK>;

type GroupOutput<F extends Children, DK extends PropertyKey> = WithOptionalKeys<
    { [K in keyof F]: F[K]["__output"] },
    DK
>;

type DefSlot<D, K extends keyof AnyDef> = D extends AnyDef ? D[K] : never;

/** Makes the `K` keys of `T` optional; `T` itself when `K` is `never`. */
export type WithOptionalKeys<T, K extends PropertyKey> = [K] extends [never]
    ? T
    : Simplify<
          { [P in keyof T as P extends K ? never : P]: T[P] } & { [P in keyof T as P extends K ? P : never]?: T[P] }
      >;

/** The context requirement of a group: its own declaration, else the intersection of the children's. */
export type ContextRequirement<Own, F> = unknown extends Own ? ChildrenContext<F> : Own;

/** The intersection of the children's context requirements; `unknown` when none has one. */
export type ChildrenContext<F> = {
    [K in keyof F]: (context: DefSlot<F[K], "__context">) => void;
}[keyof F] extends (context: infer C) => void
    ? C
    : never;

// ==================== Checks ====================

export type RootOnlyChildError =
    "Error: a nested group must not have root-only options (name, submit, mapSubmitError, pendingQueries)";

export type ContextMismatchError = "Error: the declared context does not satisfy the children's context requirements";

/** Per-child checks of `fields`: names and root-only options. */
export type FieldsCheck<F> = {
    [
        K in keyof F as K extends InvalidName ? K : F[K] extends { readonly __rootOnly: true } ? K : never
    ]: K extends InvalidName ? InvalidNameError : RootOnlyChildError;
};

/** A declared context must satisfy every child's requirement. */
export type ContextCheck<Own, Required> = [Own] extends [Required]
    ? unknown
    : { readonly [K in ContextMismatchError]: Required };

// ==================== Options ====================

/** A rule: the short form (named after the node), or a record of named rules. */
export type RuleOption<V extends string, Ctx> =
    ((ctx: Ctx) => void) | { [K in V]: K extends InvalidName ? InvalidNameError : (ctx: Ctx) => void };

export interface FieldOptions<S extends StandardSchemaV1, Q, V extends string, Context> {
    schema: S;
    defaultValue: SchemaInput<S>;
    /** Only sets `isRequired`: produces no issues. */
    required?: boolean;
    /** Defaults to `Object.is`. */
    equals?: (a: SchemaInput<S>, b: SchemaInput<S>) => boolean;
    showErrors?: ShowErrors;
    context?: FormContextToken<Context>;
    queries?: {
        [K in keyof Q]: QueryEntry<K, FieldQueryCtx<SchemaInput<S>, SchemaOutput<S>, Context>, Q[K]>;
    };
    validate?: RuleOption<V, FieldValidateCtx<SchemaInput<S>, SchemaOutput<S>, Q, Context>>;
}

/** What `submit` returns: a bound command, or a promise wrapped into an internal command. */
export type SubmitResult = TBoundCommand<any, any, any> | PromiseLike<unknown>;

/** The error `mapSubmitError` receives for a `submit` result. */
export type SubmitErrorOf<Submit> = Submit extends TBoundCommand<any, any, infer E> ? E : unknown;

/** `submission$` of the root (without `null`) for a `submit` result; `never` without `submit`. */
export type SubmissionOf<Submit> =
    Submit extends TBoundCommand<infer A, infer D, infer E>
        ? SubmissionState<A, D, E>
        : Submit extends PromiseLike<infer D>
          ? SubmissionState<unknown, D, unknown>
          : never;

/**
 * Options of `g()`. Context-sensitive members go in the order `computed` → `queries` →
 * `validate` / `disabled` → `submit` → `mapSubmitError`: each context is built from the members
 * before it. `name`, `submit`, `mapSubmitError` and `pendingQueries` are root-only.
 *
 * `TError` is the error `mapSubmitError` receives: the error of the bound command for `g()`,
 * the error type of the api for `api.defineForm`.
 */
export interface GroupOptions<
    F extends Children,
    C,
    Q,
    V extends string,
    DK extends keyof F,
    Context,
    Name extends string,
    Submit,
    Pending extends PendingQueries,
    Mapped,
    TError,
> {
    /** Root only: the default instance key and the label of root short-form issues. Default `"root"`. */
    name?: Name;
    fields: F & FieldsCheck<NoInference<F>>;
    showErrors?: ShowErrors;
    context?: FormContextToken<Context> & ContextCheck<NoInference<Context>, ChildrenContext<NoInference<F>>>;
    computed?: {
        [K in keyof C]: K extends InvalidName
            ? InvalidNameError
            : (ctx: GroupComputedCtx<ViewsOf<F>, GroupInput<F, DK>, GroupOutput<F, DK>, Context>) => C[K];
    };
    queries?: {
        [K in keyof Q]: QueryEntry<
            K,
            GroupQueryCtx<ViewsOf<F>, GroupInput<F, DK>, GroupOutput<F, DK>, C, Context>,
            Q[K]
        >;
    };
    validate?: RuleOption<V, GroupValidateCtx<ViewsOf<F>, GroupInput<F, DK>, GroupOutput<F, DK>, C, Q, Context>>;
    /** A disabled child is left out of the group's value, output and aggregates. */
    disabled?: { [K in DK]?: (ctx: GroupDisabledCtx<ViewsOf<F>, Context>) => boolean };
    /** Root only. */
    submit?: (ctx: SubmitCtx<ViewsOf<F>, GroupInput<F, DK>, GroupOutput<F, DK>, C, Q, Context>) => Submit;
    /** Root only. */
    mapSubmitError?: (error: TError) => Mapped;
    /** Root only. Default `"wait"`. */
    pendingQueries?: Pending;
}

/** Whether a group is root-only: any of its root-only options is set. */
export type IsRootOnly<Name, Submit, Pending, Mapped> = [Name | Submit | Pending | Mapped] extends [never]
    ? false
    : true;

export type ItemError = "Error: a list item must be a field or a group without root-only options";

export interface ListOptions<Item extends AnyItemDef, V extends string, Context> {
    item: Item & (Item["__rootOnly"] extends true ? ItemError : unknown);
    /** Default `[]`. */
    defaultValue?: DefSlot<NoInference<Item>, "__input">[];
    showErrors?: ShowErrors;
    context?: FormContextToken<Context> & ContextCheck<NoInference<Context>, DefSlot<NoInference<Item>, "__context">>;
    validate?: RuleOption<V, ListValidateCtx<Item["__view"], Item["__input"][], Item["__output"][], Context>>;
}

/** What `mapSubmitError` returns. */
export type MappedIssues = ReadonlyArray<IssueInput>;
