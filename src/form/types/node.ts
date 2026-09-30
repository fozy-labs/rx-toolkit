import type { TCommandClutchState } from "@/query/types";
import type { ReadonlySignal } from "@/signals/types";

import type { InitializeOptions, Parsed, SubmitStatus } from "./common";
import type { Issue } from "./issue";
import type { QueryNodes } from "./query";

// ==================== Snapshots ====================

/** `state$` of a field. Every key is also a member of the field node. */
export interface FieldState<Input, Output = unknown> {
    value: Input;
    parsed: Parsed<Output>;
    visibleErrors: Issue[];
    visibleWarnings: Issue[];
    isValid: boolean;
    isPending: boolean;
    isFocused: boolean;
    isTouched: boolean;
    isModified: boolean;
    isDirty: boolean;
    isRequired: boolean;
    isDisabled: boolean;
}

/** `state$` of a group: scalars only, no values. */
export interface GroupState {
    isValid: boolean;
    isPending: boolean;
    isTouched: boolean;
    isModified: boolean;
    isDirty: boolean;
    hasVisibleErrors: boolean;
    visibleErrorCount: number;
    isDisabled: boolean;
}

/** `state$` of a list: the group meta and `items`, the same array as `items$()`. */
export interface ListState<Item extends AnyNode = AnyNode> extends GroupState {
    items: ItemNode<Item>[];
}

/** `state$` of the root: the group meta and the submit state. */
export interface FormState extends GroupState {
    status: SubmitStatus;
    isSubmitting: boolean;
    submitCount: number;
    canSubmit: boolean;
}

// ==================== Nodes ====================

/** Members every node has: the issue aggregates, the flags and the cascading actions. */
export interface NodeBase {
    readonly issues$: ReadonlySignal<Issue[]>;
    readonly errors$: ReadonlySignal<Issue[]>;
    readonly warnings$: ReadonlySignal<Issue[]>;
    readonly visibleErrors$: ReadonlySignal<Issue[]>;
    readonly visibleWarnings$: ReadonlySignal<Issue[]>;
    readonly isValid$: ReadonlySignal<boolean>;
    readonly isPending$: ReadonlySignal<boolean>;
    readonly isTouched$: ReadonlySignal<boolean>;
    readonly isModified$: ReadonlySignal<boolean>;
    readonly isDirty$: ReadonlySignal<boolean>;
    readonly isDisabled$: ReadonlySignal<boolean>;
    readonly markTouched: (touched?: boolean) => void;
    readonly reset: () => void;
}

/** Any node of an instance. */
export type AnyNode = FieldNode<any, any, any> | GroupNode<any, any, any, any, any, any> | ListNode<any, any, any, any>;

/** A field node. `Q` maps query names to their bound resources. */
export interface FieldNode<Input, Output = unknown, Q = unknown> extends NodeBase {
    readonly state$: ReadonlySignal<FieldState<Input, Output>>;
    readonly value$: ReadonlySignal<Input>;
    readonly parsed$: ReadonlySignal<Parsed<Output>>;
    readonly isFocused$: ReadonlySignal<boolean>;
    readonly isRequired: boolean;
    readonly queries: QueryNodes<Q>;
    readonly set: (value: Input) => void;
    readonly focus: () => void;
    readonly blur: () => void;
}

/**
 * The children of a group node and the `<name>$` aliases of their `state$`. Module-local, so a
 * consumer's declaration inlines it (see `types/index.ts`).
 */
type NodeFields<N extends NodeRecord> = N & { readonly [K in keyof N as `${K & string}$`]: N[K]["state$"] };

/** Children of a group node: names to nodes. */
export type NodeRecord = Record<string, AnyNode>;

/** `computed` of a node: `<k>$` signals, `undefined` until the first successful run. */
export type ComputedSignals<C> = {
    readonly [K in keyof C as `${K & string}$`]: ReadonlySignal<C[K] | undefined>;
};

/** Members of a group node and of the root. */
export interface GroupNodeBase<N extends NodeRecord, Value, Output, C, Q> extends NodeBase {
    readonly fields: NodeFields<N>;
    readonly value$: ReadonlySignal<Value>;
    readonly parsed$: ReadonlySignal<Parsed<Output>>;
    readonly computed: ComputedSignals<C>;
    readonly queries: QueryNodes<Q>;
    /** Issues of the group itself: its rules, `callback` issues, server issues without a path into a descendant. */
    readonly ownIssues$: ReadonlySignal<Issue[]>;
}

/**
 * A group node. `N` maps child names to child nodes; `Initial` is what `initialize` accepts
 * (`never` by default, so any group node fits).
 */
export interface GroupNode<
    N extends NodeRecord = NodeRecord,
    Value = unknown,
    Output = unknown,
    C = unknown,
    Q = unknown,
    Initial = never,
> extends GroupNodeBase<N, Value, Output, C, Q> {
    readonly state$: ReadonlySignal<GroupState>;
    readonly initialize: (data?: { state?: Initial }, options?: InitializeOptions) => void;
}

/** A list item node: the item's field or group node with its stable key. */
export type ItemNode<Item extends AnyNode = AnyNode> = Item & { readonly key: string };

/** How list actions address an item: its key, its index or the item node. */
export type ItemRef = string | number | { readonly key: string };

/** A list node. `Initial` is what `push` / `insert` accept (`never` by default, so any list node fits). */
export interface ListNode<
    Item extends AnyNode = AnyNode,
    Value = unknown,
    Output = unknown,
    Initial = never,
> extends NodeBase {
    readonly state$: ReadonlySignal<ListState<Item>>;
    readonly value$: ReadonlySignal<Value>;
    readonly parsed$: ReadonlySignal<Parsed<Output>>;
    readonly ownIssues$: ReadonlySignal<Issue[]>;
    /** Wakes up only on add / remove / reorder. */
    readonly items$: ReadonlySignal<ItemNode<Item>[]>;
    readonly get$: (key: string) => ItemNode<Item> | undefined;
    readonly push: (initial?: Initial) => ItemNode<Item>;
    readonly insert: (index: number, initial?: Initial) => ItemNode<Item>;
    readonly remove: (item: ItemRef) => void;
    readonly move: (item: ItemRef, to: number) => void;
    readonly swap: (a: ItemRef, b: ItemRef) => void;
    readonly clear: () => void;
}

// ==================== Root ====================

/** A command clutch state without `retry`, per union member: retries go through `submit()`. */
export type SubmissionState<TArgs = unknown, TData = unknown, TError = unknown> =
    TCommandClutchState<TArgs, TData, TError> extends infer S ? (S extends unknown ? Omit<S, "retry"> : never) : never;

/**
 * The root of an instance: a group with the instance context and the submit state. `Submission`
 * is the type of `submission$` without `null`.
 */
export interface FormRootNode<
    N extends NodeRecord = NodeRecord,
    Value = unknown,
    Output = unknown,
    C = unknown,
    Q = unknown,
    Initial = never,
    Context = unknown,
    Submission = SubmissionState,
> extends GroupNodeBase<N, Value, Output, C, Q> {
    readonly state$: ReadonlySignal<FormState>;
    readonly context$: ReadonlySignal<Context>;
    readonly initialize: (data?: { state?: Initial; context?: Context }, options?: InitializeOptions) => void;
    /** Resolves `true` on success; never rejects, except for configuration errors. */
    readonly submit: (options?: { force?: boolean }) => Promise<boolean>;
    /** `null` until an attempt reaches a command, and again after the submit state is reset. */
    readonly submission$: ReadonlySignal<Submission | null>;
    readonly isSubmitting$: ReadonlySignal<boolean>;
    readonly status$: ReadonlySignal<SubmitStatus>;
    /** Every entry into `submit()`; monotonic. */
    readonly submitAttempts$: ReadonlySignal<number>;
    /** Attempts that reached the command; monotonic. */
    readonly submitCount$: ReadonlySignal<number>;
    /** `!isSubmitting$`, without `isValid$` and `isPending$`. */
    readonly canSubmit$: ReadonlySignal<boolean>;
    /** The key of the command entry `submission$` mirrors. */
    readonly entryKey: string;
    /** Removes every server issue in the tree. */
    readonly clearIssues: () => void;
}
