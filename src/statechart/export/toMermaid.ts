/**
 * Mermaid `stateDiagram-v2` rendering of the normalized model, in the
 * dialect of the statechart converter (`apps/converter`): the text is meant
 * to be parsed back (`parse(definition.toMermaid())` matches the config for
 * machines within the mermaid subset) and rendered as is by the viz.
 *
 * Layout (deterministic, config order everywhere):
 *
 * 1. `stateDiagram-v2`, then `%% @machine <id>` (when the config has an id)
 *    and `%% @context initial: <JSON>` (when the initial context is a JSON
 *    value), then `direction LR` on request;
 * 2. the state tree, scope by scope: `[*] --> <initial>`, then every child
 *    in document order — `state "<description>" as <id>` when it has one, a
 *    bare `<id>` when nothing else in the scope mentions it, its transitions
 *    to siblings (`<src> --> <tgt>: <label>`; `<src> --> [*]` for the
 *    scope's own `$final`), its `state <id> { ... }` block (parallel nodes:
 *    regions as `--` sections without an id of their own), `<id> --> [*]`
 *    for any other final state;
 * 3. transitions that cross scopes, at the top level: mermaid moves a state
 *    into the last block that mentions it, while top-level mentions are
 *    neutral, so a state must never be mentioned inside a foreign block;
 * 4. `note right of <id>` ... `end note` blocks listing `entry / ...` and
 *    `exit / ...` actions (mermaid cuts a single-line note at `;` and `:`).
 *
 * Ids are the state keys — unique per machine in the converter's dialect; a
 * duplicate key falls back to the `_`-joined path. Labels follow the
 * converter's grammar: `EVENT [guard] / a, b`, `after <ms|name>`, `done`,
 * and nothing at all for `always`. Config-only features degrade in a
 * documented way: history nodes are `H` / `H*` states with a `default`
 * transition, builtin guards and inline functions render as names, a root
 * with transitions of its own is wrapped in a block, a region with
 * behaviour of its own keeps a named block.
 */
import { isBuiltin } from "../core/createBuiltin";
import type { MachineModel, ModelAction, ModelGuard, StateNode, Transition } from "../core/model";
import { isPlainObject } from "../core/utils";
import { getMachineModel, type MachineDefinition } from "../MachineDefinition";
import type { EventObject, MachineContext, StateValue } from "../types";
import { BUILTIN } from "../types/brand";
import type { SingleOrArray } from "../types/common";

export interface ToMermaidOptions {
    /** Diagram direction. @default "TB" */
    direction?: "TB" | "LR";
    /** Append `/ action1, action2` to transition labels and render entry/exit as state notes. @default true */
    includeActions?: boolean;
    /** Append `[guard]` to transition labels. @default true */
    includeGuards?: boolean;
}

const INDENT = "    ";
const DONE_EVENT_PREFIX = "xstate.done.state.";
const ANONYMOUS = "anonymous";
/** Key of the synthetic final state the converter creates for `X --> [*]`. */
const FINAL_KEY = "$final";
/** Mermaid's start / end pseudo-state. */
const START_END = "[*]";

type AnyStateNode = StateNode<MachineContext, EventObject>;
type AnyTransition = Transition<MachineContext, EventObject>;
type AnyAction = ModelAction<MachineContext, EventObject>;
type AnyGuard = ModelGuard<MachineContext, EventObject>;

/** One rendered arrow; `target === null` is the `[*]` of the source's scope. */
interface Edge {
    readonly source: AnyStateNode;
    readonly target: AnyStateNode | null;
    readonly label: string;
}

/** What a scope emits for its children: the in-scope edges per child and the children some line already names. */
interface ScopePlan {
    readonly edges: ReadonlyMap<AnyStateNode, readonly Edge[]>;
    readonly mentioned: ReadonlySet<AnyStateNode>;
}

function toArray<T>(value: SingleOrArray<T> | undefined): readonly T[] {
    if (value === undefined) return [];
    return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

function functionName(fn: { name: string }): string {
    return fn.name === "" ? ANONYMOUS : fn.name;
}

/** `"a"` -> `a`, `{ a: "b" }` -> `a.b`, `{ a: "x", b: { c: "y" } }` -> `a.x, b.c.y`. */
function renderStateValue(value: StateValue): string {
    if (typeof value === "string") return value;
    const paths: string[] = [];
    for (const [key, child] of Object.entries(value)) {
        if (child === undefined) continue;
        const rendered = renderStateValue(child);
        paths.push(rendered === "" ? key : `${key}.${rendered}`);
    }
    return paths.join(", ");
}

function renderGuard(guard: AnyGuard): string {
    if (typeof guard === "string") return guard;
    if (isBuiltin(guard)) {
        const payload = guard as unknown as Record<string, unknown> & { readonly [BUILTIN]: string };
        switch (payload[BUILTIN]) {
            case "and":
            case "or":
                return `${payload[BUILTIN]}(${(payload.guards as readonly AnyGuard[]).map(renderGuard).join(", ")})`;
            case "not":
                return `not(${renderGuard(payload.guard as AnyGuard)})`;
            case "stateIn":
                return `stateIn(${renderStateValue(payload.stateValue as StateValue)})`;
            default:
                return String(payload[BUILTIN]);
        }
    }
    if (typeof guard === "function") return functionName(guard);
    return guard.type;
}

function renderAction(action: AnyAction): string {
    if (typeof action === "string") return action;
    if (isBuiltin(action)) {
        const payload = action as unknown as Record<string, unknown> & { readonly [BUILTIN]: string };
        if (payload[BUILTIN] === "raise") {
            const event = payload.event as EventObject | ((...args: never[]) => unknown);
            return typeof event === "function" ? "raise" : `raise ${event.type}`;
        }
        return String(payload[BUILTIN]);
    }
    if (typeof action === "function") return functionName(action);
    return action.type;
}

/** The trigger part of a label: `after <delay>`, `done`, the event type, or nothing for `always`. */
function renderTrigger(transition: AnyTransition): string {
    if (transition.delay !== null) return `after ${String(transition.delay)}`;
    const eventType = transition.eventType ?? "";
    if (eventType.startsWith(DONE_EVENT_PREFIX)) return "done";
    return eventType;
}

/** Mermaid reads a statement per line; labels must stay on one. */
function singleLine(text: string): string {
    return text.replace(/\s*[\r\n]+\s*/g, " ");
}

/** `state "<text>" as <id>` takes no escaped quotes: double quotes become single ones. */
function descriptionText(text: string): string {
    return singleLine(text).replace(/"/g, "'");
}

/** `[^A-Za-z0-9_]` -> `_`. */
function sanitizeId(text: string): string {
    return text.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * `JSON.stringify(value)` when `value` is a plain JSON value all the way down
 * (plain objects, arrays, strings, finite numbers, booleans, `null`);
 * `null` otherwise (factories, `undefined`, class instances, functions, ...).
 */
function toJsonText(value: unknown): string | null {
    const visiting = new Set<object>();
    const isJson = (candidate: unknown): boolean => {
        if (candidate === null) return true;
        switch (typeof candidate) {
            case "string":
            case "boolean":
                return true;
            case "number":
                return Number.isFinite(candidate);
            case "object":
                break;
            default:
                return false;
        }
        const object = candidate as object;
        if (visiting.has(object)) return false;
        visiting.add(object);
        const result = Array.isArray(object)
            ? object.every(isJson)
            : isPlainObject(object) && Object.values(object).every(isJson);
        visiting.delete(object);
        return result;
    };
    return isJson(value) ? JSON.stringify(value) : null;
}

class MermaidRenderer {
    private readonly ids = new Map<AnyStateNode, string>();
    private readonly lines: string[] = [];
    /** Transitions crossing scopes, rendered at the top level after the tree. */
    private readonly hoisted: string[] = [];
    /** Sources of the transitions (history defaults included) targeting a node. */
    private readonly incoming = new Map<AnyStateNode, AnyStateNode[]>();
    /** Regions rendered as anonymous `--` sections (no id, no lines of their own). */
    private readonly inlineRegions = new Set<AnyStateNode>();
    /** `$final` nodes rendered only as the `[*]` their siblings point to. */
    private readonly implicitFinals = new Set<AnyStateNode>();
    private readonly rootBlock: boolean;
    private readonly includeActions: boolean;
    private readonly includeGuards: boolean;

    constructor(
        private readonly model: MachineModel<MachineContext, EventObject>,
        options: ToMermaidOptions | undefined,
    ) {
        this.includeActions = options?.includeActions ?? true;
        this.includeGuards = options?.includeGuards ?? true;
        this.collectIncoming();
        for (const node of model.nodes) {
            if (this.isInlineRegion(node)) this.inlineRegions.add(node);
            if (this.isImplicitFinal(node)) this.implicitFinals.add(node);
        }
        this.rootBlock = this.needsRootBlock(model.root);
        this.assignIds();
    }

    render(direction: "TB" | "LR"): string {
        this.lines.push("stateDiagram-v2");
        if (this.model.config.id !== undefined) this.emit(1, `%% @machine ${this.model.id}`);
        const context = toJsonText(this.model.config.context);
        if (context !== null) this.emit(1, `%% @context initial: ${context}`);
        if (direction === "LR") this.emit(1, "direction LR");

        const root = this.model.root;
        if (this.rootBlock) {
            this.emit(1, `state ${this.id(root)} {`);
            this.emitBody(root, 2);
            this.emit(1, "}");
            // The root has no scope of its own: its transitions go to the top level like any crossing one.
            for (const edge of this.edgesOf(root)) this.hoist(edge);
        } else {
            this.emitBody(root, 1);
        }
        this.lines.push(...this.hoisted);
        if (this.includeActions) {
            for (const node of this.model.nodes) this.emitNote(node);
        }
        return `${this.lines.join("\n")}\n`;
    }

    // --- analysis ----------------------------------------------------------

    private collectIncoming(): void {
        for (const node of this.model.nodes) {
            for (const target of this.targetsOf(node)) {
                const sources = this.incoming.get(target);
                if (sources === undefined) this.incoming.set(target, [node]);
                else sources.push(node);
            }
        }
    }

    /** Every node `node` points to: transition targets (the node itself when targetless) and the history default. */
    private targetsOf(node: AnyStateNode): AnyStateNode[] {
        const targets: AnyStateNode[] = [];
        for (const transition of this.transitionsOf(node)) targets.push(...(transition.target ?? [node]));
        if (node.historyTarget !== null) targets.push(...node.historyTarget);
        return targets;
    }

    /**
     * Transitions of `node` in config order: grouped by the slot (`on`,
     * `after`, `always`, `onDone`) in the order the keys appear in the
     * node's config, in model order within a slot.
     */
    private transitionsOf(node: AnyStateNode): AnyTransition[] {
        const all: AnyTransition[] = [];
        for (const candidates of node.transitions.values()) all.push(...candidates);
        all.push(...node.always);
        const keys = Object.keys(node.config);
        const prefixLength = node.configPath === "" ? 0 : node.configPath.length + 1;
        const slotOf = (transition: AnyTransition): number =>
            keys.indexOf(transition.configPath.slice(prefixLength).split(/[.[]/, 1)[0] ?? "");
        return all
            .map((transition, index) => ({ transition, index, slot: slotOf(transition) }))
            .sort((a, b) => a.slot - b.slot || a.index - b.index)
            .map((entry) => entry.transition);
    }

    /**
     * A region is drawn as a bare `--` section when nothing needs its id: no
     * transitions, entry/exit or description of its own, and no transition
     * targets it. A named block stays for anything else (and for atomic,
     * parallel or history regions, which have no scope to inline).
     */
    private isInlineRegion(node: AnyStateNode): boolean {
        return (
            node.parent?.type === "parallel" &&
            node.type === "compound" &&
            node.transitions.size === 0 &&
            node.always.length === 0 &&
            node.description === undefined &&
            !this.incoming.has(node) &&
            !(this.includeActions && this.configuredActions(node) !== null)
        );
    }

    /**
     * A `$final` state is drawn only as the `[*]` its siblings point to when
     * that is all there is to it: no description, no entry/exit, not the
     * initial state, and every transition targeting it (at least one, so
     * that the state stays visible) comes from a sibling — the converter's
     * `X --> [*]` reads exactly like that.
     */
    private isImplicitFinal(node: AnyStateNode): boolean {
        const parent = node.parent;
        const sources = this.incoming.get(node) ?? [];
        return (
            node.type === "final" &&
            node.key === FINAL_KEY &&
            parent !== null &&
            node.description === undefined &&
            parent.initial?.target[0] !== node &&
            !(this.includeActions && this.configuredActions(node) !== null) &&
            sources.length > 0 &&
            sources.every((source) => source.parent === parent)
        );
    }

    private needsRootBlock(root: AnyStateNode): boolean {
        return (
            root.type === "parallel" ||
            root.transitions.size > 0 ||
            root.always.length > 0 ||
            (this.includeActions && this.configuredActions(root) !== null)
        );
    }

    // --- ids ---------------------------------------------------------------

    /**
     * The state key, sanitized; a key already taken falls back to the
     * sanitized `_`-joined path, then to a numeric suffix. Nodes that never
     * appear by id (inline regions, implicit finals, the root outside a
     * root block) reserve nothing.
     */
    private assignIds(): void {
        const taken = new Set<string>();
        for (const node of this.model.nodes) {
            if (node.parent === null && !this.rootBlock) continue;
            if (this.inlineRegions.has(node) || this.implicitFinals.has(node)) continue;
            const key = sanitizeId(node.key);
            const path = node.parent === null ? key : sanitizeId(node.path.join("_"));
            let candidate = taken.has(key) ? path : key;
            for (let suffix = 2; taken.has(candidate); suffix++) candidate = `${path}_${suffix}`;
            taken.add(candidate);
            this.ids.set(node, candidate);
        }
    }

    private id(node: AnyStateNode): string {
        const id = this.ids.get(node);
        if (id === undefined) throw new Error(`toMermaid: no id assigned to state node '${node.id}'.`);
        return id;
    }

    // --- structure ---------------------------------------------------------

    private emit(depth: number, line: string): void {
        this.lines.push(`${INDENT.repeat(depth)}${line}`);
    }

    private emitBody(node: AnyStateNode, depth: number): void {
        if (node.type === "parallel") this.emitRegions(node, depth);
        else this.emitScope(node, depth);
    }

    private emitScope(scope: AnyStateNode, depth: number): void {
        const plan = this.planScope(scope);
        if (scope.initial !== null) this.emit(depth, `${START_END} --> ${this.id(scope.initial.target[0])}`);
        for (const child of scope.children) {
            if (this.implicitFinals.has(child)) continue;
            this.emitChild(child, depth, plan);
        }
    }

    private emitRegions(node: AnyStateNode, depth: number): void {
        const plan = this.planScope(node);
        node.children.forEach((region, index) => {
            if (index > 0) this.emit(depth, "--");
            if (this.inlineRegions.has(region)) this.emitScope(region, depth);
            else this.emitChild(region, depth, plan);
        });
    }

    /**
     * Splits the transitions of the scope's children into in-scope edges
     * (source and target are both children of `scope`, or the target is the
     * scope's implicit `$final`) and crossing ones, which are hoisted.
     */
    private planScope(scope: AnyStateNode): ScopePlan {
        const edges = new Map<AnyStateNode, Edge[]>();
        const mentioned = new Set<AnyStateNode>();
        if (scope.initial !== null) mentioned.add(scope.initial.target[0]);
        for (const child of scope.children) {
            if (this.implicitFinals.has(child)) continue;
            const own: Edge[] = [];
            for (const edge of this.edgesOf(child)) {
                const target = edge.target!;
                if (target.parent !== scope) {
                    this.hoist(edge);
                    continue;
                }
                mentioned.add(child);
                if (this.implicitFinals.has(target)) {
                    own.push({ ...edge, target: null });
                } else {
                    mentioned.add(target);
                    own.push(edge);
                }
            }
            edges.set(child, own);
        }
        return { edges, mentioned };
    }

    private emitChild(child: AnyStateNode, depth: number, plan: ScopePlan): void {
        const id = this.id(child);
        const isBlock = child.type === "compound" || child.type === "parallel";
        const isFinal = child.type === "final";
        if (child.type === "history") {
            this.emit(depth, `state "${child.history === "deep" ? "H*" : "H"}" as ${id}`);
        } else if (child.description !== undefined) {
            this.emit(depth, `state "${descriptionText(child.description)}" as ${id}`);
        } else if (!isBlock && !isFinal && !plan.mentioned.has(child)) {
            this.emit(depth, id);
        }
        for (const edge of plan.edges.get(child) ?? []) this.emit(depth, this.edgeText(edge));
        if (isBlock) {
            this.emit(depth, `state ${id} {`);
            this.emitBody(child, depth + 1);
            this.emit(depth, "}");
        }
        if (isFinal) this.emit(depth, `${id} --> ${START_END}`);
    }

    // --- transitions -------------------------------------------------------

    /** The arrows leaving `node`: one per target (the node itself when targetless), plus the history default. */
    private edgesOf(node: AnyStateNode): Edge[] {
        const edges: Edge[] = [];
        for (const transition of this.transitionsOf(node)) {
            const label = this.transitionLabel(transition);
            for (const target of transition.target ?? [node]) edges.push({ source: node, target, label });
        }
        if (node.historyTarget !== null) {
            for (const target of node.historyTarget) edges.push({ source: node, target, label: "default" });
        }
        return edges;
    }

    private hoist(edge: Edge): void {
        this.hoisted.push(`${INDENT}${this.edgeText(edge)}`);
    }

    private edgeText(edge: Edge): string {
        const target = edge.target === null ? START_END : this.id(edge.target);
        const arrow = `${this.id(edge.source)} --> ${target}`;
        return edge.label === "" ? arrow : `${arrow}: ${edge.label}`;
    }

    /** `EVENT [guard] / a, b` — each part optional, so an unguarded `always` has no label at all. */
    private transitionLabel(transition: AnyTransition): string {
        const parts: string[] = [];
        const trigger = renderTrigger(transition);
        if (trigger !== "") parts.push(trigger);
        if (this.includeGuards && transition.guard !== null) parts.push(`[${renderGuard(transition.guard)}]`);
        if (this.includeActions && transition.actions.length > 0) {
            parts.push(`/ ${transition.actions.map(renderAction).join(", ")}`);
        }
        return singleLine(parts.join(" "));
    }

    // --- notes -------------------------------------------------------------

    /**
     * Entry / exit actions as written in the config, one line each. The
     * model's `entry` / `exit` additionally carry the synthesized `after`
     * raise / cancel pairs, which are implementation detail (the `after`
     * transitions already show the delay).
     */
    private configuredActions(node: AnyStateNode): string[] | null {
        const lines: string[] = [];
        const entry = toArray(node.config.entry as SingleOrArray<AnyAction> | undefined);
        const exit = toArray(node.config.exit as SingleOrArray<AnyAction> | undefined);
        if (entry.length > 0) lines.push(singleLine(`entry / ${entry.map(renderAction).join(", ")}`));
        if (exit.length > 0) lines.push(singleLine(`exit / ${exit.map(renderAction).join(", ")}`));
        return lines.length === 0 ? null : lines;
    }

    private emitNote(node: AnyStateNode): void {
        // Nodes without an id (inline regions, implicit finals, the root outside its block) have no actions by construction.
        if (!this.ids.has(node)) return;
        const lines = this.configuredActions(node);
        if (lines === null) return;
        this.emit(1, `note right of ${this.id(node)}`);
        for (const line of lines) this.emit(2, line);
        this.emit(1, "end note");
    }
}

/**
 * Renders `definition` as a `stateDiagram-v2` in the converter's dialect
 * (see the module comment): `%% @machine` / `%% @context initial` directives,
 * nested `state id { ... }` blocks, `--` regions, `[*]` for initial and
 * `$final` states, labels `EVENT [guard] / actions`, `after <delay>`, `done`
 * and none for `always`.
 */
export function toMermaid<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
    definition: MachineDefinition<TContext, TEvent, TOutput>,
    options?: ToMermaidOptions,
): string {
    const direction = options?.direction ?? "TB";
    if (direction !== "TB" && direction !== "LR") {
        throw new RangeError(`toMermaid: 'direction' must be "TB" or "LR", got ${JSON.stringify(direction)}.`);
    }
    const model = getMachineModel(definition) as MachineModel<MachineContext, EventObject>;
    return new MermaidRenderer(model, options).render(direction);
}
