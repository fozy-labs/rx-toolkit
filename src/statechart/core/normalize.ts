/**
 * Validation + normalization: raw `MachineConfig` -> `MachineModel`.
 * Throws `MachineConfigError` with a path-qualified message on the first
 * problem. Spec: section 2 (model) and section 6 (validation rules).
 *
 * Semantics mirror XState v5 (`StateNode` constructor, `formatTransitions`,
 * `getDelayedTransitions`, `resolveTarget`, `getStateNodeByPath`) with the
 * strictness the brief asks for: anything XState would silently ignore or
 * misinterpret (unknown keys, `initial` on parallel nodes, dead `onDone`,
 * same-region multi-targets, duplicate ids, ...) is an error here.
 */
import { cancel, raise } from "../actions";
import type {
    AfterEvent,
    ContextFactory,
    EventObject,
    HistoryType,
    MachineConfig,
    MachineContext,
    MetaObject,
    StateNodeConfig,
    StateNodeType,
} from "../types";
import { BUILTIN } from "../types/brand";

import { findLeastCommonAncestor, isDescendant } from "./configuration";
import {
    createAfterEventType,
    createDoneStateEventType,
    DEFAULT_MACHINE_ID,
    NULL_EVENT,
    STATE_DELIMITER,
    STATE_IDENTIFIER,
    WILDCARD,
    XSTATE_INIT,
    XSTATE_STOP,
} from "./constants";
import { isBuiltin } from "./createBuiltin";
import { MachineConfigError } from "./MachineConfigError";
import type {
    InitialTransition,
    MachineModel,
    ModelAction,
    ModelEvent,
    ModelGuard,
    ModelReferences,
    OutputResolver,
    StateNode,
    Transition,
} from "./model";
import { getStateNodeById, getStateNodeByPath, type StateNodeLookup } from "./stateValue";
import { describeValue, isNonEmptyString, isPlainObject } from "./utils";

// --- constants -------------------------------------------------------------

const STATE_NODE_KEYS: ReadonlySet<string> = new Set([
    "id",
    "type",
    "initial",
    "states",
    "on",
    "always",
    "after",
    "entry",
    "exit",
    "onDone",
    "history",
    "target",
    "output",
    "tags",
    "description",
    "meta",
]);

const ROOT_ONLY_KEYS: ReadonlySet<string> = new Set(["context", "types", "source"]);

const STATE_NODE_TYPES: ReadonlySet<string> = new Set<StateNodeType>([
    "atomic",
    "compound",
    "parallel",
    "final",
    "history",
]);

const TRANSITION_KEYS: ReadonlySet<string> = new Set(["target", "actions", "guard", "reenter", "description", "meta"]);

/** XState v4 transition keys with a dedicated hint. */
const RENAMED_TRANSITION_KEYS: Readonly<Record<string, string>> = {
    cond: "'cond' has been renamed to 'guard'",
    internal: "'internal' is not supported, use reenter: false",
    in: "'in' is not supported, use the stateIn() guard",
};

const REFERENCE_KEYS: ReadonlySet<string> = new Set(["type", "params"]);

const ACTION_BRANDS: ReadonlySet<string> = new Set(["assign", "mutate", "raise", "cancel", "log"]);
const GUARD_BRANDS: ReadonlySet<string> = new Set(["and", "or", "not", "stateIn"]);

/** Reserved prefix of XState builtin types; hand-written `{ type: "xstate.assign" }` objects are a mistake. */
const BUILTIN_TYPE_PREFIX = "xstate.";

/** XState creator types this module mirrors; a foreign one of these gets a "use ours" hint. */
const MIRRORED_ACTION_TYPES: ReadonlySet<string> = new Set([
    "xstate.assign",
    "xstate.raise",
    "xstate.cancel",
    "xstate.log",
]);
const MIRRORED_GUARD_NAMES: ReadonlySet<string> = new Set(["and", "or", "not", "stateIn"]);

/**
 * Event families of the XState actor system. Nothing here ever emits them,
 * so a transition on one of them would be dead — and drawn by the inspector.
 * `xstate.*` wildcards and the `xstate.done.state.*` / `xstate.after.*`
 * families stay allowed: they do fire (differential scenarios prove parity).
 */
const ACTOR_SYSTEM_EVENT_PREFIXES: readonly string[] = [
    "xstate.error.",
    "xstate.done.actor.",
    "xstate.snapshot.",
    "xstate.promise.",
];

// --- internal types --------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type RawConfig = Readonly<Record<string, unknown>>;

type MutableNode<TContext extends MachineContext, TEvent extends EventObject> = Mutable<StateNode<TContext, TEvent>>;

/** Names referenced by validated actions / guards / delays; a mutable `ModelReferences`. */
export interface ReferenceCollector {
    readonly actions: Set<string>;
    readonly guards: Set<string>;
    readonly delays: Set<string>;
}

/** What `#id` resolution needs (`core/stateValue.ts`): the build context during normalization, or a finished model. */
export type NodeLookup<TContext extends MachineContext, TEvent extends EventObject> = StateNodeLookup<TContext, TEvent>;

interface BuildContext<TContext extends MachineContext, TEvent extends EventObject> extends NodeLookup<
    TContext,
    TEvent
> {
    readonly nodes: MutableNode<TContext, TEvent>[];
    readonly idMap: Map<string, MutableNode<TContext, TEvent>>;
    readonly references: ReferenceCollector;
}

/** Which transition value shapes a slot accepts (XState: `after` / `onDone` break on string arrays). */
type TransitionSlot = "on" | "always" | "after" | "onDone";

// --- helpers ---------------------------------------------------------------

function fail(path: string, detail: string): never {
    throw new MachineConfigError(path, detail);
}

function joinPath(base: string, segment: string): string {
    return base ? `${base}.${segment}` : segment;
}

function assertPlainObject(value: unknown, path: string, what: string): asserts value is RawConfig {
    if (!isPlainObject(value)) fail(path, `${what} must be a plain object (got ${describeValue(value)})`);
}

function assertOptionalString(value: unknown, path: string, key: string): asserts value is string | undefined {
    if (value !== undefined && typeof value !== "string") {
        fail(path, `'${key}' must be a string (got ${describeValue(value)})`);
    }
}

function assertOptionalMeta(value: unknown, path: string): asserts value is MetaObject | undefined {
    if (value !== undefined && !isPlainObject(value)) {
        fail(path, `'meta' must be a plain object (got ${describeValue(value)})`);
    }
}

/** Port of XState `resolveTarget` for one target string (lookups: `core/stateValue.ts`, errors carry `path`). */
function resolveTarget<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: BuildContext<TContext, TEvent>,
    source: StateNode<TContext, TEvent>,
    target: string,
    path: string,
): StateNode<TContext, TEvent> {
    if (target.startsWith(STATE_IDENTIFIER)) {
        return getStateNodeById(ctx, target, path);
    }
    if (target.startsWith(STATE_DELIMITER)) {
        return getStateNodeByPath(source, target.slice(STATE_DELIMITER.length), path);
    }
    if (source.parent === null) {
        fail(path, `Invalid target: "${target}" is not a valid target from the root node. Did you mean ".${target}"?`);
    }
    return getStateNodeByPath(source.parent, target, path);
}

/**
 * Multiple targets are legal only across regions of one parallel state:
 * no target may be an ancestor-or-self of another, and every pair must meet
 * in a `parallel` node.
 */
function assertParallelRegions<TContext extends MachineContext, TEvent extends EventObject>(
    targets: readonly StateNode<TContext, TEvent>[],
    path: string,
): void {
    for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
            const a = targets[i];
            const b = targets[j];
            const nested = a === b || isDescendant(a, b) || isDescendant(b, a);
            const lca = nested ? null : findLeastCommonAncestor([a, b]);
            if (nested || lca === null || lca.type !== "parallel") {
                fail(
                    path,
                    `multiple targets must lie in different regions of one parallel state ('#${a.id}' and '#${b.id}' do not)`,
                );
            }
        }
    }
}

function resolveTargets<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: BuildContext<TContext, TEvent>,
    source: StateNode<TContext, TEvent>,
    targets: readonly string[],
    path: string,
): readonly StateNode<TContext, TEvent>[] {
    const resolved = targets.map((target) => resolveTarget(ctx, source, target, path));
    if (resolved.length > 1) assertParallelRegions(resolved, path);
    return Object.freeze(resolved);
}

// --- actions ---------------------------------------------------------------

function validateReferenceObject(value: RawConfig, path: string, kind: "action" | "guard"): string {
    for (const key of Object.keys(value)) {
        if (!REFERENCE_KEYS.has(key)) {
            fail(
                path,
                `'${key}' is not supported in ${kind === "action" ? "an" : "a"} ${kind} object (allowed: type, params)`,
            );
        }
    }
    const type = value.type;
    if (!isNonEmptyString(type)) fail(path, `${kind} 'type' must be a non-empty string (got ${describeValue(type)})`);
    if (type.startsWith(BUILTIN_TYPE_PREFIX)) {
        fail(
            path,
            `'${type}' looks like a builtin ${kind} written as a plain object; use the ${kind} creators exported by the package instead`,
        );
    }
    return type;
}

function validateDelay(delay: unknown, path: string, references: ReferenceCollector): void {
    if (delay === undefined || typeof delay === "function") return;
    if (typeof delay === "number") {
        if (!Number.isFinite(delay) || delay < 0) {
            fail(path, `delay must be a non-negative finite number (got ${String(delay)})`);
        }
        return;
    }
    if (typeof delay === "string") {
        if (delay.length === 0) fail(path, "named delay must be a non-empty string");
        references.delays.add(delay);
        return;
    }
    fail(path, `delay must be a number, a named delay or a function (got ${describeValue(delay)})`);
}

function validateBuiltinAction(
    builtin: RawConfig & { type: string },
    brand: string,
    path: string,
    refs: ReferenceCollector,
): void {
    switch (brand) {
        case "assign": {
            const assignment = builtin.assignment;
            if (typeof assignment !== "function" && !isPlainObject(assignment)) {
                fail(path, `assign() expects a partial object or a function (got ${describeValue(assignment)})`);
            }
            return;
        }
        case "mutate": {
            if (typeof builtin.recipe !== "function") {
                fail(path, `mutate() expects a recipe function (got ${describeValue(builtin.recipe)})`);
            }
            return;
        }
        case "raise": {
            const event = builtin.event;
            if (typeof event !== "function") {
                if (!isPlainObject(event) || !isNonEmptyString(event.type)) {
                    fail(path, "raise() expects an event object with a non-empty string 'type' or a function");
                }
                if (event.type === WILDCARD) fail(path, "raise() cannot raise an event of the wildcard type ('*')");
            }
            validateDelay(builtin.delay, path, refs);
            if (builtin.id !== undefined && !isNonEmptyString(builtin.id)) {
                fail(path, `raise() 'id' must be a non-empty string (got ${describeValue(builtin.id)})`);
            }
            return;
        }
        case "cancel": {
            const sendId = builtin.sendId;
            if (typeof sendId !== "function" && !isNonEmptyString(sendId)) {
                fail(path, `cancel() expects a non-empty string id or a function (got ${describeValue(sendId)})`);
            }
            return;
        }
        case "log": {
            if (builtin.label !== undefined && typeof builtin.label !== "string") {
                fail(path, `log() label must be a string (got ${describeValue(builtin.label)})`);
            }
            return;
        }
        default:
            if (GUARD_BRANDS.has(brand))
                fail(path, `'${builtin.type}' is a guard builtin and cannot be used as an action`);
            fail(path, `unknown builtin '${builtin.type}'`);
    }
}

/**
 * XState's own creators (`assign`, `sendTo`, `enqueueActions`, `and`, ...)
 * return plain functions carrying `type: "xstate.*"` (actions) or a `check`
 * function (guards). They are not branded, so without this check they would
 * pass as inline functions and run as silent no-ops — the "diagram lies about
 * behaviour" case. Returns the error detail, or `null` for anything else.
 */
function describeForeignBuiltin(value: unknown): string | null {
    if (typeof value !== "function") return null;
    const { type, check, name } = value as { type?: unknown; check?: unknown; name?: unknown };
    if (typeof type === "string" && type.startsWith(BUILTIN_TYPE_PREFIX)) {
        if (MIRRORED_ACTION_TYPES.has(type)) {
            const creator = type.slice(BUILTIN_TYPE_PREFIX.length);
            return `'${type}' was created by the xstate package; use the ${creator}() creator exported by @fozy-labs/rx-toolkit instead`;
        }
        return `'${type}' is an XState builtin that is not supported (actors, emit and enqueueActions are out of scope); the supported action creators are assign, raise, cancel and log from @fozy-labs/rx-toolkit`;
    }
    if (typeof check === "function") {
        if (typeof name === "string" && MIRRORED_GUARD_NAMES.has(name)) {
            return `'${name}' guard was created by the xstate package; use the ${name}() creator exported by @fozy-labs/rx-toolkit instead`;
        }
        return "guard was created by the xstate package; use the guard creators exported by @fozy-labs/rx-toolkit (and, or, not, stateIn) instead";
    }
    return null;
}

function assertNotForeignBuiltin(value: unknown, path: string): void {
    const detail = describeForeignBuiltin(value);
    if (detail !== null) fail(path, detail);
}

/**
 * Validates one action value (shape only; names are checked lazily by the
 * engine) and records referenced names. Dispatch order matters: builtins are
 * functions, so `isBuiltin` (and the foreign-creator check) run before the
 * plain-function branch.
 */
export function validateAction(action: unknown, path: string, references: ReferenceCollector): void {
    if (typeof action === "string") {
        if (action.length === 0) fail(path, "action name must be a non-empty string");
        references.actions.add(action);
        return;
    }
    if (isBuiltin(action)) {
        validateBuiltinAction(action as unknown as RawConfig & { type: string }, action[BUILTIN], path, references);
        return;
    }
    assertNotForeignBuiltin(action, path);
    if (typeof action === "function") return;
    if (isPlainObject(action)) {
        references.actions.add(validateReferenceObject(action, path, "action"));
        return;
    }
    fail(path, `unknown action shape (got ${describeValue(action)})`);
}

function validateActions<TContext extends MachineContext, TEvent extends EventObject>(
    value: unknown,
    path: string,
    references: ReferenceCollector,
): ModelAction<TContext, TEvent>[] {
    if (value === undefined) return [];
    const list: unknown[] = Array.isArray(value) ? value : [value];
    list.forEach((action, index) => validateAction(action, `${path}[${index}]`, references));
    // A copy: the model must never alias (and later freeze) an array of the caller's config.
    return [...list] as ModelAction<TContext, TEvent>[];
}

// --- guards ----------------------------------------------------------------

function validateBuiltinGuard<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: NodeLookup<TContext, TEvent> | null,
    builtin: RawConfig & { type: string },
    brand: string,
    path: string,
    references: ReferenceCollector,
): void {
    switch (brand) {
        case "and":
        case "or": {
            const guards = builtin.guards;
            if (!Array.isArray(guards))
                fail(path, `${brand}() expects an array of guards (got ${describeValue(guards)})`);
            guards.forEach((guard, index) => validateGuard(ctx, guard, `${path}.guards[${index}]`, references));
            return;
        }
        case "not":
            validateGuard(ctx, builtin.guard, `${path}.guard`, references);
            return;
        case "stateIn": {
            const stateValue = builtin.stateValue;
            if (typeof stateValue === "string") {
                if (stateValue.length === 0) fail(path, "stateIn() expects a non-empty state value");
                if (ctx !== null && stateValue.startsWith(STATE_IDENTIFIER)) getStateNodeById(ctx, stateValue, path);
                return;
            }
            if (!isPlainObject(stateValue)) {
                fail(path, `stateIn() expects a state value string or object (got ${describeValue(stateValue)})`);
            }
            return;
        }
        default:
            if (ACTION_BRANDS.has(brand))
                fail(path, `'${builtin.type}' is an action builtin and cannot be used as a guard`);
            fail(path, `unknown builtin '${builtin.type}'`);
    }
}

/**
 * Validates one guard value (shape only) and records referenced names.
 * `ctx` enables `stateIn("#id")` resolution; pass `null` outside a machine
 * (implementation tables).
 */
export function validateGuard<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: NodeLookup<TContext, TEvent> | null,
    guard: unknown,
    path: string,
    references: ReferenceCollector,
): void {
    if (typeof guard === "string") {
        if (guard.length === 0) fail(path, "guard name must be a non-empty string");
        references.guards.add(guard);
        return;
    }
    if (isBuiltin(guard)) {
        validateBuiltinGuard(ctx, guard as unknown as RawConfig & { type: string }, guard[BUILTIN], path, references);
        return;
    }
    assertNotForeignBuiltin(guard, path);
    if (typeof guard === "function") return;
    if (isPlainObject(guard)) {
        references.guards.add(validateReferenceObject(guard, path, "guard"));
        return;
    }
    fail(path, `unknown guard shape (got ${describeValue(guard)})`);
}

// --- transitions -----------------------------------------------------------

/** Reserved `xstate.*` descriptors that could never fire here (see `ACTOR_SYSTEM_EVENT_PREFIXES`). */
function describeReservedDescriptor(descriptor: string): string | null {
    if (descriptor === XSTATE_INIT || descriptor === XSTATE_STOP) {
        return `'${descriptor}' is a reserved XState system event: no transition is ever selected for it, so the handler could never fire`;
    }
    if (ACTOR_SYSTEM_EVENT_PREFIXES.some((prefix) => descriptor.startsWith(prefix))) {
        return `'${descriptor}' is a reserved XState actor-system event; actors/invoke are not supported, so the handler could never fire`;
    }
    return null;
}

function validateEventDescriptor(descriptor: string, path: string): void {
    if (descriptor === NULL_EVENT) {
        fail(path, 'Null events ("") cannot be specified as a transition key. Use always: { ... } instead.');
    }
    const reserved = describeReservedDescriptor(descriptor);
    if (reserved !== null) fail(path, reserved);
    if (descriptor === WILDCARD) return;
    const star = descriptor.indexOf(WILDCARD);
    if (star === -1) return;
    const isTrailingSegment = descriptor.endsWith(`${STATE_DELIMITER}${WILDCARD}`) && star === descriptor.length - 1;
    if (!isTrailingSegment) {
        fail(
            path,
            `invalid event descriptor '${descriptor}': '*' is allowed only as the whole descriptor or as the last '.'-separated segment`,
        );
    }
}

/** XState `toTransitionConfigArray`, with the slot-specific shape rules of spec 6.2. */
function toTransitionConfigs(value: unknown, path: string, slot: TransitionSlot): RawConfig[] {
    const allowsBareTargets = slot === "on" || slot === "always";
    const toConfig = (item: unknown, itemPath: string, insideArray: boolean): RawConfig => {
        if (item === undefined || typeof item === "string") {
            if (insideArray && !allowsBareTargets) {
                fail(itemPath, `'${slot}' arrays must contain transition objects (got ${describeValue(item)})`);
            }
            if (item === undefined && !allowsBareTargets) {
                fail(itemPath, `'${slot}' transition must be a target string, an object or an array of objects`);
            }
            return { target: item };
        }
        if (isPlainObject(item)) return item;
        fail(itemPath, `unknown transition shape (got ${describeValue(item)})`);
    };
    if (Array.isArray(value)) {
        return value.map((item: unknown, index) => toConfig(item, `${path}[${index}]`, true));
    }
    return [toConfig(value, path, false)];
}

function normalizeTargetStrings(target: unknown, path: string): readonly string[] | null {
    if (target === undefined || target === "") return null;
    if (typeof target === "string") return [target];
    if (Array.isArray(target)) {
        if (target.length === 0)
            fail(path, "'target' array must not be empty (omit 'target' for a targetless transition)");
        target.forEach((item: unknown, index) => {
            if (!isNonEmptyString(item)) {
                fail(path, `'target[${index}]' must be a non-empty string (got ${describeValue(item)})`);
            }
        });
        return target as string[];
    }
    fail(path, `'target' must be a string or an array of strings (got ${describeValue(target)})`);
}

/** Port of XState `formatTransition` over a validated transition object. */
function formatTransition<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: BuildContext<TContext, TEvent>,
    source: MutableNode<TContext, TEvent>,
    eventType: string,
    config: RawConfig,
    path: string,
    delay: number | string | null,
): Transition<TContext, TEvent> {
    for (const key of Object.keys(config)) {
        if (TRANSITION_KEYS.has(key)) continue;
        const hint = RENAMED_TRANSITION_KEYS[key];
        fail(path, hint ?? `'${key}' is not supported`);
    }
    const targetStrings = normalizeTargetStrings(config.target, path);
    const target = targetStrings === null ? null : resolveTargets(ctx, source, targetStrings, path);
    const actions = validateActions<TContext, TEvent>(config.actions, `${path}.actions`, ctx.references);
    if (config.guard !== undefined) validateGuard(ctx, config.guard, `${path}.guard`, ctx.references);
    if (config.reenter !== undefined && typeof config.reenter !== "boolean") {
        fail(path, `'reenter' must be a boolean (got ${describeValue(config.reenter)})`);
    }
    assertOptionalString(config.description, path, "description");
    assertOptionalMeta(config.meta, path);

    return Object.freeze({
        source,
        target,
        actions: Object.freeze(actions),
        guard: (config.guard ?? null) as ModelGuard<TContext, TEvent> | null,
        reenter: config.reenter ?? false,
        eventType,
        delay,
        description: config.description,
        meta: config.meta,
        configPath: path,
    });
}

function formatTransitionList<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: BuildContext<TContext, TEvent>,
    source: MutableNode<TContext, TEvent>,
    eventType: string,
    value: unknown,
    path: string,
    slot: TransitionSlot,
    delay: number | string | null,
): Transition<TContext, TEvent>[] {
    return toTransitionConfigs(value, path, slot).map((config, index) =>
        formatTransition(ctx, source, eventType, config, `${path}[${index}]`, delay),
    );
}

// --- pass 1: nodes ---------------------------------------------------------

function validateStateNodeKeys(raw: RawConfig, path: string, isRoot: boolean): void {
    for (const key of Object.keys(raw)) {
        if (STATE_NODE_KEYS.has(key)) continue;
        if (ROOT_ONLY_KEYS.has(key)) {
            if (isRoot) continue;
            fail(path, `'${key}' is only allowed on the root state node`);
        }
        fail(path, `'${key}' is not supported`);
    }
}

function validateId(id: unknown, path: string): asserts id is string | undefined {
    if (id === undefined) return;
    if (!isNonEmptyString(id)) fail(path, `'id' must be a non-empty string (got ${describeValue(id)})`);
    if (id.startsWith(STATE_IDENTIFIER)) fail(path, `'id' must not start with '${STATE_IDENTIFIER}' (got '${id}')`);
    if (id.includes(STATE_DELIMITER)) fail(path, `'id' must not contain '${STATE_DELIMITER}' (got '${id}')`);
}

function resolveType(raw: RawConfig, path: string, hasChildren: boolean): StateNodeType {
    const explicit = raw.type;
    if (explicit !== undefined) {
        if (typeof explicit !== "string" || !STATE_NODE_TYPES.has(explicit)) {
            fail(
                path,
                `'type' must be one of atomic, compound, parallel, final, history (got ${describeValue(explicit)})`,
            );
        }
        return explicit as StateNodeType;
    }
    if (hasChildren) return "compound";
    return raw.history !== undefined ? "history" : "atomic";
}

function resolveHistory(raw: RawConfig, path: string, type: StateNodeType): HistoryType | null {
    const history = raw.history;
    if (history !== undefined && type !== "history") {
        fail(path, `'history' is only allowed on history state nodes (this node is '${type}')`);
    }
    if (type !== "history") return null;
    if (history === undefined || history === true) return "shallow";
    if (history === "shallow" || history === "deep") return history;
    fail(path, `'history' must be "shallow", "deep" or true (got ${describeValue(history)})`);
}

function resolveTags(tags: unknown, path: string): readonly string[] {
    if (tags === undefined) return Object.freeze([]);
    const list: unknown[] = Array.isArray(tags) ? tags : [tags];
    list.forEach((tag, index) => {
        if (typeof tag !== "string") fail(path, `'tags[${index}]' must be a string (got ${describeValue(tag)})`);
    });
    return Object.freeze([...(list as string[])]);
}

function assertKeyAbsent(raw: RawConfig, key: string, path: string, reason: string): void {
    if (key in raw) fail(path, `'${key}' is not allowed on ${reason}`);
}

function validateTypeSpecificKeys(raw: RawConfig, path: string, type: StateNodeType, isRoot: boolean): void {
    const hasChildren = isPlainObject(raw.states) && Object.keys(raw.states).length > 0;
    switch (type) {
        case "compound":
            if (!hasChildren) fail(path, "a compound state node must declare at least one child in 'states'");
            break;
        case "parallel":
            if (!hasChildren) fail(path, "a parallel state node must declare at least one region in 'states'");
            assertKeyAbsent(raw, "initial", path, "parallel state nodes (every region is entered)");
            break;
        case "atomic":
            if (hasChildren)
                fail(path, "'states' is not allowed on atomic state nodes (did you mean type: \"compound\"?)");
            assertKeyAbsent(raw, "initial", path, "atomic state nodes");
            break;
        case "final":
            if (hasChildren) fail(path, "'states' is not allowed on final state nodes");
            assertKeyAbsent(raw, "initial", path, "final state nodes");
            break;
        case "history":
            for (const key of ["states", "initial", "on", "always", "after", "entry", "exit", "tags"]) {
                assertKeyAbsent(raw, key, path, "history state nodes");
            }
            break;
    }
    if ("onDone" in raw) {
        if (isRoot) {
            fail(
                path,
                "'onDone' is not allowed on the root state node: the machine is done as soon as a top-level final state is entered, so the transition could never fire",
            );
        }
        if (type !== "compound" && type !== "parallel") {
            fail(path, `'onDone' is only allowed on compound and parallel state nodes (this node is '${type}')`);
        }
    }
    if ("output" in raw && type !== "final" && !isRoot) {
        fail(path, `'output' is only allowed on final state nodes and the root (this node is '${type}')`);
    }
    if ("target" in raw && type !== "history") {
        fail(path, `'target' is only allowed on history state nodes (use transitions on '${type}' nodes)`);
    }
}

function buildNode<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: BuildContext<TContext, TEvent>,
    raw: RawConfig,
    key: string,
    parent: MutableNode<TContext, TEvent> | null,
    configPath: string,
): MutableNode<TContext, TEvent> {
    const isRoot = parent === null;
    validateStateNodeKeys(raw, configPath, isRoot);
    validateId(raw.id, configPath);

    if (raw.states !== undefined) assertPlainObject(raw.states, joinPath(configPath, "states"), "'states'");
    const states = raw.states ?? {};
    const childKeys = Object.keys(states);
    for (const childKey of childKeys) {
        const childPath = joinPath(configPath, `states.${childKey}`);
        if (childKey.length === 0) fail(joinPath(configPath, "states"), "state keys must be non-empty strings");
        if (childKey.includes(STATE_DELIMITER)) {
            fail(joinPath(configPath, "states"), `state key '${childKey}' must not contain '${STATE_DELIMITER}'`);
        }
        assertPlainObject(states[childKey], childPath, "state node config");
    }

    const type = resolveType(raw, configPath, childKeys.length > 0);
    if (isRoot && type !== "compound" && type !== "parallel") {
        fail(
            configPath,
            raw.type === undefined
                ? "the root state node must declare at least one child state in 'states'"
                : `root state node type '${type}' is not supported: the root must be 'compound' or 'parallel'`,
        );
    }
    validateTypeSpecificKeys(raw, configPath, type, isRoot);
    if (type === "history" && parent !== null && parent.type !== "compound" && parent.type !== "parallel") {
        fail(configPath, `a history state node requires a compound or parallel parent (parent is '${parent.type}')`);
    }
    if (raw.initial !== undefined && !isNonEmptyString(raw.initial)) {
        fail(
            configPath,
            `'initial' must be a non-empty string naming a child state (got ${describeValue(raw.initial)})`,
        );
    }
    if (raw.target !== undefined && !isNonEmptyString(raw.target)) {
        fail(configPath, `'target' must be a non-empty string (got ${describeValue(raw.target)})`);
    }
    assertOptionalString(raw.description, configPath, "description");
    assertOptionalMeta(raw.meta, configPath);
    if (isRoot) {
        if (raw.types !== undefined) assertPlainObject(raw.types, joinPath(configPath, "types"), "'types'");
        const context = raw.context;
        if (context !== undefined && typeof context !== "function" && !isPlainObject(context)) {
            fail(configPath, `'context' must be a plain object or a factory function (got ${describeValue(context)})`);
        }
        assertOptionalString(raw.source, configPath, "source");
    }

    const path = parent === null ? [] : [...parent.path, key];
    const id = raw.id ?? (parent === null ? ctx.id : [ctx.id, ...path].join(STATE_DELIMITER));
    const existing = ctx.idMap.get(id);
    if (existing !== undefined) {
        fail(
            configPath,
            `duplicate state node id '${id}' (already used by ${existing.configPath ? `'${existing.configPath}'` : "the root"})`,
        );
    }

    const entryPath = joinPath(configPath, "entry");
    const exitPath = joinPath(configPath, "exit");
    const node: MutableNode<TContext, TEvent> = {
        id,
        key,
        path: Object.freeze(path),
        type,
        order: ctx.nodes.length,
        parent,
        children: [],
        childrenByKey: new Map(),
        initial: null,
        transitions: new Map(),
        always: Object.freeze([]),
        after: Object.freeze([]),
        entry: validateActions<TContext, TEvent>(raw.entry, entryPath, ctx.references),
        exit: validateActions<TContext, TEvent>(raw.exit, exitPath, ctx.references),
        history: resolveHistory(raw, configPath, type),
        historyTarget: null,
        output: type === "final" || isRoot ? (raw.output as OutputResolver<TContext>) : undefined,
        tags: resolveTags(raw.tags, configPath),
        meta: raw.meta,
        description: raw.description,
        config: raw as unknown as StateNodeConfig<TContext, TEvent>,
        configPath,
    };
    ctx.nodes.push(node);
    ctx.idMap.set(id, node);

    const children: MutableNode<TContext, TEvent>[] = [];
    const childrenByKey = new Map<string, MutableNode<TContext, TEvent>>();
    for (const childKey of childKeys) {
        const child = buildNode(
            ctx,
            states[childKey] as RawConfig,
            childKey,
            node,
            joinPath(configPath, `states.${childKey}`),
        );
        children.push(child);
        childrenByKey.set(childKey, child);
    }
    node.children = Object.freeze(children);
    node.childrenByKey = childrenByKey;

    if (type === "compound") {
        const initialKey = raw.initial;
        if (initialKey === undefined) {
            fail(
                configPath,
                `No initial state specified for compound state node "#${id}". Try adding { initial: "${childKeys[0]}" } to the state config.`,
            );
        }
        const initialChild = childrenByKey.get(initialKey as string);
        if (initialChild === undefined) {
            fail(configPath, `Initial state node "${String(initialKey)}" not found on parent state node #${id}`);
        }
        if (initialChild.type === "history") {
            fail(
                configPath,
                `'initial' must name a regular child state, not the history state node "${String(initialKey)}"`,
            );
        }
    }

    return node;
}

// --- pass 2: transitions ---------------------------------------------------

function appendTransitions<TContext extends MachineContext, TEvent extends EventObject>(
    transitions: Map<string, Transition<TContext, TEvent>[]>,
    eventType: string,
    list: readonly Transition<TContext, TEvent>[],
): void {
    const existing = transitions.get(eventType);
    if (existing === undefined) {
        transitions.set(eventType, [...list]);
    } else {
        existing.push(...list);
    }
}

function linkNode<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: BuildContext<TContext, TEvent>,
    node: MutableNode<TContext, TEvent>,
): void {
    const raw = node.config as unknown as RawConfig;
    const p = node.configPath;
    const transitions = new Map<string, Transition<TContext, TEvent>[]>();

    if (node.type === "compound") {
        // Existence was checked in pass 1.
        const initialChild = node.childrenByKey.get(raw.initial as string)!;
        const initial: InitialTransition<TContext, TEvent> = Object.freeze({
            source: node,
            target: Object.freeze([initialChild] as const),
            actions: Object.freeze([]),
            guard: null,
            reenter: false,
            eventType: null,
            delay: null,
            description: undefined,
            meta: undefined,
            configPath: joinPath(p, "initial"),
        });
        node.initial = initial;
    }

    if (raw.on !== undefined) {
        const onPath = joinPath(p, "on");
        assertPlainObject(raw.on, onPath, "'on'");
        for (const descriptor of Object.keys(raw.on)) {
            validateEventDescriptor(descriptor, onPath);
            const list = formatTransitionList(
                ctx,
                node,
                descriptor,
                raw.on[descriptor],
                `${onPath}.${descriptor}`,
                "on",
                null,
            );
            appendTransitions(transitions, descriptor, list);
        }
    }

    if (raw.onDone !== undefined) {
        const eventType = createDoneStateEventType(node.id);
        const list = formatTransitionList(ctx, node, eventType, raw.onDone, joinPath(p, "onDone"), "onDone", null);
        appendTransitions(transitions, eventType, list);
    }

    const entry: ModelAction<TContext, TEvent>[] = [...node.entry];
    const exit: ModelAction<TContext, TEvent>[] = [...node.exit];
    const after: Transition<TContext, TEvent>[] = [];
    if (raw.after !== undefined) {
        const afterPath = joinPath(p, "after");
        assertPlainObject(raw.after, afterPath, "'after'");
        for (const key of Object.keys(raw.after)) {
            if (key.length === 0) fail(afterPath, "delay keys must be non-empty");
            const delayRef = Number.isNaN(+key) ? key : +key;
            const keyPath = `${afterPath}.${key}`;
            if (typeof delayRef === "number") {
                if (!Number.isFinite(delayRef) || delayRef < 0) {
                    fail(keyPath, `numeric delay must be a non-negative finite number (got ${key})`);
                }
            } else {
                ctx.references.delays.add(delayRef);
            }
            const eventType = createAfterEventType(delayRef, node.id);
            // Mirrors XState `getDelayedTransitions`: one raise/cancel pair per key, in key order.
            entry.push(
                raise<TContext, ModelEvent<TEvent>, AfterEvent>(
                    { type: eventType },
                    { id: eventType, delay: delayRef },
                ) as unknown as ModelAction<TContext, TEvent>,
            );
            exit.push(cancel<TContext, ModelEvent<TEvent>>(eventType) as unknown as ModelAction<TContext, TEvent>);
            const list = formatTransitionList(ctx, node, eventType, raw.after[key], keyPath, "after", delayRef);
            after.push(...list);
            appendTransitions(transitions, eventType, list);
        }
    }

    if (raw.always !== undefined) {
        node.always = Object.freeze(
            formatTransitionList(ctx, node, NULL_EVENT, raw.always, joinPath(p, "always"), "always", null),
        );
    }

    if (node.type === "history" && raw.target !== undefined) {
        node.historyTarget = resolveTargets(ctx, node, [raw.target as string], joinPath(p, "target"));
    }

    const frozenTransitions = new Map<string, readonly Transition<TContext, TEvent>[]>();
    for (const [eventType, list] of transitions) frozenTransitions.set(eventType, Object.freeze(list));
    node.transitions = frozenTransitions;
    node.after = Object.freeze(after);
    node.entry = Object.freeze(entry);
    node.exit = Object.freeze(exit);
}

// --- entry point -----------------------------------------------------------

/**
 * An object `context` is shared by every instance (XState parity, spec 1.2);
 * an absent one yields a fresh `{}` per instance; a factory is used as is.
 */
function resolveContextFactory<TContext extends MachineContext>(context: unknown): ContextFactory<TContext> {
    if (typeof context === "function") return context as ContextFactory<TContext>;
    if (context === undefined) return () => ({}) as TContext;
    const value = context as TContext;
    return () => value;
}

/**
 * Builds the model in two passes: (1) create every `StateNode` in document
 * order, assign ids, register them in `idMap`; (2) resolve transition targets
 * (`#id`, `#id.a.b`, `.child`, sibling keys), history default targets and the
 * `initial` transitions, synthesize `onDone` / `after` descriptors and the
 * `after` raise/cancel actions, collect `references`.
 *
 * Pure with respect to `config`: nothing is mutated or frozen here, so a
 * rejected config is handed back untouched. `createMachine` deep-freezes it
 * only after every validation passed; the model keeps references to the very
 * same objects, which therefore end up frozen too.
 */
export function normalize<TContext extends MachineContext, TEvent extends EventObject>(
    config: MachineConfig<TContext, TEvent>,
): MachineModel<TContext, TEvent> {
    assertPlainObject(config, "", "machine config");
    validateId(config.id, "");
    const machineId = config.id ?? DEFAULT_MACHINE_ID;
    const ctx: BuildContext<TContext, TEvent> = {
        id: machineId,
        nodes: [],
        idMap: new Map(),
        references: { actions: new Set(), guards: new Set(), delays: new Set() },
    };

    const root = buildNode(ctx, config as RawConfig, machineId, null, "");
    for (const node of ctx.nodes) linkNode(ctx, node);
    for (const node of ctx.nodes) Object.freeze(node);

    const references: ModelReferences = Object.freeze({
        actions: ctx.references.actions,
        guards: ctx.references.guards,
        delays: ctx.references.delays,
    });

    return Object.freeze({
        id: machineId,
        root,
        nodes: Object.freeze([...ctx.nodes]),
        idMap: ctx.idMap,
        context: resolveContextFactory<TContext>((config as RawConfig).context),
        references,
        config,
    });
}

/** Mutable `references` collector, also used by the lazy implementation checks (`MachineDefinition`). */
export function createReferenceCollector(): ReferenceCollector {
    return { actions: new Set(), guards: new Set(), delays: new Set() };
}
