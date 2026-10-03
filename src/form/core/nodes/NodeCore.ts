import { Signal } from "@/signals/signals/Signal";
import type { DisposableSignal, ReadonlySignal, SignalComputeOptions } from "@/signals/types";

import type { Issue, IssuePath, Parsed, ShowErrors } from "../../types";
import type { AttemptSnapshot } from "../submit/snapshot";
import type { RuleSignal } from "../validation/rules";

// The runtime side of a node. A core owns the signals and the internal actions; its public
// node (`core.node`) is the frozen object the user sees. Parents read their children through
// this interface only, so a list plugs into group aggregation by implementing it.

/** What every node of one instance shares. */
export interface InstanceScope {
    /** The devtools key of the instance; nodes add their path to it. */
    readonly key: string;
    /** The root `name`: the source name of root short-form rules. */
    readonly rootName: string;
    readonly context$: ReadonlySignal<unknown>;
    /**
     * Counts the `initialize()` calls that wrote bases. A submit captures it when the command
     * starts; on success each group skips its subtree's commit if its own `initialize()` wrote
     * after that: the new base wins over what was sent.
     */
    readonly bases: { generation: number };
}

export interface ReinitOptions {
    readonly keepDirtyValues: boolean;
    /** A list with a dirty structure keeps it and defers the reinit data to its `reset()`. */
    readonly keepDirtyLists: boolean;
}

export interface NodeCore {
    readonly kind: "field" | "group" | "list";
    readonly scope: InstanceScope;
    readonly parent: ParentCore | null;
    /** Static position: child names from the root. Devtools keys, sources and config paths. */
    readonly segments: readonly string[];
    /** The issue path, read reactively: a list item's index can change. */
    readonly path$: ReadonlySignal<IssuePath>;
    /** The effective `showErrors` policy. */
    readonly showErrors: ShowErrors;
    /** Rules declared on this node; they address this node and its subtree. */
    readonly rules: readonly RuleSignal[];
    /** The public node. */
    readonly node: object;

    readonly value$: ReadonlySignal<unknown>;
    readonly parsed$: ReadonlySignal<Parsed<unknown>>;
    readonly issues$: ReadonlySignal<Issue[]>;
    readonly visibleErrors$: ReadonlySignal<Issue[]>;
    readonly visibleWarnings$: ReadonlySignal<Issue[]>;
    readonly isValid$: ReadonlySignal<boolean>;
    readonly isPending$: ReadonlySignal<boolean>;
    readonly isTouched$: ReadonlySignal<boolean>;
    readonly isModified$: ReadonlySignal<boolean>;
    readonly isDirty$: ReadonlySignal<boolean>;
    /** The `submitted` meta flag, of the node or of an enabled descendant. */
    readonly isSubmitted$: ReadonlySignal<boolean>;
    readonly isDisabled$: ReadonlySignal<boolean>;

    // Internal actions: called inside a public action, so already untracked and batched.
    reset(): void;
    markTouched(touched: boolean): void;
    /** Sets the `submitted` flag on the node and its subtree, as a submit does. */
    markSubmitted(): void;
    /** Applies reinit data: the node's value in `initialize({ state })`, `ABSENT` or `DEFAULTS`. */
    reinit(data: unknown, options: ReinitOptions): void;
    /** Adds server issues to the node's own ones, as the submit lays them out. */
    addServerIssues(issues: readonly Issue[]): void;
    /** Removes the server issues of the node and its subtree. */
    clearServerIssues(): void;
    /** What a submit sends from this node: its values and list key orders, without disabled children. */
    snapshot(): AttemptSnapshot;
}

/** A node with children: a group, or a list for its items. */
export interface ParentCore extends NodeCore {
    /**
     * The `disabled` predicate of this level for the child `name`: leaves the child out of this
     * node's value and aggregates. The inherited flag does not count here, see `isDisabled$`.
     */
    isExcluded(name: string): boolean;
    /**
     * The issue path segment of the child `name`, read reactively: a group gives the name, a list
     * the item's current index.
     */
    pathSegment(name: string): string | number;
}

// ==================== Public node → core ====================

const cores = new WeakMap<object, NodeCore>();

export function registerNode(core: NodeCore): void {
    cores.set(core.node, core);
}

/** The core of a public node (or of the same object passed as a view). */
export function coreOf(node: unknown): NodeCore | undefined {
    return typeof node === "object" && node !== null ? cores.get(node) : undefined;
}

export function isInSubtree(core: NodeCore, owner: NodeCore): boolean {
    for (let current: NodeCore | null = core; current; current = current.parent) {
        if (current === owner) return true;
    }
    return false;
}

// ==================== Signals ====================

/** The devtools key of a node: the instance key and the static path. */
export function nodeKey(scope: InstanceScope, segments: readonly string[]): string {
    return segments.length ? `${scope.key}/${segments.join("/")}` : scope.key;
}

/** The config path of a node member in a `FormConfigError`: `services.validate.freeTariff`. */
export function memberPath(segments: readonly string[], member: string): string {
    return [...segments, member].join(".");
}

/**
 * A derived signal of the form. Not shown in devtools (every derived value follows from the
 * writable states that are); the key only labels it in cycle errors.
 */
export function derived<T>(key: string, fn: () => T, equals?: SignalComputeOptions<T>["equals"]): DisposableSignal<T> {
    return Signal.compute(fn, { key, isDisabled: true, equals });
}

/** A writable state of the form, shown in devtools under `key`. */
export function writable<T>(key: string, initial: T) {
    return Signal.state(initial, { key });
}

export const ROOT_PATH: IssuePath = Object.freeze([]);
