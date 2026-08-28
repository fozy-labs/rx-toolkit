/**
 * Pure SCXML/XState step algorithm over `MachineModel` / `MachineState`.
 * No timers, no signals, no side effects except the executor callbacks, which
 * are invoked in the exact XState order. Port of `node_modules/xstate/dist/`
 * `raise-*.development.esm.js` (`microstep`, `macrostep`, `exitStates`,
 * `enterStates`, `selectEventlessTransitions`, `transitionNode`,
 * `resolveAndExecuteActionsWithContext`, `evaluateGuard`, ...) and of
 * `StateNode.next` / `StateMachine.getInitialSnapshot`.
 * Spec: section 3.
 */
import { Immer } from "immer";

import type {
    ActionArgs,
    ActionFunction,
    BuiltinAction,
    BuiltinGuard,
    DynamicParams,
    EventObject,
    GuardPredicate,
    MachineContext,
    MachineEvent,
    MachineSnapshot,
    Mapper,
    RaiseAction,
    ResolvedMachineImplementations,
    SnapshotStatus,
    StateValue,
} from "../types";
import { BUILTIN } from "../types/brand";
import type { NonReducibleUnknown } from "../types/common";

import {
    areStateNodeCollectionsEqual,
    getHistoryNodes,
    getInitialStateNodes,
    getProperAncestors,
    isAtomicStateNode,
    isDescendant,
    isInFinalState,
} from "./configuration";
import {
    createDoneStateEvent,
    createInitEvent,
    STATE_IDENTIFIER,
    WILDCARD,
    XSTATE_INIT,
    XSTATE_STOP,
} from "./constants";
import { isBuiltin } from "./createBuiltin";
import type {
    MachineModel,
    MachineState,
    ModelAction,
    ModelEvent,
    ModelGuard,
    OutputResolver,
    StateNode,
    Transition,
} from "./model";
import { collectTags, getStateNodeById, getStateValue, matchesState } from "./stateValue";
import {
    computeEntrySet,
    computeExitSet,
    getCandidates,
    removeConflictingTransitions,
    type HistoryValue,
} from "./transitions";

/**
 * Immer instance of the `mutate` builtin. Auto-freeze is off: the produced
 * context (and the untouched subtrees it shares with the previous one, up to
 * the definition's initial `context` object) stays as mutable as `assign`
 * leaves it, and the definition's config is not frozen behind the user's back.
 */
const immer = new Immer({ autoFreeze: false });

// --- public contracts ------------------------------------------------------

/** A custom (named or inline) action handed to the executor. The executor calls `exec(args, params)`. */
export interface ExecutableCustomAction<TContext extends MachineContext, TEvent extends EventObject> {
    /** Action name, `fn.name` or `"(anonymous)"`. */
    readonly type: string;
    readonly exec: ActionFunction<TContext, MachineEvent<TEvent>, unknown>;
    /** `{ context, event }` with the context as of this action (earlier assigns applied). */
    readonly args: ActionArgs<TContext, MachineEvent<TEvent>>;
    readonly params: unknown;
}

export interface ScheduleRequest<TEvent extends EventObject> {
    readonly event: MachineEvent<TEvent>;
    /** Milliseconds, already resolved (named delays and delay functions applied). */
    readonly delay: number;
    /** `raise` / `after` id for `cancel`; `undefined` means "not cancellable by id". */
    readonly id: string | undefined;
}

/**
 * Side-effect boundary of the core. The engine (`Statechart`) implements it;
 * unit tests use a recording executor.
 */
export interface ActionExecutor<TContext extends MachineContext, TEvent extends EventObject> {
    custom(action: ExecutableCustomAction<TContext, TEvent>): void;
    /** Delayed `raise` (including `after`). */
    schedule(request: ScheduleRequest<TEvent>): void;
    /** `cancel(id)` builtin and the synthesized `after` cancels. */
    cancel(id: string): void;
    /** `log` builtin; `label` is `undefined` when absent. */
    log(value: unknown, label: string | undefined): void;
}

export interface InterpreterScope<TContext extends MachineContext, TEvent extends EventObject> {
    readonly implementations: ResolvedMachineImplementations<TContext, TEvent>;
    readonly executor: ActionExecutor<TContext, TEvent>;
    /** Throws `Error("Infinite loop detected: ...")` when a macrostep exceeds it. */
    readonly maxMicrosteps: number;
}

export interface StepResult<TContext extends MachineContext, TEvent extends EventObject> {
    /** The same object as the input state when nothing changed. */
    readonly state: MachineState<TContext, TEvent>;
}

// --- internal types --------------------------------------------------------

/** Constants of one macrostep plus the internal event queue (XState `internalQueue`). */
interface StepContext<TContext extends MachineContext, TEvent extends EventObject> {
    readonly model: MachineModel<TContext, TEvent>;
    readonly scope: InterpreterScope<TContext, TEvent>;
    readonly internalQueue: MachineEvent<TEvent>[];
}

/** Mutable working copy of the fields a microstep may change; committed into a new `MachineState` at its end. */
interface WorkingState<TContext extends MachineContext> {
    context: TContext;
    status: SnapshotStatus;
    output: unknown;
}

/**
 * Builtins as the interpreter calls them: expressions see `ModelEvent` (the
 * config's `TEvent` plus any system event — XState's "lie" for entry / always
 * / after actions) and untyped params (config builtins are typed with
 * `undefined`, table builtins with `never`; the interpreter passes whatever
 * the `{ type, params }` reference resolved to).
 */
type RuntimeBuiltinAction<TContext extends MachineContext, TEvent extends EventObject> = BuiltinAction<
    TContext,
    ModelEvent<TEvent>,
    TEvent,
    unknown
>;
type RuntimeBuiltinGuard<TContext extends MachineContext, TEvent extends EventObject> = BuiltinGuard<
    TContext,
    ModelEvent<TEvent>,
    unknown
>;
type RuntimeActionFunction<TContext extends MachineContext, TEvent extends EventObject> = ActionFunction<
    TContext,
    ModelEvent<TEvent>,
    unknown
>;
type RuntimeGuardPredicate<TContext extends MachineContext, TEvent extends EventObject> = GuardPredicate<
    TContext,
    ModelEvent<TEvent>,
    unknown
>;
type RuntimeArgs<TContext extends MachineContext, TEvent extends EventObject> = ActionArgs<
    TContext,
    MachineEvent<TEvent>
>;

// --- helpers ---------------------------------------------------------------

/** Own-property lookup: an implementation table never falls back to `Object.prototype` members. */
function lookup<T>(table: Readonly<Record<string, T>>, name: string): T | undefined {
    return Object.hasOwn(table, name) ? table[name] : undefined;
}

/** XState: `typeof params === "function" ? params({ context, event }) : params`. */
function resolveParams<TContext extends MachineContext, TEvent extends EventObject>(
    params: DynamicParams<TContext, ModelEvent<TEvent>, NonReducibleUnknown> | undefined,
    args: RuntimeArgs<TContext, TEvent>,
): unknown {
    return typeof params === "function" ? (params as (args: RuntimeArgs<TContext, TEvent>) => unknown)(args) : params;
}

/** XState `resolveOutput`: a mapper is called with `{ context, event }`, anything else is the output itself. */
function resolveOutput<TContext extends MachineContext>(
    output: OutputResolver<TContext>,
    context: TContext,
    event: EventObject,
): unknown {
    return typeof output === "function"
        ? (output as Mapper<TContext, EventObject, unknown>)({ context, event })
        : output;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function byOrderAscending<TContext extends MachineContext, TEvent extends EventObject>(
    a: StateNode<TContext, TEvent>,
    b: StateNode<TContext, TEvent>,
): number {
    return a.order - b.order;
}

function byOrderDescending<TContext extends MachineContext, TEvent extends EventObject>(
    a: StateNode<TContext, TEvent>,
    b: StateNode<TContext, TEvent>,
): number {
    return b.order - a.order;
}

// --- actions (port of `resolveAndExecuteActionsWithContext`) ---------------

/**
 * Runs `actions` in order against the working state. `assign` is applied
 * here (subsequent actions see the new context), immediate `raise` goes to
 * the internal queue, everything else is handed to the executor.
 */
function executeActions<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    run: WorkingState<TContext>,
    actions: readonly ModelAction<TContext, TEvent>[],
    event: MachineEvent<TEvent>,
): void {
    for (const action of actions) {
        const args: RuntimeArgs<TContext, TEvent> = { context: run.context, event };
        if (typeof action === "string" || typeof action === "object") {
            const type = typeof action === "string" ? action : action.type;
            const implementation = lookup(ctx.scope.implementations.actions, type);
            if (implementation === undefined) throw new Error(`Action '${type}' is not implemented.`);
            // Params are resolved before dispatching, like XState (a params function runs even for builtins).
            const params = typeof action === "string" ? undefined : resolveParams(action.params, args);
            if (isBuiltin(implementation)) {
                executeBuiltinAction(ctx, run, implementation as RuntimeBuiltinAction<TContext, TEvent>, args, params);
            } else {
                ctx.scope.executor.custom({
                    type,
                    exec: implementation as RuntimeActionFunction<TContext, TEvent>,
                    args,
                    params,
                });
            }
            continue;
        }
        if (isBuiltin(action)) {
            executeBuiltinAction(ctx, run, action as RuntimeBuiltinAction<TContext, TEvent>, args, undefined);
            continue;
        }
        ctx.scope.executor.custom({
            type: action.name || "(anonymous)",
            exec: action as RuntimeActionFunction<TContext, TEvent>,
            args,
            params: undefined,
        });
    }
}

function executeBuiltinAction<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    run: WorkingState<TContext>,
    builtin: RuntimeBuiltinAction<TContext, TEvent>,
    args: RuntimeArgs<TContext, TEvent>,
    params: unknown,
): void {
    switch (builtin[BUILTIN]) {
        case "assign": {
            const { assignment } = builtin;
            let partial: Partial<TContext>;
            if (typeof assignment === "function") {
                partial = assignment(args, params);
            } else {
                partial = {};
                for (const key of Object.keys(assignment) as (keyof TContext)[]) {
                    const propertyAssignment = assignment[key];
                    partial[key] =
                        typeof propertyAssignment === "function"
                            ? (
                                  propertyAssignment as (
                                      a: RuntimeArgs<TContext, TEvent>,
                                      p: unknown,
                                  ) => TContext[typeof key]
                              )(args, params)
                            : (propertyAssignment as TContext[typeof key]);
                }
            }
            // Always a new object (XState `Object.assign({}, context, partial)`); the previous one is never mutated.
            run.context = { ...run.context, ...partial };
            return;
        }
        case "mutate": {
            const { recipe } = builtin;
            // The wrapper returns nothing, so whatever the recipe returns never replaces the draft.
            run.context = immer.produce(run.context, (draft) => {
                recipe({ context: draft as TContext, event: args.event }, params);
            });
            return;
        }
        case "raise": {
            const { event: eventOrExpr, delay, id } = builtin;
            const event = typeof eventOrExpr === "function" ? eventOrExpr(args, params) : eventOrExpr;
            assertRaisedEvent(event);
            const resolvedDelay = resolveDelay(ctx, delay, args, params);
            if (resolvedDelay === undefined) {
                ctx.internalQueue.push(event);
            } else {
                ctx.scope.executor.schedule({ event, delay: resolvedDelay, id });
            }
            return;
        }
        case "cancel": {
            const { sendId } = builtin;
            const id = typeof sendId === "function" ? sendId(args, params) : sendId;
            if (typeof id !== "string") {
                throw new Error(
                    `cancel() expected a string id, got ${typeof id === "object" ? "an object" : typeof id}`,
                );
            }
            ctx.scope.executor.cancel(id);
            return;
        }
        case "log": {
            const { value, label } = builtin;
            ctx.scope.executor.log(typeof value === "function" ? value(args, params) : value, label);
            return;
        }
    }
}

function assertRaisedEvent(event: unknown): asserts event is EventObject {
    if (typeof event !== "object" || event === null || typeof (event as Partial<EventObject>).type !== "string") {
        throw new Error("raise() expected an event object with a string 'type'");
    }
    if ((event as EventObject).type === WILDCARD) {
        throw new Error(`An event cannot have the wildcard type ('${WILDCARD}')`);
    }
}

/**
 * Port of the delay branch of XState `resolveRaise`: a number as is, a named
 * delay through `implementations.delays` (number or function), a function
 * called with `(args, params)`. `undefined` = immediate. Unlike XState, a
 * delay that does not resolve to a non-negative finite number throws instead
 * of silently raising immediately (spec 3.6).
 */
function resolveDelay<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    delay: RaiseAction<TContext, ModelEvent<TEvent>, TEvent, unknown>["delay"],
    args: RuntimeArgs<TContext, TEvent>,
    params: unknown,
): number | undefined {
    if (delay === undefined) return undefined;
    let resolved: unknown;
    let label: string;
    if (typeof delay === "string") {
        const implementation = lookup(ctx.scope.implementations.delays, delay);
        if (implementation === undefined) throw new Error(`Delay '${delay}' is not implemented.`);
        resolved =
            typeof implementation === "function"
                ? (implementation as (a: RuntimeArgs<TContext, TEvent>, p: unknown) => number)(args, params)
                : implementation;
        label = `'${delay}'`;
    } else if (typeof delay === "function") {
        resolved = delay(args, params);
        label = "expression";
    } else {
        resolved = delay;
        label = String(delay);
    }
    if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < 0) {
        throw new Error(`Delay ${label} resolved to ${String(resolved)}; expected a non-negative finite number`);
    }
    return resolved;
}

// --- guards (port of `evaluateGuard`) --------------------------------------

/**
 * XState `evaluateGuard`: names resolve through `implementations.guards`
 * (recursively — an implementation may itself be a builtin), `{ type, params }`
 * resolves dynamic params, builtins `and` / `or` / `not` / `stateIn` are
 * evaluated structurally. Throws `Error("Guard '<name>' is not implemented.")`.
 */
export function evaluateGuard<TContext extends MachineContext, TEvent extends EventObject>(
    guard: ModelGuard<TContext, TEvent>,
    args: ActionArgs<TContext, MachineEvent<TEvent>>,
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): boolean {
    if (typeof guard === "string" || typeof guard === "object") {
        const type = typeof guard === "string" ? guard : guard.type;
        const implementation = lookup(scope.implementations.guards, type);
        if (implementation === undefined) throw new Error(`Guard '${type}' is not implemented.`);
        // Resolved before dispatching, like XState (a params function runs even for builtins, which ignore it).
        const params = typeof guard === "string" ? undefined : resolveParams(guard.params, args);
        if (isBuiltin(implementation)) {
            return evaluateBuiltinGuard(
                implementation as RuntimeBuiltinGuard<TContext, TEvent>,
                args,
                model,
                state,
                scope,
            );
        }
        return Boolean((implementation as RuntimeGuardPredicate<TContext, TEvent>)(args, params));
    }
    if (isBuiltin(guard)) {
        return evaluateBuiltinGuard(guard as RuntimeBuiltinGuard<TContext, TEvent>, args, model, state, scope);
    }
    return Boolean(guard(args, undefined));
}

function evaluateBuiltinGuard<TContext extends MachineContext, TEvent extends EventObject>(
    builtin: RuntimeBuiltinGuard<TContext, TEvent>,
    args: RuntimeArgs<TContext, TEvent>,
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): boolean {
    switch (builtin[BUILTIN]) {
        case "and":
            return builtin.guards.every((guard) => evaluateGuard(guard, args, model, state, scope));
        case "or":
            return builtin.guards.some((guard) => evaluateGuard(guard, args, model, state, scope));
        case "not":
            return !evaluateGuard(builtin.guard, args, model, state, scope);
        case "stateIn": {
            const { stateValue } = builtin;
            if (typeof stateValue === "string" && stateValue.startsWith(STATE_IDENTIFIER)) {
                return state.configuration.has(getStateNodeById(model, stateValue));
            }
            return matchesState(stateValue, getStateValue(model, state.configuration));
        }
    }
}

// --- transition selection (port of `transitionNode` / `StateNode.next`) ----

/**
 * XState `StateNode.next`: the first candidate whose guard is absent or
 * passes. Guard exceptions are wrapped with the XState message (`cause` set).
 */
function selectNodeTransition<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): readonly Transition<TContext, TEvent>[] | undefined {
    for (const candidate of getCandidates(node, event.type)) {
        const { guard } = candidate;
        let passed = false;
        try {
            passed = guard === null || evaluateGuard(guard, { context: state.context, event }, model, state, scope);
        } catch (error) {
            const guardType = typeof guard === "string" ? guard : typeof guard === "object" ? guard?.type : undefined;
            throw new Error(
                `Unable to evaluate guard ${guardType ? `'${guardType}' ` : ""}in transition for event '${event.type}' in state node '${node.id}':\n${errorMessage(error)}`,
                { cause: error },
            );
        }
        if (passed) return [candidate];
    }
    return undefined;
}

function getChildByKey<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    key: string,
): StateNode<TContext, TEvent> {
    const child = node.childrenByKey.get(key);
    if (child === undefined) throw new Error(`Child state '${key}' does not exist on '${node.id}'`);
    return child;
}

/**
 * XState `transitionNode`: walks the state value like the original — a
 * string leaf asks the child first and falls back to the node; an object with
 * one key recurses into that child; any other object is treated as parallel
 * regions whose results are concatenated (the node itself is asked only when
 * every region returned nothing).
 */
function transitionNode<TContext extends MachineContext, TEvent extends EventObject>(
    node: StateNode<TContext, TEvent>,
    stateValue: StateValue,
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): readonly Transition<TContext, TEvent>[] | undefined {
    if (typeof stateValue === "string") {
        const child = getChildByKey(node, stateValue);
        return (
            selectNodeTransition(child, model, state, event, scope) ??
            selectNodeTransition(node, model, state, event, scope)
        );
    }
    const keys = Object.keys(stateValue);
    if (keys.length === 1) {
        const [key] = keys;
        const childValue = stateValue[key];
        const next =
            childValue === undefined
                ? undefined
                : transitionNode(getChildByKey(node, key), childValue, model, state, event, scope);
        return next?.length ? next : selectNodeTransition(node, model, state, event, scope);
    }
    const inner: Transition<TContext, TEvent>[] = [];
    for (const key of keys) {
        const childValue = stateValue[key];
        if (childValue === undefined) continue;
        const next = transitionNode(getChildByKey(node, key), childValue, model, state, event, scope);
        if (next !== undefined) inner.push(...next);
    }
    return inner.length ? inner : selectNodeTransition(node, model, state, event, scope);
}

/**
 * XState `getTransitionData` + `next`: the enabled transitions for `event`
 * (guards evaluated, first match per node, descendants shadow ancestors,
 * parallel regions concatenated). Empty when nothing is enabled.
 */
export function selectTransitions<TContext extends MachineContext, TEvent extends EventObject>(
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): readonly Transition<TContext, TEvent>[] {
    return transitionNode(model.root, getStateValue(model, state.configuration), model, state, event, scope) ?? [];
}

/**
 * XState `selectEventlessTransitions`: for every active atomic/final node the
 * first enabled `always` transition of the node or of its closest ancestor
 * that has one; conflicts removed. Guard errors propagate unwrapped (XState
 * calls `evaluateGuard` directly here).
 */
function selectEventlessTransitions<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
): Transition<TContext, TEvent>[] {
    const enabled = new Set<Transition<TContext, TEvent>>();
    const args: RuntimeArgs<TContext, TEvent> = { context: state.context, event };
    for (const node of state.configuration) {
        if (!isAtomicStateNode(node)) continue;
        const transition = findEnabledAlwaysTransition(ctx, state, args, [node, ...getProperAncestors(node, null)]);
        if (transition !== undefined) enabled.add(transition);
    }
    return removeConflictingTransitions([...enabled], state.configuration, state.historyValue);
}

function findEnabledAlwaysTransition<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    args: RuntimeArgs<TContext, TEvent>,
    nodes: readonly StateNode<TContext, TEvent>[],
): Transition<TContext, TEvent> | undefined {
    for (const node of nodes) {
        for (const transition of node.always) {
            if (transition.guard === null || evaluateGuard(transition.guard, args, ctx.model, state, ctx.scope)) {
                return transition;
            }
        }
    }
    return undefined;
}

// --- microstep (port of `microstep` / `exitStates` / `enterStates`) --------

/**
 * XState `exitStates`: records history for every exited node (first pass,
 * while the set is still complete — deeper nodes must not be deleted before
 * an ancestor records deep history), then runs `exit` actions and removes
 * the nodes in document order descending (second pass). Returns the history
 * value, unchanged (same object) when nothing was recorded.
 */
function exitStates<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    run: WorkingState<TContext>,
    event: MachineEvent<TEvent>,
    transitions: readonly Transition<TContext, TEvent>[],
    nodeSet: Set<StateNode<TContext, TEvent>>,
    historyValue: HistoryValue<TContext, TEvent>,
): HistoryValue<TContext, TEvent> {
    const statesToExit = computeExitSet(transitions, nodeSet, historyValue).sort(byOrderDescending);
    let changedHistory: Record<string, readonly StateNode<TContext, TEvent>[]> | undefined;

    for (const exitNode of statesToExit) {
        for (const historyNode of getHistoryNodes(exitNode)) {
            const predicate =
                historyNode.history === "deep"
                    ? (node: StateNode<TContext, TEvent>) => isAtomicStateNode(node) && isDescendant(node, exitNode)
                    : (node: StateNode<TContext, TEvent>) => node.parent === exitNode;
            changedHistory ??= { ...historyValue };
            changedHistory[historyNode.id] = Object.freeze([...nodeSet].filter(predicate));
        }
    }
    for (const node of statesToExit) {
        executeActions(ctx, run, node.exit, event);
        nodeSet.delete(node);
    }
    return changedHistory === undefined ? historyValue : Object.freeze(changedHistory);
}

/**
 * XState `getMachineOutput`: the root `output` resolved with a
 * `xstate.done.state.<completion node>` event carrying the completion node's
 * own output — unless the completion node is the root (a parallel root's
 * `output` is the machine output, resolved once).
 */
function getMachineOutput<TContext extends MachineContext, TEvent extends EventObject>(
    model: MachineModel<TContext, TEvent>,
    context: TContext,
    event: MachineEvent<TEvent>,
    rootCompletionNode: StateNode<TContext, TEvent>,
): unknown {
    const { root } = model;
    if (root.output === undefined) return undefined;
    const doneEvent = createDoneStateEvent(
        rootCompletionNode.id,
        rootCompletionNode.output !== undefined && rootCompletionNode.parent !== null
            ? resolveOutput(rootCompletionNode.output, context, event)
            : undefined,
    );
    return resolveOutput(root.output, context, doneEvent);
}

/**
 * XState `enterStates`: enters the computed entry set in document order,
 * running `entry` actions, queueing `xstate.done.state.*` for completed
 * compound / parallel ancestors and finishing the machine when a top-level
 * completion is reached.
 */
function enterStates<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    run: WorkingState<TContext>,
    event: MachineEvent<TEvent>,
    transitions: readonly Transition<TContext, TEvent>[],
    nodeSet: Set<StateNode<TContext, TEvent>>,
    historyValue: HistoryValue<TContext, TEvent>,
    isInitial: boolean,
): void {
    const { statesToEnter, statesForDefaultEntry } = computeEntrySet(transitions, historyValue);
    // In the initial state the root is "entered" too.
    if (isInitial) statesForDefaultEntry.add(ctx.model.root);

    const completedNodes = new Set<StateNode<TContext, TEvent>>();
    for (const node of [...statesToEnter].sort(byOrderAscending)) {
        nodeSet.add(node);
        const actions = [...node.entry];
        if (statesForDefaultEntry.has(node) && node.initial !== null) actions.push(...node.initial.actions);
        executeActions(ctx, run, actions, event);

        if (node.type !== "final") continue;
        const parent = node.parent;
        let ancestorMarker = parent?.type === "parallel" ? parent : (parent?.parent ?? null);
        let rootCompletionNode = ancestorMarker ?? node;
        if (parent?.type === "compound") {
            ctx.internalQueue.push(
                createDoneStateEvent(
                    parent.id,
                    node.output !== undefined ? resolveOutput(node.output, run.context, event) : undefined,
                ),
            );
        }
        while (
            ancestorMarker?.type === "parallel" &&
            !completedNodes.has(ancestorMarker) &&
            isInFinalState(nodeSet, ancestorMarker)
        ) {
            completedNodes.add(ancestorMarker);
            ctx.internalQueue.push(createDoneStateEvent(ancestorMarker.id, undefined));
            rootCompletionNode = ancestorMarker;
            ancestorMarker = ancestorMarker.parent;
        }
        if (ancestorMarker !== null) continue;
        run.status = "done";
        run.output = getMachineOutput(ctx.model, run.context, event, rootCompletionNode);
    }
}

/** XState `microstep` (https://www.w3.org/TR/scxml/#microstepProcedure). */
function microstep<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    transitions: readonly Transition<TContext, TEvent>[],
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
    isInitial: boolean,
): MachineState<TContext, TEvent> {
    if (transitions.length === 0) return state;

    const nodeSet = new Set(state.configuration);
    let historyValue = state.historyValue;
    const filtered = removeConflictingTransitions(transitions, nodeSet, historyValue);
    const run: WorkingState<TContext> = { context: state.context, status: state.status, output: state.output };

    if (!isInitial) historyValue = exitStates(ctx, run, event, filtered, nodeSet, historyValue);
    executeActions(
        ctx,
        run,
        filtered.flatMap((transition) => transition.actions),
        event,
    );
    enterStates(ctx, run, event, filtered, nodeSet, historyValue, isInitial);
    if (run.status === "done") {
        // XState exits every active node once the machine is done (this also cancels every `after` timer).
        executeActions(
            ctx,
            run,
            [...nodeSet].sort(byOrderDescending).flatMap((node) => node.exit),
            event,
        );
    }

    const sameNodes = historyValue === state.historyValue && areStateNodeCollectionsEqual(state.configuration, nodeSet);
    if (sameNodes && run.context === state.context && run.status === state.status && run.output === state.output) {
        return state;
    }
    return {
        // XState keeps the previous `_nodes` (and their order) when the set did not change.
        configuration: sameNodes ? state.configuration : nodeSet,
        context: run.context,
        historyValue,
        status: run.status,
        output: run.output,
        error: state.error,
    };
}

// --- macrostep (port of `macrostep`) ---------------------------------------

/**
 * The loop of XState `macrostep`: `always` transitions are re-evaluated after
 * every microstep that changed something, the internal queue is drained one
 * event per microstep, until the machine is stable or no longer active.
 * Leftover queued events are dropped when the loop exits early.
 */
function runMacrostepLoop<TContext extends MachineContext, TEvent extends EventObject>(
    ctx: StepContext<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
): MachineState<TContext, TEvent> {
    const { maxMicrosteps } = ctx.scope;
    let next = state;
    let currentEvent = event;
    let shouldSelectEventless = true;
    let iterations = 0;

    while (next.status === "active") {
        iterations++;
        if (iterations > maxMicrosteps) {
            throw new Error(
                `Infinite loop detected: the machine has processed more than ${maxMicrosteps} microsteps without reaching a stable state. This usually happens when there's a cycle of transitions (e.g., eventless transitions or raised events causing state A -> B -> C -> A).`,
            );
        }
        let enabled: readonly Transition<TContext, TEvent>[] = shouldSelectEventless
            ? selectEventlessTransitions(ctx, next, currentEvent)
            : [];
        // Eventless transitions are always selected after a *regular* microstep: `previous` stays
        // undefined then, so `shouldSelectEventless` is recomputed as true.
        const previous = enabled.length > 0 ? next : undefined;
        if (enabled.length === 0) {
            const queued = ctx.internalQueue.shift();
            if (queued === undefined) break;
            currentEvent = queued;
            enabled = selectTransitions(ctx.model, next, currentEvent, ctx.scope);
        }
        next = microstep(ctx, enabled, next, currentEvent, false);
        shouldSelectEventless = next !== previous;
    }
    return next;
}

/**
 * The initial `context`: an object context is used as is (one mutable object
 * shared by every instance, XState parity), a factory result is shallow-copied
 * (XState applies it as an `assign` over `{}`), an absent context is `{}`.
 */
function resolveInitialContext<TContext extends MachineContext, TEvent extends EventObject>(
    model: MachineModel<TContext, TEvent>,
): TContext {
    const produced = model.context();
    return typeof model.config.context === "function" ? ({ ...produced } as TContext) : produced;
}

// --- exports ---------------------------------------------------------------

/**
 * Initial macrostep: pre-initial state (`context` factory, root only) ->
 * initial microstep (`reenter: true` into the initial nodes, no exits) ->
 * `macrostep` with the `xstate.init` event draining the internal queue.
 * Port of `StateMachine.getInitialSnapshot` + `initialMicrostep`.
 */
export function initialize<TContext extends MachineContext, TEvent extends EventObject>(
    model: MachineModel<TContext, TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): StepResult<TContext, TEvent> {
    const initEvent = createInitEvent();
    const ctx: StepContext<TContext, TEvent> = { model, scope, internalQueue: [] };
    const preInitial: MachineState<TContext, TEvent> = {
        configuration: new Set([model.root]),
        context: resolveInitialContext(model),
        historyValue: Object.freeze({}),
        status: "active",
        output: undefined,
        error: undefined,
    };
    const initialTransition: Transition<TContext, TEvent> = {
        source: model.root,
        // Includes the root itself, like XState `getInitialStateNodes(root)`: the root is entered too.
        target: [...getInitialStateNodes(model.root)],
        actions: [],
        guard: null,
        reenter: true,
        eventType: null,
        delay: null,
        description: undefined,
        meta: undefined,
        configPath: "",
    };
    const afterInitialMicrostep = microstep(ctx, [initialTransition], preInitial, initEvent, true);
    return { state: runMacrostepLoop(ctx, afterInitialMicrostep, initEvent) };
}

/**
 * One full macrostep for `event` (XState `macrostep`): select transitions,
 * microstep, then loop over `always` transitions and the internal queue until
 * stable or `status !== "active"`. `xstate.stop` -> `status: "stopped"`
 * without running any action. Throws whatever an action/guard/delay threw
 * (guard errors wrapped like XState); the caller commits the error status.
 *
 * A state that is no longer `active` (done / error / stopped) is returned
 * unchanged for any event: XState never lets a finished actor transition.
 */
export function step<TContext extends MachineContext, TEvent extends EventObject>(
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): StepResult<TContext, TEvent> {
    if (event.type === WILDCARD) throw new Error(`An event cannot have the wildcard type ('${WILDCARD}')`);
    if (state.status !== "active") return { state };
    if (event.type === XSTATE_STOP) return { state: { ...state, status: "stopped" } };

    const ctx: StepContext<TContext, TEvent> = { model, scope, internalQueue: [] };
    let next = state;
    if (event.type !== XSTATE_INIT) {
        next = microstep(ctx, selectTransitions(model, next, event, scope), next, event, false);
    }
    return { state: runMacrostepLoop(ctx, next, event) };
}

/**
 * XState `snapshot.can`: some selected transition has a target or actions
 * (a "forbidden" transition alone does not count). Always `false` when the
 * state is not `active`.
 */
export function canHandle<TContext extends MachineContext, TEvent extends EventObject>(
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
    event: MachineEvent<TEvent>,
    scope: InterpreterScope<TContext, TEvent>,
): boolean {
    if (state.status !== "active") return false;
    return selectTransitions(model, state, event, scope).some(
        (transition) => transition.target !== null || transition.actions.length > 0,
    );
}

/** Builds the public, frozen snapshot of a state (value, tags, status, context, output, error). */
export function createSnapshot<TContext extends MachineContext, TEvent extends EventObject, TOutput = unknown>(
    model: MachineModel<TContext, TEvent>,
    state: MachineState<TContext, TEvent>,
): MachineSnapshot<TContext, TOutput> {
    return Object.freeze({
        status: state.status,
        value: getStateValue(model, state.configuration),
        context: state.context,
        tags: collectTags(state.configuration),
        output: state.status === "done" ? state.output : undefined,
        error: state.status === "error" ? state.error : undefined,
    }) as MachineSnapshot<TContext, TOutput>;
}
