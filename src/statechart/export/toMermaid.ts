/**
 * Mermaid `stateDiagram-v2` rendering of the normalized model. Spec: section 8.2.
 *
 * Layout (deterministic, document order everywhere):
 *
 * 1. `stateDiagram-v2` header (+ `direction LR` on request);
 * 2. the state tree: `state "<key>" as <id>` declarations, `state <id> { ... }`
 *    blocks for compound / parallel nodes (regions separated by `--`),
 *    `[*] --> <initial>` and `<final> --> [*]` inside the owning block;
 * 3. every transition, one line per target (`<src> --> <tgt> : <label>`);
 *    targetless transitions are self-loops, history nodes get a `default`
 *    line when they declare a default target;
 * 4. `note right of <id> : entry / ... ; exit / ...` for entry/exit actions.
 *
 * Transitions and notes are emitted after the whole tree so that every id is
 * already declared in its proper scope (Mermaid would otherwise create a
 * referenced-but-undeclared id where it is first mentioned).
 *
 * The root is normally implicit (its children live at the top level). It is
 * rendered as a composite state of its own only when Mermaid needs a state
 * to attach something to: a parallel root (regions need a block) or a root
 * with transitions / entry / exit actions.
 */
import { isBuiltin } from "../core/createBuiltin";
import type { MachineModel, ModelAction, ModelGuard, StateNode, Transition } from "../core/model";
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

type AnyStateNode = StateNode<MachineContext, EventObject>;
type AnyTransition = Transition<MachineContext, EventObject>;
type AnyAction = ModelAction<MachineContext, EventObject>;
type AnyGuard = ModelGuard<MachineContext, EventObject>;

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

function renderEvent(transition: AnyTransition): string {
    if (transition.delay !== null) return `after ${String(transition.delay)}`;
    const eventType = transition.eventType ?? "";
    if (eventType === "") return "always";
    if (eventType.startsWith(DONE_EVENT_PREFIX)) return "done";
    return eventType;
}

/** Mermaid reads a statement per line; labels must stay on one. */
function singleLine(text: string): string {
    return text.replace(/\s*[\r\n]+\s*/g, " ");
}

/** Note text additionally must not contain `:` (Mermaid's note grammar stops there). */
function noteText(text: string): string {
    return singleLine(text).replace(/:/g, " ");
}

class MermaidRenderer {
    private readonly ids = new Map<AnyStateNode, string>();
    private readonly lines: string[] = [];
    private readonly includeActions: boolean;
    private readonly includeGuards: boolean;

    constructor(
        private readonly model: MachineModel<MachineContext, EventObject>,
        options: ToMermaidOptions | undefined,
    ) {
        this.includeActions = options?.includeActions ?? true;
        this.includeGuards = options?.includeGuards ?? true;
        this.assignIds();
    }

    render(direction: "TB" | "LR"): string {
        this.lines.push("stateDiagram-v2");
        if (direction === "LR") this.emit(1, "direction LR");

        const root = this.model.root;
        if (this.needsRootBlock(root)) {
            this.emit(1, this.declaration(root));
            this.emitBlock(root, 1);
        } else {
            this.emitChildren(root, 1);
        }

        for (const node of this.model.nodes) this.emitTransitions(node);
        if (this.includeActions) {
            for (const node of this.model.nodes) this.emitNote(node);
        }
        return `${this.lines.join("\n")}\n`;
    }

    // --- ids ---------------------------------------------------------------

    /** `[^A-Za-z0-9_]` -> `_`, made unique in document order (`a.b` vs `a_b` -> `a_b`, `a_b_2`). */
    private assignIds(): void {
        const taken = new Set<string>();
        for (const node of this.model.nodes) {
            const base = node.id.replace(/[^A-Za-z0-9_]/g, "_");
            let candidate = base;
            for (let suffix = 2; taken.has(candidate); suffix++) candidate = `${base}_${suffix}`;
            taken.add(candidate);
            this.ids.set(node, candidate);
        }
    }

    private id(node: AnyStateNode): string {
        return this.ids.get(node)!;
    }

    // --- structure ---------------------------------------------------------

    private needsRootBlock(root: AnyStateNode): boolean {
        return (
            root.type === "parallel" ||
            root.transitions.size > 0 ||
            root.always.length > 0 ||
            (this.includeActions && this.configuredActions(root) !== null)
        );
    }

    private emit(depth: number, line: string): void {
        this.lines.push(`${INDENT.repeat(depth)}${line}`);
    }

    private declaration(node: AnyStateNode): string {
        const label = node.type === "history" ? (node.history === "deep" ? "H*" : "H") : node.key;
        return `state ${JSON.stringify(singleLine(label))} as ${this.id(node)}`;
    }

    private emitNode(node: AnyStateNode, depth: number): void {
        this.emit(depth, this.declaration(node));
        if (node.type === "compound" || node.type === "parallel") this.emitBlock(node, depth);
        if (node.type === "final") this.emit(depth, `${this.id(node)} --> [*]`);
    }

    private emitBlock(node: AnyStateNode, depth: number): void {
        this.emit(depth, `state ${this.id(node)} {`);
        if (node.type === "parallel") {
            node.children.forEach((region, index) => {
                if (index > 0) this.emit(depth + 1, "--");
                this.emitNode(region, depth + 1);
            });
        } else {
            this.emitChildren(node, depth + 1);
        }
        this.emit(depth, "}");
    }

    private emitChildren(node: AnyStateNode, depth: number): void {
        for (const child of node.children) this.emitNode(child, depth);
        if (node.initial !== null) this.emit(depth, `[*] --> ${this.id(node.initial.target[0])}`);
    }

    // --- transitions -------------------------------------------------------

    private emitTransitions(node: AnyStateNode): void {
        for (const candidates of node.transitions.values()) {
            for (const transition of candidates) this.emitTransition(transition);
        }
        for (const transition of node.always) this.emitTransition(transition);
        if (node.type === "history" && node.historyTarget !== null) {
            for (const target of node.historyTarget) this.emit(1, `${this.id(node)} --> ${this.id(target)} : default`);
        }
    }

    private emitTransition(transition: AnyTransition): void {
        const source = this.id(transition.source);
        const label = this.transitionLabel(transition);
        const targets = transition.target ?? [transition.source];
        for (const target of targets) this.emit(1, `${source} --> ${this.id(target)} : ${label}`);
    }

    private transitionLabel(transition: AnyTransition): string {
        let label = renderEvent(transition);
        if (this.includeGuards && transition.guard !== null) label += ` [${renderGuard(transition.guard)}]`;
        if (this.includeActions && transition.actions.length > 0) {
            label += ` / ${transition.actions.map(renderAction).join(", ")}`;
        }
        return singleLine(label);
    }

    // --- notes -------------------------------------------------------------

    /**
     * Entry / exit actions as written in the config. The model's `entry` /
     * `exit` additionally carry the synthesized `after` raise / cancel pairs,
     * which are implementation detail (the `after` transitions already show
     * the delay).
     */
    private configuredActions(node: AnyStateNode): string | null {
        const parts: string[] = [];
        const entry = toArray(node.config.entry as SingleOrArray<AnyAction> | undefined);
        const exit = toArray(node.config.exit as SingleOrArray<AnyAction> | undefined);
        if (entry.length > 0) parts.push(`entry / ${entry.map(renderAction).join(", ")}`);
        if (exit.length > 0) parts.push(`exit / ${exit.map(renderAction).join(", ")}`);
        return parts.length === 0 ? null : parts.join(" ; ");
    }

    private emitNote(node: AnyStateNode): void {
        const text = this.configuredActions(node);
        if (text !== null) this.emit(1, `note right of ${this.id(node)} : ${noteText(text)}`);
    }
}

/**
 * Walks the normalized model of `definition`: nested `state id { ... }`
 * blocks for compound nodes, `--` separated regions for parallel nodes,
 * `[*] --> initial` / `final --> [*]`, history nodes as `H` / `H*` states
 * with a `default` transition, `after` labelled `after <delay>`, `always`
 * labelled `always`, `onDone` labelled `done`.
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
