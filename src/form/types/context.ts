import type { ReadonlySignal } from "@/signals/types";

import type { Parsed, ParsedOk } from "./common";
import type { IssueOptions } from "./issue";
import type { ComputedSignals } from "./node";
import type { QueryViews } from "./query";

// Callbacks see only inputs, never verdicts. A view is the read-only input side of a node:
// `value$`, `parsed$`, nested `fields`, `items$` and `get$`, without actions and without
// `isValid$`, `issues$`, `state$` or the other verdicts.

// ==================== Views ====================

/** The inputs every view has. */
export interface NodeView<Value = unknown, Output = unknown> {
    readonly value$: ReadonlySignal<Value>;
    readonly parsed$: ReadonlySignal<Parsed<Output>>;
}

export type FieldView<Input, Output> = NodeView<Input, Output>;

/** A group view. `Vw` maps child names to child views. */
export interface GroupView<Vw, Value, Output> extends NodeView<Value, Output> {
    readonly fields: Vw;
}

/** A list item as a view: the item's view with its stable key. */
export type ItemView<ItemVw> = ItemVw & { readonly key: string };

export interface ListView<ItemVw, Value, Output> extends NodeView<Value, Output> {
    readonly items$: ReadonlySignal<ItemView<ItemVw>[]>;
    readonly get$: (key: string) => ItemView<ItemVw> | undefined;
}

// ==================== Collectors ====================

/**
 * `error` / `warn` of a rule. Without a node the issue goes to the node the rule is declared on
 * (at the root it is a form error); with a node, to that node of the rule's subtree.
 */
export interface IssueCollector {
    (message: string, options?: IssueOptions): void;
    (node: NodeView, message: string, options?: IssueOptions): void;
}

export interface IssueCollectors {
    readonly error: IssueCollector;
    readonly warn: IssueCollector;
}

// ==================== Contexts ====================

/** The read-only instance context, in every callback. */
export interface ContextView<Context> {
    readonly context$: ReadonlySignal<Context>;
}

/** Context of a field `queries` key. */
export interface FieldQueryCtx<Input, Output, Context> extends NodeView<Input, Output>, ContextView<Context> {}

/** Context of a field `validate` rule. */
export interface FieldValidateCtx<Input, Output, Q, Context>
    extends FieldQueryCtx<Input, Output, Context>, IssueCollectors {
    readonly queries: QueryViews<Q>;
}

/** Context of a group `computed` member. */
export interface GroupComputedCtx<Vw, Value, Output, Context> extends NodeView<Value, Output>, ContextView<Context> {
    readonly fields: Vw;
}

/** Context of a group `queries` key: sees the group's `computed`. */
export interface GroupQueryCtx<Vw, Value, Output, C, Context> extends GroupComputedCtx<Vw, Value, Output, Context> {
    readonly computed: ComputedSignals<C>;
}

/** Context of a `disabled` predicate: the children's inputs only (the group's own value depends on it). */
export interface GroupDisabledCtx<Vw, Context> extends ContextView<Context> {
    readonly fields: Vw;
}

/** Context of a group `validate` rule. */
export interface GroupValidateCtx<Vw, Value, Output, C, Q, Context>
    extends GroupQueryCtx<Vw, Value, Output, C, Context>, IssueCollectors {
    readonly queries: QueryViews<Q>;
}

/** Context of a list `validate` rule. */
export interface ListValidateCtx<ItemVw, Value, Output, Context>
    extends ListView<ItemVw, Value, Output>, ContextView<Context>, IssueCollectors {}

/** Context of the root `submit` handler: runs only once the form is parsed, hence the narrowed `parsed$`. */
export interface SubmitCtx<Vw, Value, Output, C, Q, Context> extends ContextView<Context> {
    readonly fields: Vw;
    readonly value$: ReadonlySignal<Value>;
    readonly parsed$: ReadonlySignal<ParsedOk<Output>>;
    readonly computed: ComputedSignals<C>;
    readonly queries: QueryViews<Q>;
}
