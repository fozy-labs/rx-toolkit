/**
 * Unit tests of the pure step algorithm. Every expectation is hand-computed
 * from the XState v5 rules (see the comments next to the traces); the last
 * block additionally replays a set of clock-less scenarios through xstate's
 * `createActor` and compares snapshots and action traces step by step.
 */
import {
    createActor,
    createMachine as createXStateMachine,
    and as xAnd,
    assign as xAssign,
    log as xLog,
    not as xNot,
    or as xOr,
    raise as xRaise,
    stateIn as xStateIn,
} from "xstate";

import { assign, cancel, log, mutate, raise } from "../actions";
import { createMachine } from "../createMachine";
import { and, not, or, stateIn } from "../guards";
import { getMachineModel, type MachineDefinition } from "../MachineDefinition";
import type { AnyEventObject, EventObject, MachineContext, MachineEvent, MachineSnapshot, StateValue } from "../types";

import { XSTATE_INIT, XSTATE_STOP } from "./constants";
import {
    canHandle,
    createSnapshot,
    evaluateGuard,
    initialize,
    selectTransitions,
    step,
    type ActionExecutor,
    type ExecutableCustomAction,
    type InterpreterScope,
    type ScheduleRequest,
} from "./interpreter";
import type { MachineModel, MachineState } from "./model";

// --- harness ---------------------------------------------------------------

interface Harness<TContext extends MachineContext, TEvent extends EventObject> {
    readonly model: MachineModel<TContext, TEvent>;
    readonly scope: InterpreterScope<TContext, TEvent>;
    /** Every executor call in order: custom action names, `schedule:<type>`, `cancel:<id>`, `log`. */
    readonly trace: string[];
    /** Custom action names only. */
    readonly actions: string[];
    readonly customs: ExecutableCustomAction<TContext, TEvent>[];
    readonly scheduled: ScheduleRequest<TEvent>[];
    readonly cancelled: string[];
    readonly logs: { value: unknown; label: string | undefined }[];
    state: MachineState<TContext, TEvent>;
    send(event: MachineEvent<TEvent>): MachineState<TContext, TEvent>;
    value(): StateValue;
    snapshot(): MachineSnapshot<TContext>;
    /** Ids of the active nodes in document order. */
    ids(): string[];
    can(event: MachineEvent<TEvent>): boolean;
    /** Clears the recorded traces (not the state). */
    clear(): void;
}

function start<TContext extends MachineContext, TEvent extends EventObject, TOutput>(
    definition: MachineDefinition<TContext, TEvent, TOutput>,
    options: { maxMicrosteps?: number } = {},
): Harness<TContext, TEvent> {
    const model = getMachineModel(definition);
    const trace: string[] = [];
    const actions: string[] = [];
    const customs: ExecutableCustomAction<TContext, TEvent>[] = [];
    const scheduled: ScheduleRequest<TEvent>[] = [];
    const cancelled: string[] = [];
    const logs: { value: unknown; label: string | undefined }[] = [];
    const executor: ActionExecutor<TContext, TEvent> = {
        custom(action) {
            trace.push(action.type);
            actions.push(action.type);
            customs.push(action);
            action.exec(action.args, action.params);
        },
        schedule(request) {
            trace.push(`schedule:${request.event.type}`);
            scheduled.push(request);
        },
        cancel(id) {
            trace.push(`cancel:${id}`);
            cancelled.push(id);
        },
        log(value, label) {
            trace.push("log");
            logs.push({ value, label });
        },
    };
    const scope: InterpreterScope<TContext, TEvent> = {
        implementations: definition.implementations,
        executor,
        maxMicrosteps: options.maxMicrosteps ?? 100,
    };
    const harness: Harness<TContext, TEvent> = {
        model,
        scope,
        trace,
        actions,
        customs,
        scheduled,
        cancelled,
        logs,
        state: initialize(model, scope).state,
        send(event) {
            harness.state = step(model, harness.state, event, scope).state;
            return harness.state;
        },
        value: () => createSnapshot(model, harness.state).value,
        snapshot: () => createSnapshot(model, harness.state),
        ids: () => [...harness.state.configuration].sort((a, b) => a.order - b.order).map((node) => node.id),
        can: (event) => canHandle(model, harness.state, event, scope),
        clear() {
            trace.length = 0;
            actions.length = 0;
            customs.length = 0;
            scheduled.length = 0;
            cancelled.length = 0;
            logs.length = 0;
        },
    };
    return harness;
}

/** A no-op action implementation table from names (the harness records the names itself). */
function noop(...names: string[]): Record<string, () => void> {
    return Object.fromEntries(names.map((name) => [name, () => undefined]));
}

// --- initial state ---------------------------------------------------------

describe("initialize", () => {
    it("resolves nested initial states and runs entry actions root-first in document order", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    entry: "rootIn",
                    states: {
                        a: {
                            entry: "aIn",
                            initial: "a2",
                            states: { a1: {}, a2: { entry: "a2In", initial: "x", states: { x: { entry: "xIn" } } } },
                        },
                        b: {},
                    },
                },
                { actions: noop("rootIn", "aIn", "a2In", "xIn") },
            ),
        );
        expect(h.trace).toEqual(["rootIn", "aIn", "a2In", "xIn"]);
        expect(h.ids()).toEqual(["m", "m.a", "m.a.a2", "m.a.a2.x"]);
        expect(h.value()).toEqual({ a: { a2: "x" } });
        expect(h.state.status).toBe("active");
        expect(h.state.historyValue).toEqual({});
    });

    it("enters every region of a parallel node", () => {
        const h = start(
            createMachine({
                id: "p",
                type: "parallel",
                states: {
                    a: { initial: "a1", states: { a1: {}, a2: {} } },
                    b: { initial: "b1", states: { b1: {}, b2: {} } },
                    c: {},
                },
            }),
        );
        expect(h.ids()).toEqual(["p", "p.a", "p.a.a1", "p.b", "p.b.b1", "p.c"]);
        expect(h.value()).toEqual({ a: "a1", b: "b1", c: {} });
    });

    it("passes the init event to initial actions with XState's shape: the `input` key is always present", () => {
        const h = start(
            createMachine({ id: "m", initial: "a", states: { a: { entry: "record" } } }, { actions: noop("record") }),
        );
        const event = h.customs[0]?.args.event;
        // toStrictEqual: toEqual would not tell `{ type }` from `{ type, input: undefined }`
        expect(event).toStrictEqual({ type: XSTATE_INIT, input: undefined });
        expect(Object.keys(event ?? {})).toEqual(["type", "input"]);
    });

    it("schedules `after` timers with XState's delayed event naming and the event type as the timer id", () => {
        const h = start(
            createMachine(
                {
                    id: "light",
                    initial: "green",
                    states: { green: { after: { 3000: "yellow", SHORT: "yellow" } }, yellow: {} },
                },
                { delays: { SHORT: 250 } },
            ),
        );
        expect(h.trace).toEqual(["schedule:xstate.after.3000.light.green", "schedule:xstate.after.SHORT.light.green"]);
        expect(h.scheduled).toEqual([
            { event: { type: "xstate.after.3000.light.green" }, delay: 3000, id: "xstate.after.3000.light.green" },
            { event: { type: "xstate.after.SHORT.light.green" }, delay: 250, id: "xstate.after.SHORT.light.green" },
        ]);
    });

    it("runs `always` transitions and drains raised events during initialization", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    states: {
                        a: {
                            entry: [raise({ type: "GO" })],
                            always: { target: "b", actions: "viaAlways" },
                            on: { GO: "x" },
                        },
                        b: { entry: "bIn", on: { GO: { target: "c", actions: "viaGo" } } },
                        c: { entry: "cIn" },
                        x: {},
                    },
                },
                { actions: noop("viaAlways", "bIn", "viaGo", "cIn") },
            ),
        );
        // eventless transitions are selected before the internal queue is consulted
        expect(h.trace).toEqual(["viaAlways", "bIn", "viaGo", "cIn"]);
        expect(h.value()).toBe("c");
    });

    it("finishes immediately when the initial state is a top-level final state", () => {
        const h = start(
            createMachine({
                id: "m",
                initial: "done",
                output: ({ event }) => ({ from: event.output }),
                states: { done: { type: "final", output: { code: 1 } }, other: {} },
            }),
        );
        expect(h.state.status).toBe("done");
        expect(h.state.output).toEqual({ from: { code: 1 } });
        expect(h.value()).toBe("done");
    });

    describe("context", () => {
        it("uses an object context as is (shared by every instance, XState parity)", () => {
            const context = { n: 1 };
            const definition = createMachine({ id: "m", context, initial: "a", states: { a: {} } });
            expect(start(definition).state.context).toBe(context);
            expect(start(definition).state.context).toBe(context);
        });

        it("calls a context factory once and shallow-copies its result (XState assigns it over {})", () => {
            const produced = { n: 1 };
            const factory = vi.fn(() => produced);
            const h = start(createMachine({ id: "m", context: factory, initial: "a", states: { a: {} } }));
            expect(factory).toHaveBeenCalledTimes(1);
            expect(h.state.context).toEqual({ n: 1 });
            expect(h.state.context).not.toBe(produced);
        });

        it("defaults to a fresh empty object", () => {
            const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });
            const first = start(definition).state.context;
            expect(first).toEqual({});
            expect(start(definition).state.context).not.toBe(first);
        });
    });
});

// --- transition selection --------------------------------------------------

describe("transition selection", () => {
    const selection = () =>
        start(
            createMachine(
                {
                    id: "s",
                    initial: "a",
                    context: { n: 0 },
                    on: { E: { target: ".z", actions: "rootE" }, ROOT_ONLY: ".z" },
                    states: {
                        a: {
                            initial: "a1",
                            on: { E: { target: "y", actions: "aE" }, FORBIDDEN: "y" },
                            states: {
                                a1: {
                                    on: {
                                        E: { target: "a2", actions: "a1E" },
                                        FORBIDDEN: {},
                                        FIRST: [
                                            { target: "a2", guard: "never", actions: "first" },
                                            {
                                                target: "a2",
                                                guard: { type: "gt", params: { limit: 2 } },
                                                actions: "second",
                                            },
                                            { target: "a2", actions: "third" },
                                        ],
                                        DYN: {
                                            target: "a2",
                                            guard: { type: "gt", params: ({ event }) => ({ limit: event.limit }) },
                                        },
                                        INLINE: { target: "a2", guard: ({ context, event }) => context.n === event.n },
                                        BOOM: { target: "a2", guard: "boom" },
                                        BOOM_INLINE: {
                                            target: "a2",
                                            guard: () => {
                                                throw new Error("inline kaboom");
                                            },
                                        },
                                        MISSING: { target: "a2", guard: "nope" },
                                    },
                                },
                                a2: {},
                            },
                        },
                        y: {},
                        z: {},
                    },
                },
                {
                    actions: noop("rootE", "aE", "a1E", "first", "second", "third"),
                    guards: {
                        never: () => false,
                        gt: ({ context }, params: { limit: number }) => context.n > params.limit,
                        boom: () => {
                            throw new Error("kaboom");
                        },
                    },
                },
            ),
        );

    it("asks the deepest active atomic node first and bubbles up only when it has nothing", () => {
        const h = selection();
        h.send({ type: "E" });
        expect(h.actions).toEqual(["a1E"]);
        expect(h.value()).toEqual({ a: "a2" });
        h.clear();
        h.send({ type: "E" });
        expect(h.actions).toEqual(["aE"]);
        expect(h.value()).toBe("y");
        h.clear();
        h.send({ type: "E" });
        expect(h.actions).toEqual(["rootE"]);
        expect(h.value()).toBe("z");
    });

    it("bubbles to the root for events only the root handles", () => {
        const h = selection();
        h.send({ type: "ROOT_ONLY" });
        expect(h.value()).toBe("z");
    });

    it("takes the first enabled transition of an array (guards evaluated in order)", () => {
        const h = selection();
        h.send({ type: "FIRST" });
        expect(h.actions).toEqual(["third"]);
    });

    it("resolves static and dynamic guard params", () => {
        const withN = (n: number) =>
            start(
                createMachine(
                    {
                        id: "g",
                        initial: "a",
                        context: { n },
                        states: {
                            a: {
                                on: {
                                    STATIC: { target: "b", guard: { type: "gt", params: { limit: 2 } } },
                                    DYN: {
                                        target: "b",
                                        guard: { type: "gt", params: ({ event }) => ({ limit: event.limit }) },
                                    },
                                },
                            },
                            b: {},
                        },
                    },
                    { guards: { gt: ({ context }, params: { limit: number }) => context.n > params.limit } },
                ),
            );
        expect(withN(3).send({ type: "STATIC" }).status).toBe("active");
        expect(withN(3).can({ type: "STATIC" })).toBe(true);
        expect(withN(2).can({ type: "STATIC" })).toBe(false);
        expect(withN(5).can({ type: "DYN", limit: 4 })).toBe(true);
        expect(withN(5).can({ type: "DYN", limit: 5 })).toBe(false);
    });

    it("passes { context, event } to inline guards", () => {
        const h = selection();
        expect(h.can({ type: "INLINE", n: 0 })).toBe(true);
        expect(h.can({ type: "INLINE", n: 1 })).toBe(false);
    });

    it("prefers the exact descriptor, then longer wildcard descriptors, then '*'", () => {
        const wildcards = () =>
            start(
                createMachine(
                    {
                        id: "w",
                        initial: "a",
                        context: { n: 0 },
                        states: {
                            a: {
                                on: {
                                    "*": { target: "b", actions: "any" },
                                    "user.*": { target: "b", actions: "user" },
                                    "user.login": { target: "b", actions: "login" },
                                    GUARDED: { target: "b", guard: ({ context }) => context.n > 0, actions: "guarded" },
                                },
                            },
                            b: {},
                        },
                    },
                    { actions: noop("any", "user", "login", "guarded") },
                ),
            );
        const login = wildcards();
        login.send({ type: "user.login" });
        expect(login.actions).toEqual(["login"]);
        const logout = wildcards();
        logout.send({ type: "user.logout" });
        expect(logout.actions).toEqual(["user"]);
        const other = wildcards();
        other.send({ type: "OTHER" });
        expect(other.actions).toEqual(["any"]);
        // a failing guard on the exact descriptor falls through to the wildcard candidates
        const guarded = wildcards();
        guarded.send({ type: "GUARDED" });
        expect(guarded.actions).toEqual(["any"]);
    });

    it("lets a forbidden (targetless, action-less) transition shadow an ancestor's", () => {
        const h = selection();
        const before = h.state;
        expect(h.send({ type: "FORBIDDEN" })).toBe(before);
        expect(h.value()).toEqual({ a: "a1" });
        expect(h.can({ type: "FORBIDDEN" })).toBe(false);
        expect(selectTransitions(h.model, h.state, { type: "FORBIDDEN" }, h.scope).map((t) => t.configPath)).toEqual([
            "states.a.states.a1.on.FORBIDDEN[0]",
        ]);
    });

    it("returns the same state object when no transition is enabled", () => {
        const h = selection();
        const before = h.state;
        expect(h.send({ type: "UNKNOWN_EVENT" })).toBe(before);
        expect(h.trace).toEqual([]);
    });

    it("wraps guard errors like XState (named, object and inline guards) and keeps the cause", () => {
        const h = selection();
        let caught: unknown;
        try {
            h.send({ type: "BOOM" });
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect((caught as Error).message).toBe(
            "Unable to evaluate guard 'boom' in transition for event 'BOOM' in state node 's.a.a1':\nkaboom",
        );
        expect(((caught as Error).cause as Error).message).toBe("kaboom");

        expect(() => selection().send({ type: "BOOM_INLINE" })).toThrow(
            "Unable to evaluate guard in transition for event 'BOOM_INLINE' in state node 's.a.a1':\ninline kaboom",
        );
        expect(() => selection().send({ type: "MISSING" })).toThrow(
            "Unable to evaluate guard 'nope' in transition for event 'MISSING' in state node 's.a.a1':\nGuard 'nope' is not implemented.",
        );
        expect(() => selection().can({ type: "BOOM" })).toThrow(/Unable to evaluate guard 'boom'/);
    });

    it("does not wrap guard errors of `always` transitions (XState calls evaluateGuard directly)", () => {
        expect(() =>
            start(
                createMachine({
                    id: "m",
                    initial: "a",
                    states: {
                        a: {
                            always: {
                                target: "b",
                                guard: () => {
                                    throw new Error("raw");
                                },
                            },
                        },
                        b: {},
                    },
                }),
            ),
        ).toThrow(new Error("raw"));
    });

    it("rejects the wildcard event type", () => {
        const h = selection();
        expect(() => h.send({ type: "*" })).toThrow("An event cannot have the wildcard type ('*')");
    });
});

// --- exit / entry ordering and the transition domain -----------------------

describe("exit and entry ordering", () => {
    const ordering = () =>
        start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    entry: "rootIn",
                    exit: "rootOut",
                    on: { RESET: { target: ".a", reenter: true, actions: "reset" } },
                    states: {
                        a: {
                            entry: "aIn",
                            exit: "aOut",
                            initial: "a1",
                            on: {
                                TO_B: { target: "b", actions: "toB" },
                                SELF: { target: "a", actions: "self" },
                                SELF_REENTER: { target: "a", reenter: true, actions: "selfRe" },
                                CHILD: { target: ".a2", actions: "child" },
                                CHILD_REENTER: { target: ".a2", reenter: true, actions: "childRe" },
                                PING: { actions: "ping" },
                                TO_ROOT: "#m",
                            },
                            states: {
                                a1: {
                                    entry: "a1In",
                                    exit: "a1Out",
                                    on: { NEXT: { target: "a2", actions: "next" }, DEEP: "#m.b.b2" },
                                },
                                a2: { entry: "a2In", exit: "a2Out" },
                            },
                        },
                        b: {
                            entry: "bIn",
                            exit: "bOut",
                            initial: "b1",
                            states: { b1: { entry: "b1In", exit: "b1Out" }, b2: { entry: "b2In", exit: "b2Out" } },
                        },
                    },
                },
                {
                    actions: noop(
                        "rootIn",
                        "rootOut",
                        "reset",
                        "aIn",
                        "aOut",
                        "toB",
                        "self",
                        "selfRe",
                        "child",
                        "childRe",
                        "ping",
                        "a1In",
                        "a1Out",
                        "next",
                        "a2In",
                        "a2Out",
                        "bIn",
                        "bOut",
                        "b1In",
                        "b1Out",
                        "b2In",
                        "b2Out",
                    ),
                },
            ),
        );

    it("runs exits deepest-first, then transition actions, then entries shallowest-first", () => {
        const h = ordering();
        expect(h.trace).toEqual(["rootIn", "aIn", "a1In"]);
        h.clear();
        h.send({ type: "NEXT" });
        // domain a: only a1 is exited, a2 entered; a itself is untouched
        expect(h.trace).toEqual(["a1Out", "next", "a2In"]);
        h.clear();
        h.send({ type: "TO_B" });
        // domain root: exit a2 (order 3) then a (order 1); enter b (4) then b1 (5)
        expect(h.trace).toEqual(["a2Out", "aOut", "toB", "bIn", "b1In"]);
        expect(h.value()).toEqual({ b: "b1" });
    });

    it("enters the explicit deep target instead of the initial child", () => {
        const h = ordering();
        h.clear();
        h.send({ type: "DEEP" });
        expect(h.trace).toEqual(["a1Out", "aOut", "bIn", "b2In"]);
        expect(h.value()).toEqual({ b: "b2" });
    });

    it("targetless transitions run their actions without exiting or entering anything", () => {
        const h = ordering();
        h.clear();
        const before = h.state;
        // nothing observable changed (no context, no configuration): the same state object comes back
        expect(h.send({ type: "PING" })).toBe(before);
        expect(h.trace).toEqual(["ping"]);
    });

    it("a self-transition without reenter re-enters only the initial child (internal)", () => {
        const h = ordering();
        h.send({ type: "NEXT" });
        h.clear();
        h.send({ type: "SELF" });
        expect(h.trace).toEqual(["a2Out", "self", "a1In"]);
        expect(h.value()).toEqual({ a: "a1" });
    });

    it("a self-transition with reenter exits and re-enters the source", () => {
        const h = ordering();
        h.clear();
        h.send({ type: "SELF_REENTER" });
        expect(h.trace).toEqual(["a1Out", "aOut", "selfRe", "aIn", "a1In"]);
    });

    it("a child target without reenter keeps the source active; with reenter the source is re-entered", () => {
        const h = ordering();
        h.clear();
        h.send({ type: "CHILD" });
        expect(h.trace).toEqual(["a1Out", "child", "a2In"]);
        h.clear();
        h.send({ type: "CHILD_REENTER" });
        expect(h.trace).toEqual(["a2Out", "aOut", "childRe", "aIn", "a2In"]);
    });

    it("a root-sourced reenter transition exits and re-enters the root itself (no domain)", () => {
        const h = ordering();
        h.send({ type: "NEXT" });
        h.clear();
        h.send({ type: "RESET" });
        expect(h.trace).toEqual(["a2Out", "aOut", "rootOut", "reset", "rootIn", "aIn", "a1In"]);
        expect(h.value()).toEqual({ a: "a1" });
    });

    it("targeting the root from a child re-enters the root without exiting it (XState)", () => {
        const h = ordering();
        h.clear();
        h.send({ type: "TO_ROOT" });
        expect(h.trace).toEqual(["a1Out", "aOut", "rootIn", "aIn", "a1In"]);
    });
});

// --- actions ---------------------------------------------------------------

describe("actions", () => {
    it("applies assign immediately: later actions see the new context, the previous object is untouched", () => {
        const seen: number[] = [];
        const initial = { n: 0 };
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    context: initial,
                    states: {
                        a: {
                            on: {
                                INC: {
                                    actions: [
                                        assign({ n: ({ context }) => context.n + 1 }),
                                        "record",
                                        assign(({ context }) => ({ n: context.n * 10 })),
                                        "record",
                                    ],
                                },
                            },
                        },
                    },
                },
                {
                    actions: {
                        record: ({ context }) => {
                            seen.push(context.n);
                        },
                    },
                },
            ),
        );
        const before = h.state;
        const after = h.send({ type: "INC" });
        expect(seen).toEqual([1, 10]);
        expect(after.context).toEqual({ n: 10 });
        expect(after).not.toBe(before);
        expect(initial).toEqual({ n: 0 });
        expect(before.context).toBe(initial);
        expect(h.customs.map((c) => c.args.context.n)).toEqual([1, 10]);
    });

    it("applies mutate through an Immer draft: structural sharing, previous context untouched, return value ignored", () => {
        const seen: number[] = [];
        const untouched = { keep: true };
        const initial = { n: 0, items: [] as number[], untouched };
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    context: initial,
                    types: { events: {} as { type: "INC"; by: number } | { type: "NOOP" } },
                    states: {
                        a: {
                            on: {
                                INC: {
                                    actions: [
                                        mutate(({ context, event }) => {
                                            context.n += event.by;
                                            context.items.push(event.by);
                                        }),
                                        "record",
                                        { type: "scale", params: { factor: 10 } },
                                        "record",
                                        // A returned value never replaces the draft.
                                        mutate(() => ({ n: -1 }) as unknown as void),
                                        "record",
                                    ],
                                },
                                NOOP: { actions: mutate(() => undefined) },
                            },
                        },
                    },
                },
                {
                    actions: {
                        record: ({ context }) => {
                            seen.push(context.n);
                        },
                        scale: mutate(({ context }, params: { factor: number }) => {
                            context.n *= params.factor;
                        }),
                    },
                },
            ),
        );
        const before = h.state;
        const after = h.send({ type: "INC", by: 2 });
        expect(seen).toEqual([2, 20, 20]);
        expect(after.context).toEqual({ n: 20, items: [2], untouched });
        expect(after.context).not.toBe(before.context);
        expect(after.context.untouched).toBe(untouched);
        expect(initial).toEqual({ n: 0, items: [], untouched });
        expect(before.context).toBe(initial);
        expect(Object.isFrozen(after.context)).toBe(false);
        expect(Object.isFrozen(untouched)).toBe(false);

        // A recipe that changes nothing keeps the very same context object.
        const same = h.send({ type: "NOOP" });
        expect(same.context).toBe(after.context);
    });

    it("resolves `{ type, params }` references: static and dynamic params, custom and builtin implementations", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    context: { n: 0 },
                    states: {
                        a: {
                            on: {
                                ADD: { actions: { type: "add", params: { by: 5 } } },
                                ADD_DYN: { actions: { type: "add", params: ({ event }) => ({ by: event.by }) } },
                                CUSTOM: { actions: { type: "custom", params: { flag: true } } },
                            },
                        },
                    },
                },
                {
                    actions: {
                        add: assign({ n: ({ context }, params: { by: number }) => context.n + params.by }),
                        custom: () => undefined,
                    },
                },
            ),
        );
        expect(h.send({ type: "ADD" }).context).toEqual({ n: 5 });
        expect(h.send({ type: "ADD_DYN", by: 7 }).context).toEqual({ n: 12 });
        h.send({ type: "CUSTOM" });
        expect(h.customs.map((c) => [c.type, c.params])).toEqual([["custom", { flag: true }]]);
    });

    it("names inline actions after the function, '(anonymous)' when nameless", () => {
        function namedAction(): void {}
        const h = start(
            createMachine({
                id: "m",
                initial: "a",
                states: { a: { entry: [namedAction, () => undefined] } },
            }),
        );
        expect(h.actions).toEqual(["namedAction", "(anonymous)"]);
        expect(h.customs[0]?.params).toBeUndefined();
    });

    it("throws for an action name missing from the implementation table", () => {
        expect(() => start(createMachine({ id: "m", initial: "a", states: { a: { entry: "nope" } } }))).toThrow(
            "Action 'nope' is not implemented.",
        );
    });

    it("hands raise without delay to the internal queue and processes it within the same macrostep", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    states: {
                        a: { on: { GO: { target: "b", actions: raise({ type: "NEXT" }) } } },
                        b: { entry: "bIn", on: { NEXT: { target: "c", actions: "onNext" } } },
                        c: { entry: "cIn" },
                    },
                },
                { actions: noop("bIn", "onNext", "cIn") },
            ),
        );
        h.send({ type: "GO" });
        expect(h.trace).toEqual(["bIn", "onNext", "cIn"]);
        expect(h.value()).toBe("c");
        expect(h.scheduled).toEqual([]);
    });

    it("resolves raise event expressions and passes the raised event to the handlers", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    states: {
                        a: {
                            on: {
                                GO: { actions: raise(({ event }) => ({ type: "ECHO", from: event.type })) },
                                ECHO: { target: "b", actions: "echo" },
                            },
                        },
                        b: {},
                    },
                },
                { actions: noop("echo") },
            ),
        );
        h.send({ type: "GO" });
        expect(h.customs[0]?.args.event).toEqual({ type: "ECHO", from: "GO" });
        expect(h.value()).toBe("b");
    });

    it("schedules delayed raise through the executor: numeric, named, function and per-call delays", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    context: { ms: 40 },
                    states: {
                        a: {
                            entry: [
                                raise({ type: "P1" }, { delay: 100, id: "p1" }),
                                raise({ type: "P2" }, { delay: "SHORT" }),
                                raise({ type: "P3" }, { delay: "DYN", id: "p3" }),
                                raise({ type: "P4" }, { delay: ({ context }) => context.ms * 2 }),
                            ],
                        },
                    },
                },
                { delays: { SHORT: 250, DYN: ({ context }) => context.ms } },
            ),
        );
        expect(h.scheduled).toEqual([
            { event: { type: "P1" }, delay: 100, id: "p1" },
            { event: { type: "P2" }, delay: 250, id: undefined },
            { event: { type: "P3" }, delay: 40, id: "p3" },
            { event: { type: "P4" }, delay: 80, id: undefined },
        ]);
        expect(h.trace).toEqual(["schedule:P1", "schedule:P2", "schedule:P3", "schedule:P4"]);
    });

    it("rejects delays that do not resolve to a non-negative finite number and unknown named delays", () => {
        const bad = (delay: string | (() => number), delays: Record<string, number | (() => number)>) =>
            createMachine(
                { id: "m", initial: "a", states: { a: { entry: raise({ type: "P" }, { delay }) } } },
                { delays },
            );
        expect(() => start(bad("BAD", { BAD: () => -1 }))).toThrow(
            "Delay 'BAD' resolved to -1; expected a non-negative finite number",
        );
        expect(() => start(bad("NAN", { NAN: () => Number.NaN }))).toThrow("Delay 'NAN' resolved to NaN");
        expect(() => start(bad(() => Number.POSITIVE_INFINITY, {}))).toThrow(
            "Delay expression resolved to Infinity; expected a non-negative finite number",
        );
        expect(() => start(bad("NOPE", {}))).toThrow("Delay 'NOPE' is not implemented.");
    });

    it("rejects raised events that are not event objects or have the wildcard type", () => {
        const raising = (event: unknown) =>
            start(
                createMachine({
                    id: "m",
                    initial: "a",
                    states: { a: { entry: raise(() => event as { type: string }) } },
                }),
            );
        expect(() => raising("GO")).toThrow("raise() expected an event object with a string 'type'");
        expect(() => raising({ type: "*" })).toThrow("An event cannot have the wildcard type ('*')");
    });

    it("routes cancel (string or function id) and log to the executor", () => {
        const h = start(
            createMachine({
                id: "m",
                initial: "a",
                context: { id: "dyn", n: 3 },
                states: {
                    a: {
                        on: {
                            CANCEL: { actions: [cancel("p1"), cancel(({ context }) => context.id)] },
                            LOG: { actions: [log("hi", "greeting"), log(({ context }) => context.n), log()] },
                        },
                    },
                },
            }),
        );
        h.send({ type: "CANCEL" });
        expect(h.cancelled).toEqual(["p1", "dyn"]);
        h.send({ type: "LOG" });
        expect(h.logs).toEqual([
            { value: "hi", label: "greeting" },
            { value: 3, label: undefined },
            { value: { context: { id: "dyn", n: 3 }, event: { type: "LOG" } }, label: undefined },
        ]);
        expect(h.trace).toEqual(["cancel:p1", "cancel:dyn", "log", "log", "log"]);
    });

    it("rejects a cancel id that is not a string", () => {
        expect(() =>
            start(
                createMachine({
                    id: "m",
                    initial: "a",
                    states: { a: { entry: cancel(() => undefined as unknown as string) } },
                }),
            ),
        ).toThrow("cancel() expected a string id, got undefined");
    });

    it("cancels `after` timers on exit before the transition actions and schedules the next state's on entry", () => {
        const h = start(
            createMachine(
                {
                    id: "t",
                    initial: "a",
                    states: {
                        a: { exit: "aOut", after: { 10: { target: "b", actions: "fire" } } },
                        b: { entry: "bIn", after: { 20: "a" } },
                    },
                },
                { actions: noop("aOut", "fire", "bIn") },
            ),
        );
        h.clear();
        h.send({ type: "xstate.after.10.t.a" });
        expect(h.trace).toEqual(["aOut", "cancel:xstate.after.10.t.a", "fire", "bIn", "schedule:xstate.after.20.t.b"]);
        expect(h.value()).toBe("b");
    });

    it("propagates exceptions thrown by custom actions unchanged", () => {
        const failure = new Error("action failed");
        const h = start(
            createMachine(
                { id: "m", initial: "a", states: { a: { on: { GO: { actions: "explode" } } } } },
                {
                    actions: {
                        explode: () => {
                            throw failure;
                        },
                    },
                },
            ),
        );
        expect(() => h.send({ type: "GO" })).toThrow(failure);
    });
});

// --- guards ----------------------------------------------------------------

describe("guards", () => {
    const guarded = () =>
        start(
            createMachine(
                {
                    id: "g",
                    type: "parallel",
                    context: { flag: true },
                    states: {
                        a: { initial: "a1", states: { a1: { on: { GO: "a2" } }, a2: {} } },
                        b: {
                            initial: "b1",
                            states: {
                                b1: {
                                    on: {
                                        IN_ID: { target: "b2", guard: stateIn("#g.a.a2") },
                                        IN_VALUE: { target: "b2", guard: stateIn({ a: "a1" }) },
                                        IN_PATH: { target: "b2", guard: stateIn("a.a2") },
                                        AND: { target: "b2", guard: and(["isFlag", not("isFlag")]) },
                                        OR: { target: "b2", guard: or(["never", { type: "isFlag" }]) },
                                        NOT: { target: "b2", guard: not(() => false) },
                                        NAMED_BUILTIN: { target: "b2", guard: "ready" },
                                        TRUTHY: { target: "b2", guard: "truthy" },
                                    },
                                },
                                b2: {},
                            },
                        },
                    },
                },
                {
                    guards: {
                        isFlag: ({ context }) => context.flag,
                        never: () => false,
                        ready: and(["isFlag", stateIn("#g.a.a1")]),
                        truthy: () => "yes" as unknown as boolean,
                    },
                },
            ),
        );

    it("evaluates stateIn by node id, by partial value and by path", () => {
        const h = guarded();
        expect(h.can({ type: "IN_ID" })).toBe(false);
        expect(h.can({ type: "IN_VALUE" })).toBe(true);
        expect(h.can({ type: "IN_PATH" })).toBe(false);
        h.send({ type: "GO" });
        expect(h.can({ type: "IN_ID" })).toBe(true);
        expect(h.can({ type: "IN_VALUE" })).toBe(false);
        expect(h.can({ type: "IN_PATH" })).toBe(true);
    });

    it("evaluates and / or / not structurally, resolving string members through the table", () => {
        const h = guarded();
        expect(h.can({ type: "AND" })).toBe(false);
        expect(h.can({ type: "OR" })).toBe(true);
        expect(h.can({ type: "NOT" })).toBe(true);
    });

    it("evaluates a named guard implemented by a builtin", () => {
        const h = guarded();
        expect(h.can({ type: "NAMED_BUILTIN" })).toBe(true);
        h.send({ type: "GO" });
        expect(h.can({ type: "NAMED_BUILTIN" })).toBe(false);
    });

    it("coerces predicate results to booleans", () => {
        const h = guarded();
        expect(h.can({ type: "TRUTHY" })).toBe(true);
        expect(
            evaluateGuard("truthy", { context: h.state.context, event: { type: "X" } }, h.model, h.state, h.scope),
        ).toBe(true);
    });

    it("evaluateGuard throws for an unknown guard name", () => {
        const h = guarded();
        expect(() =>
            evaluateGuard("missing", { context: h.state.context, event: { type: "X" } }, h.model, h.state, h.scope),
        ).toThrow("Guard 'missing' is not implemented.");
    });
});

// --- history ---------------------------------------------------------------

describe("history", () => {
    const history = () =>
        start(
            createMachine({
                id: "h",
                initial: "off",
                states: {
                    off: {
                        on: { ON: "on", ON_HIST: "on.hist", ON_DEEP: "on.deep", ON_DEFAULT: "on.withDefault" },
                    },
                    on: {
                        initial: "low",
                        on: { OFF: "off" },
                        states: {
                            low: { on: { UP: "high" } },
                            high: { initial: "h1", states: { h1: { on: { NEXT: "h2" } }, h2: {} } },
                            hist: { type: "history" },
                            deep: { type: "history", history: "deep" },
                            withDefault: { type: "history", target: "high" },
                        },
                    },
                },
            }),
        );

    it("records history when the parent is exited, deep history two levels down", () => {
        const h = history();
        h.send({ type: "ON" });
        h.send({ type: "UP" });
        h.send({ type: "NEXT" });
        expect(h.value()).toEqual({ on: { high: "h2" } });
        const before = h.state.historyValue;
        h.send({ type: "OFF" });
        expect(h.state.historyValue).not.toBe(before);
        expect(
            Object.fromEntries(Object.entries(h.state.historyValue).map(([k, v]) => [k, v.map((n) => n.id)])),
        ).toEqual({
            "h.on.hist": ["h.on.high"],
            "h.on.deep": ["h.on.high.h2"],
            "h.on.withDefault": ["h.on.high"],
        });
    });

    it("shallow history restores the child and its initial descendants", () => {
        const h = history();
        h.send({ type: "ON" });
        h.send({ type: "UP" });
        h.send({ type: "NEXT" });
        h.send({ type: "OFF" });
        h.send({ type: "ON_HIST" });
        expect(h.value()).toEqual({ on: { high: "h1" } });
    });

    it("deep history restores the exact leaf", () => {
        const h = history();
        h.send({ type: "ON" });
        h.send({ type: "UP" });
        h.send({ type: "NEXT" });
        h.send({ type: "OFF" });
        h.send({ type: "ON_DEEP" });
        expect(h.value()).toEqual({ on: { high: "h2" } });
    });

    it("falls back to the parent's initial state or the history's own target when nothing was recorded", () => {
        const fresh = history();
        fresh.send({ type: "ON_HIST" });
        expect(fresh.value()).toEqual({ on: "low" });
        const withDefault = history();
        withDefault.send({ type: "ON_DEFAULT" });
        expect(withDefault.value()).toEqual({ on: { high: "h1" } });
    });

    it("keeps the history value object identity when nothing is recorded", () => {
        const h = history();
        h.send({ type: "ON" });
        const before = h.state.historyValue;
        h.send({ type: "UP" });
        expect(h.state.historyValue).toBe(before);
    });

    it("restores every region for a history node under a parallel parent", () => {
        const h = start(
            createMachine({
                id: "ph",
                initial: "p",
                states: {
                    p: {
                        type: "parallel",
                        on: { LEAVE: "out" },
                        states: {
                            x: { initial: "x1", states: { x1: { on: { X: "x2" } }, x2: {} } },
                            y: { initial: "y1", states: { y1: {}, y2: {} } },
                            deep: { type: "history", history: "deep" },
                        },
                    },
                    out: { on: { BACK: "p.deep" } },
                },
            }),
        );
        h.send({ type: "X" });
        h.send({ type: "LEAVE" });
        expect(h.state.historyValue["ph.p.deep"]?.map((n) => n.id)).toEqual(["ph.p.y.y1", "ph.p.x.x2"]);
        h.send({ type: "BACK" });
        expect(h.value()).toEqual({ p: { x: "x2", y: "y1" } });

        const fresh = start(getDefinitionOf(h));
        fresh.send({ type: "LEAVE" });
        fresh.send({ type: "BACK" });
        expect(fresh.value()).toEqual({ p: { x: "x1", y: "y1" } });
    });
});

/** The harness does not keep the definition; rebuild the same machine from its model config. */
function getDefinitionOf<TContext extends MachineContext, TEvent extends EventObject>(
    h: Harness<TContext, TEvent>,
): MachineDefinition<TContext, TEvent> {
    return createMachine(structuredClone(h.model.config) as never) as unknown as MachineDefinition<TContext, TEvent>;
}

// --- always / internal queue / iteration cap -------------------------------

describe("eventless transitions and the internal queue", () => {
    it("re-evaluates `always` after every microstep and chains them", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    context: { flag: false },
                    states: {
                        a: { on: { GO: "b" } },
                        b: { entry: "bIn", always: [{ target: "c", guard: "flag" }, { target: "d" }] },
                        c: {},
                        d: { entry: "dIn", always: { target: "e", actions: "toE" } },
                        e: { entry: "eIn" },
                    },
                },
                { actions: noop("bIn", "dIn", "toE", "eIn"), guards: { flag: ({ context }) => context.flag } },
            ),
        );
        h.send({ type: "GO" });
        expect(h.trace).toEqual(["bIn", "dIn", "toE", "eIn"]);
        expect(h.value()).toBe("e");
    });

    it("selects `always` transitions before draining the queue, and `always` guards see the last event", () => {
        const seenEvents: string[] = [];
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    states: {
                        a: { on: { GO: { target: "b", actions: raise({ type: "Q" }) } } },
                        b: {
                            entry: "bIn",
                            always: { target: "c", guard: "spy", actions: "viaAlways" },
                            on: { Q: { target: "x", actions: "viaQ" } },
                        },
                        c: { entry: "cIn", on: { Q: { target: "d", actions: "cQ" } } },
                        d: { entry: "dIn" },
                        x: {},
                    },
                },
                {
                    actions: noop("bIn", "viaAlways", "cIn", "cQ", "dIn", "viaQ"),
                    guards: {
                        spy: ({ event }) => {
                            seenEvents.push(event.type);
                            return true;
                        },
                    },
                },
            ),
        );
        h.send({ type: "GO" });
        expect(h.trace).toEqual(["bIn", "viaAlways", "cIn", "cQ", "dIn"]);
        expect(h.value()).toBe("d");
        expect(seenEvents).toEqual(["GO"]);
    });

    it("an `always` on an ancestor applies when the active leaf has none", () => {
        const h = start(
            createMachine({
                id: "m",
                initial: "a",
                states: {
                    a: {
                        always: { target: "b", guard: ({ context }) => context.ready === true },
                        initial: "a1",
                        states: { a1: {} },
                    },
                    b: {},
                },
                context: { ready: true },
            }),
        );
        expect(h.value()).toBe("b");
    });

    it("drops queued events once the machine is no longer active", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    states: {
                        a: { on: { GO: { target: "done", actions: raise({ type: "LATER" }) } } },
                        done: { type: "final" },
                    },
                    on: { LATER: { actions: "later" } },
                },
                { actions: noop("later") },
            ),
        );
        h.send({ type: "GO" });
        expect(h.state.status).toBe("done");
        expect(h.actions).toEqual([]);
    });

    it("throws a descriptive error when a macrostep exceeds maxMicrosteps", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: { always: "b" }, b: { always: "a" } } });
        expect(() => start(definition, { maxMicrosteps: 5 })).toThrow(
            "Infinite loop detected: the machine has processed more than 5 microsteps without reaching a stable state. This usually happens when there's a cycle of transitions (e.g., eventless transitions or raised events causing state A -> B -> C -> A).",
        );
        const raising = createMachine({
            id: "m",
            initial: "a",
            states: { a: { on: { PING: { actions: raise({ type: "PING" }) } } } },
        });
        const h = start(raising, { maxMicrosteps: 3 });
        expect(() => h.send({ type: "PING" })).toThrow(/Infinite loop detected/);
    });
});

// --- final states, done events and output ----------------------------------

describe("final states and done events", () => {
    it("raises xstate.done.state.<id> with the final state's output and finishes the machine at the root", () => {
        const finishOutput = vi.fn(({ context }: { context: { total: number } }) => ({ total: context.total }));
        const h = start(
            createMachine(
                {
                    id: "d",
                    initial: "work",
                    context: { total: 41 },
                    output: ({ event }) => ({ result: event.output }),
                    states: {
                        work: {
                            initial: "step",
                            entry: "workIn",
                            exit: "workOut",
                            states: {
                                step: { on: { NEXT: "wrapped" } },
                                wrapped: {
                                    type: "final",
                                    entry: "wrappedIn",
                                    output: ({ context }) => context.total + 1,
                                },
                            },
                            onDone: { target: "finish", actions: "onDone" },
                        },
                        finish: { type: "final", entry: "finishIn", exit: "finishOut", output: finishOutput },
                    },
                },
                { actions: noop("workIn", "workOut", "wrappedIn", "onDone", "finishIn", "finishOut") },
            ),
        );
        h.clear();
        h.send({ type: "NEXT" });
        // the done event is consumed by onDone; once the top-level final is entered every active
        // node is exited (finish, then the root) — XState behaviour
        expect(h.trace).toEqual(["wrappedIn", "workOut", "onDone", "finishIn", "finishOut"]);
        const onDone = h.customs.find((c) => c.type === "onDone");
        expect(onDone?.args.event).toEqual({ type: "xstate.done.state.d.work", output: 42 });
        expect(h.state.status).toBe("done");
        expect(h.state.output).toEqual({ result: { total: 41 } });
        expect(h.value()).toBe("finish");
        expect(h.snapshot()).toMatchObject({ status: "done", output: { result: { total: 41 } }, error: undefined });
        // XState resolves a top-level final's output twice: for the (never consumed) done event of the
        // root and again for the machine output. Kept for parity.
        expect(finishOutput).toHaveBeenCalledTimes(2);
    });

    it("machine output is undefined without a root `output`; static outputs are used as is", () => {
        const plain = start(
            createMachine({ id: "m", initial: "f", states: { f: { type: "final", output: { x: 1 } } } }),
        );
        expect(plain.state.status).toBe("done");
        expect(plain.state.output).toBeUndefined();
        const fixed = start(
            createMachine({ id: "m", initial: "f", output: { code: 7 }, states: { f: { type: "final" } } }),
        );
        expect(fixed.state.output).toEqual({ code: 7 });
    });

    it("done events of a compound state carry undefined output when the final state has none", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "p",
                    states: {
                        p: { initial: "f", states: { f: { type: "final" } }, onDone: { target: "q", actions: "done" } },
                        q: {},
                    },
                },
                { actions: noop("done") },
            ),
        );
        expect(h.customs[0]?.args.event).toEqual({ type: "xstate.done.state.m.p", output: undefined });
        expect(h.value()).toBe("q");
    });

    it("a parallel state is done only when every region is in a final state", () => {
        const h = start(
            createMachine(
                {
                    id: "np",
                    initial: "run",
                    states: {
                        run: {
                            type: "parallel",
                            onDone: { target: "end", actions: "runDone" },
                            states: {
                                a: { initial: "a1", states: { a1: { on: { DONE_A: "af" } }, af: { type: "final" } } },
                                b: { initial: "b1", states: { b1: { on: { DONE_B: "bf" } }, bf: { type: "final" } } },
                            },
                        },
                        end: { type: "final" },
                    },
                },
                { actions: noop("runDone") },
            ),
        );
        h.send({ type: "DONE_A" });
        expect(h.state.status).toBe("active");
        expect(h.actions).toEqual([]);
        expect(h.value()).toEqual({ run: { a: "af", b: "b1" } });
        h.send({ type: "DONE_B" });
        expect(h.actions).toEqual(["runDone"]);
        expect(h.customs[0]?.args.event).toEqual({ type: "xstate.done.state.np.run", output: undefined });
        expect(h.state.status).toBe("done");
        expect(h.value()).toBe("end");
    });

    it("a parallel root finishes when all regions are final, resolving the root output once", () => {
        const output = vi.fn(({ event }: { event: { type: string; output: unknown } }) => event);
        const h = start(
            createMachine({
                id: "pr",
                type: "parallel",
                output,
                states: {
                    a: { initial: "a1", states: { a1: { on: { DONE_A: "af" } }, af: { type: "final" } } },
                    b: { initial: "b1", states: { b1: { on: { DONE_B: "bf" } }, bf: { type: "final" } } },
                },
            }),
        );
        h.send({ type: "DONE_A" });
        expect(h.state.status).toBe("active");
        h.send({ type: "DONE_B" });
        expect(h.state.status).toBe("done");
        expect(output).toHaveBeenCalledTimes(1);
        expect(h.state.output).toEqual({ type: "xstate.done.state.pr", output: undefined });
        expect(h.value()).toEqual({ a: "af", b: "bf" });
    });

    it("cancels every `after` timer through the synthesized exits when the machine is done", () => {
        const h = start(
            createMachine({
                id: "t",
                initial: "a",
                states: { a: { after: { 1000: "b" }, on: { END: "f" } }, b: {}, f: { type: "final" } },
            }),
        );
        h.clear();
        h.send({ type: "END" });
        expect(h.trace).toEqual(["cancel:xstate.after.1000.t.a"]);
        expect(h.state.status).toBe("done");
    });

    it("a nested final state's transitions still work (XState accepts `on` on final nodes)", () => {
        const h = start(
            createMachine({
                id: "m",
                initial: "p",
                states: {
                    p: { initial: "a", states: { a: { on: { GO: "f" } }, f: { type: "final", on: { X: "a" } } } },
                },
            }),
        );
        h.send({ type: "GO" });
        expect(h.value()).toEqual({ p: "f" });
        expect(h.state.status).toBe("active");
        h.send({ type: "X" });
        expect(h.value()).toEqual({ p: "a" });
    });
});

// --- parallel regions ------------------------------------------------------

describe("parallel regions", () => {
    const parallel = () =>
        start(
            createMachine(
                {
                    id: "p",
                    type: "parallel",
                    on: { BOTH: { target: [".a.a2", ".b.b2"], actions: "both" } },
                    states: {
                        a: {
                            entry: "aIn",
                            exit: "aOut",
                            initial: "a1",
                            states: {
                                a1: {
                                    entry: "a1In",
                                    exit: "a1Out",
                                    on: {
                                        E: { target: "a2", actions: "tA" },
                                        CROSS: { target: "#p.b.b2", actions: "cross" },
                                        MULTI: { target: ["a2", "#p.b.b2"] },
                                    },
                                },
                                a2: { entry: "a2In", exit: "a2Out" },
                            },
                        },
                        b: {
                            entry: "bIn",
                            exit: "bOut",
                            initial: "b1",
                            states: {
                                b1: {
                                    entry: "b1In",
                                    exit: "b1Out",
                                    on: {
                                        E: { target: "b2", actions: "tB" },
                                        CROSS: { target: "b2", actions: "bOwn" },
                                    },
                                },
                                b2: { entry: "b2In", exit: "b2Out" },
                            },
                        },
                    },
                },
                {
                    actions: noop(
                        "both",
                        "aIn",
                        "aOut",
                        "a1In",
                        "a1Out",
                        "tA",
                        "cross",
                        "a2In",
                        "a2Out",
                        "bIn",
                        "bOut",
                        "b1In",
                        "b1Out",
                        "tB",
                        "bOwn",
                        "b2In",
                        "b2Out",
                    ),
                },
            ),
        );

    it("takes one transition per region and orders exits / actions / entries by document order", () => {
        const h = parallel();
        expect(h.trace).toEqual(["aIn", "a1In", "bIn", "b1In"]);
        h.clear();
        h.send({ type: "E" });
        expect(h.trace).toEqual(["b1Out", "a1Out", "tA", "tB", "a2In", "b2In"]);
        expect(h.value()).toEqual({ a: "a2", b: "b2" });
    });

    it("removes conflicting transitions: a cross-region transition preempts a sibling region's own", () => {
        const h = parallel();
        h.clear();
        h.send({ type: "CROSS" });
        // domain of the cross-region transition is the parallel root: every region is exited and
        // re-entered; region a comes back through its initial state
        expect(h.trace).toEqual(["b1Out", "bOut", "a1Out", "aOut", "cross", "aIn", "a1In", "bIn", "b2In"]);
        expect(h.value()).toEqual({ a: "a1", b: "b2" });
    });

    it("supports multiple targets across regions", () => {
        const h = parallel();
        h.clear();
        h.send({ type: "MULTI" });
        expect(h.value()).toEqual({ a: "a2", b: "b2" });
        expect(h.trace).toEqual(["b1Out", "bOut", "a1Out", "aOut", "aIn", "a2In", "bIn", "b2In"]);
        const fromRoot = parallel();
        fromRoot.clear();
        fromRoot.send({ type: "BOTH" });
        expect(fromRoot.value()).toEqual({ a: "a2", b: "b2" });
        expect(fromRoot.actions).toEqual(["b1Out", "bOut", "a1Out", "aOut", "both", "aIn", "a2In", "bIn", "b2In"]);
    });

    it("asks the parallel node itself only when no region handled the event", () => {
        const h = start(
            createMachine(
                {
                    id: "p",
                    type: "parallel",
                    on: { E: { actions: "rootE" } },
                    states: { a: { on: { E: { actions: "aE" } } }, b: {} },
                },
                { actions: noop("rootE", "aE") },
            ),
        );
        h.send({ type: "E" });
        expect(h.actions).toEqual(["aE"]);
    });
});

// --- stop, non-active states, identity -------------------------------------

describe("stop and finished states", () => {
    const simple = () =>
        start(
            createMachine(
                { id: "m", initial: "a", states: { a: { exit: "aOut", on: { GO: "f" } }, f: { type: "final" } } },
                { actions: noop("aOut") },
            ),
        );

    it("xstate.stop marks the state stopped without running any action", () => {
        const h = simple();
        h.clear();
        const before = h.state;
        const stopped = h.send({ type: XSTATE_STOP });
        expect(stopped).not.toBe(before);
        expect(stopped.status).toBe("stopped");
        expect(stopped.configuration).toBe(before.configuration);
        expect(h.trace).toEqual([]);
        expect(h.snapshot().status).toBe("stopped");
    });

    it("returns a non-active state unchanged for any event and reports can() as false", () => {
        const h = simple();
        h.send({ type: "GO" });
        expect(h.state.status).toBe("done");
        const done = h.state;
        expect(h.send({ type: "GO" })).toBe(done);
        expect(h.send({ type: XSTATE_STOP })).toBe(done);
        expect(h.can({ type: "GO" })).toBe(false);
        const stopped = simple();
        stopped.send({ type: XSTATE_STOP });
        expect(stopped.can({ type: "GO" })).toBe(false);
        const erroring: MachineState<MachineContext, AnyEventObject> = {
            ...simple().state,
            status: "error",
            error: new Error("x"),
        };
        const model = simple().model;
        expect(step(model, erroring, { type: "GO" }, simple().scope).state).toBe(erroring);
    });
});

describe("canHandle", () => {
    it("is true only for transitions with a target or actions whose guard passes", () => {
        const h = start(
            createMachine(
                {
                    id: "m",
                    initial: "a",
                    context: { ok: false },
                    states: {
                        a: {
                            on: {
                                TARGET: "b",
                                ACTIONS: { actions: "noop" },
                                FORBIDDEN: {},
                                GUARDED: { target: "b", guard: ({ context }) => context.ok },
                            },
                        },
                        b: {},
                    },
                },
                { actions: noop("noop") },
            ),
        );
        expect(h.can({ type: "TARGET" })).toBe(true);
        expect(h.can({ type: "ACTIONS" })).toBe(true);
        expect(h.can({ type: "FORBIDDEN" })).toBe(false);
        expect(h.can({ type: "GUARDED" })).toBe(false);
        expect(h.can({ type: "UNKNOWN" })).toBe(false);
    });
});

// --- snapshots -------------------------------------------------------------

describe("createSnapshot", () => {
    it("builds a frozen snapshot with value, tags, context, status and output/error", () => {
        const h = start(
            createMachine({
                id: "m",
                initial: "a",
                context: { n: 1 },
                tags: ["root", "shared"],
                states: { a: { tags: "shared", initial: "a1", states: { a1: { tags: ["leaf"] } } } },
            }),
        );
        const snapshot = h.snapshot();
        expect(snapshot).toEqual({
            status: "active",
            value: { a: "a1" },
            context: { n: 1 },
            tags: ["root", "shared", "leaf"],
            output: undefined,
            error: undefined,
        });
        expect(Object.isFrozen(snapshot)).toBe(true);
        expect(Object.isFrozen(snapshot.value)).toBe(true);
        expect(Object.isFrozen(snapshot.tags)).toBe(true);
        expect(snapshot.context).toBe(h.state.context);
    });

    it("exposes error only for error states and output only for done states", () => {
        const h = start(createMachine({ id: "m", initial: "a", states: { a: {} } }));
        const error = new Error("boom");
        const errored = createSnapshot(h.model, { ...h.state, status: "error", error, output: "ignored" });
        expect(errored).toMatchObject({ status: "error", error, output: undefined });
        const stopped = createSnapshot(h.model, { ...h.state, status: "stopped", error, output: "ignored" });
        expect(stopped).toMatchObject({ status: "stopped", error: undefined, output: undefined });
    });
});

// --- parity with xstate ----------------------------------------------------

interface Library {
    assign: typeof assign;
    raise: typeof raise;
    log: typeof log;
    and: typeof and;
    or: typeof or;
    not: typeof not;
    stateIn: typeof stateIn;
}

interface ParityStep {
    readonly status: string;
    readonly value: unknown;
    readonly context: unknown;
    readonly output: unknown;
    readonly actions: readonly string[];
}

interface ParityScenario {
    readonly name: string;
    readonly build: (lib: Library, record: (name: string) => () => void) => { config: any; implementations?: any };
    readonly events: readonly { type: string; [key: string]: unknown }[];
}

const ours: Library = { assign, raise, log, and, or, not, stateIn };
const theirs = {
    assign: xAssign,
    raise: xRaise,
    log: xLog,
    and: xAnd,
    or: xOr,
    not: xNot,
    stateIn: xStateIn,
} as unknown as Library;

function runOurs(scenario: ParityScenario): ParityStep[] {
    const actions: string[] = [];
    const record = (name: string) => () => {
        actions.push(name);
    };
    const { config, implementations } = scenario.build(ours, record);
    const h = start(createMachine(config, implementations));
    const steps: ParityStep[] = [];
    const push = () => {
        const s = h.snapshot();
        steps.push({
            status: s.status,
            value: s.value,
            context: s.context,
            output: s.output,
            actions: actions.splice(0),
        });
    };
    push();
    for (const event of scenario.events) {
        h.send(event === STOP ? { type: XSTATE_STOP } : event);
        push();
    }
    return steps;
}

const STOP = { type: "__stop__" };

function runTheirs(scenario: ParityScenario): ParityStep[] {
    const actions: string[] = [];
    const record = (name: string) => () => {
        actions.push(name);
    };
    const { config, implementations } = scenario.build(theirs, record);
    const machine = createXStateMachine(config, implementations);
    const actor = createActor(machine, {
        clock: { setTimeout: () => 0, clearTimeout: () => undefined },
        logger: () => undefined,
    });
    actor.start();
    const steps: ParityStep[] = [];
    const push = () => {
        const s = actor.getSnapshot();
        steps.push({
            status: s.status,
            value: s.value,
            context: s.context,
            output: s.output,
            actions: actions.splice(0),
        });
    };
    push();
    // xstate warns through console.warn when an event reaches a stopped actor (scenarios do that on purpose)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
        for (const event of scenario.events) {
            if (event === STOP) actor.stop();
            else actor.send(event);
            push();
        }
    } finally {
        warn.mockRestore();
    }
    return steps;
}

const scenarios: ParityScenario[] = [
    {
        name: "nested compound: entry/exit order, .child / #id / sibling targets, reenter, root reenter",
        build: (_lib, r) => ({
            config: {
                id: "m",
                initial: "a",
                entry: "rootIn",
                exit: "rootOut",
                on: { RESET: { target: ".a", reenter: true, actions: "reset" } },
                states: {
                    a: {
                        entry: "aIn",
                        exit: "aOut",
                        initial: "a1",
                        on: {
                            TO_B: { target: "b", actions: "toB" },
                            SELF: { target: "a", actions: "self" },
                            SELF_REENTER: { target: "a", reenter: true, actions: "selfRe" },
                            CHILD: { target: ".a2", actions: "child" },
                            CHILD_REENTER: { target: ".a2", reenter: true, actions: "childRe" },
                            PING: { actions: "ping" },
                            TO_ROOT: "#m",
                        },
                        states: {
                            a1: {
                                entry: "a1In",
                                exit: "a1Out",
                                on: { NEXT: { target: "a2", actions: "next" }, DEEP: "#m.b.b2" },
                            },
                            a2: { entry: "a2In", exit: "a2Out" },
                        },
                    },
                    b: {
                        entry: "bIn",
                        exit: "bOut",
                        initial: "b1",
                        on: { BACK: "a" },
                        states: { b1: { entry: "b1In", exit: "b1Out" }, b2: { entry: "b2In", exit: "b2Out" } },
                    },
                },
            },
            implementations: {
                actions: Object.fromEntries(
                    [
                        "rootIn",
                        "rootOut",
                        "reset",
                        "aIn",
                        "aOut",
                        "toB",
                        "self",
                        "selfRe",
                        "child",
                        "childRe",
                        "ping",
                        "a1In",
                        "a1Out",
                        "next",
                        "a2In",
                        "a2Out",
                        "bIn",
                        "bOut",
                        "b1In",
                        "b1Out",
                        "b2In",
                        "b2Out",
                    ].map((n) => [n, r(n)]),
                ),
            },
        }),
        events: [
            { type: "NEXT" },
            { type: "SELF" },
            { type: "PING" },
            { type: "SELF_REENTER" },
            { type: "CHILD" },
            { type: "CHILD_REENTER" },
            { type: "RESET" },
            { type: "TO_ROOT" },
            { type: "DEEP" },
            { type: "BACK" },
            { type: "TO_B" },
        ],
    },
    {
        name: "guards: arrays, params, wildcards, forbidden transitions",
        build: (lib, r) => ({
            config: {
                id: "s",
                initial: "a",
                context: { n: 3 },
                on: { E: { target: ".z", actions: "rootE" } },
                states: {
                    a: {
                        initial: "a1",
                        on: { E: { target: "y", actions: "aE" }, FORBIDDEN: "y" },
                        states: {
                            a1: {
                                on: {
                                    E: { target: "a2", actions: "a1E" },
                                    FORBIDDEN: {},
                                    FIRST: [
                                        { target: "a2", guard: "never", actions: "first" },
                                        {
                                            target: "a2",
                                            guard: { type: "gt", params: { limit: 2 } },
                                            actions: "second",
                                        },
                                        { target: "a2", actions: "third" },
                                    ],
                                    DYN: {
                                        target: "a2",
                                        guard: { type: "gt", params: ({ event }: any) => ({ limit: event.limit }) },
                                        actions: "dyn",
                                    },
                                    COMBO: {
                                        target: "a2",
                                        guard: lib.and([
                                            "isPositive",
                                            lib.not("never"),
                                            lib.or(["never", ({ context }: any) => context.n === 3]),
                                        ]),
                                        actions: "combo",
                                    },
                                    IN: { target: "a2", guard: lib.stateIn({ a: "a1" }), actions: "in" },
                                    IN_ID: { target: "a2", guard: lib.stateIn("#s.a.a2"), actions: "inId" },
                                    "*": { target: "a2", actions: "any" },
                                    "user.*": { target: "a2", actions: "user" },
                                    "user.login": { target: "a2", actions: "login" },
                                },
                            },
                            a2: { on: { BACK: "a1" } },
                        },
                    },
                    y: {},
                    z: {},
                },
            },
            implementations: {
                actions: Object.fromEntries(
                    [
                        "rootE",
                        "aE",
                        "a1E",
                        "first",
                        "second",
                        "third",
                        "dyn",
                        "combo",
                        "in",
                        "inId",
                        "any",
                        "user",
                        "login",
                    ].map((n) => [n, r(n)]),
                ),
                guards: {
                    never: () => false,
                    isPositive: ({ context }: any) => context.n > 0,
                    gt: ({ context }: any, params: any) => context.n > params.limit,
                },
            },
        }),
        events: [
            { type: "FORBIDDEN" },
            { type: "FIRST" },
            { type: "BACK" },
            { type: "DYN", limit: 5 },
            { type: "DYN", limit: 1 },
            { type: "BACK" },
            { type: "COMBO" },
            { type: "BACK" },
            { type: "IN_ID" },
            { type: "IN" },
            { type: "BACK" },
            { type: "user.login" },
            { type: "BACK" },
            { type: "user.logout" },
            { type: "BACK" },
            { type: "OTHER" },
            { type: "E" },
            { type: "E" },
            { type: "E" },
        ],
    },
    {
        name: "assign ordering, params and inline actions",
        build: (lib, r) => ({
            config: {
                id: "m",
                initial: "a",
                context: { n: 0, seen: [] as number[] },
                states: {
                    a: {
                        entry: lib.assign({ n: 1 }),
                        on: {
                            INC: {
                                actions: [
                                    lib.assign({ n: ({ context }: any) => context.n + 1 }),
                                    "record",
                                    lib.assign(({ context }: any) => ({
                                        n: context.n * 10,
                                        seen: [...context.seen, context.n],
                                    })),
                                    "record",
                                    { type: "add", params: { by: 5 } },
                                    { type: "add", params: ({ event }: any) => ({ by: event.by }) },
                                    ({ context }: any) => r(`inline:${context.n}`)(),
                                ],
                            },
                        },
                    },
                },
            },
            implementations: {
                actions: {
                    record: ({ context }: any) => r(`record:${context.n}`)(),
                    add: lib.assign({ n: ({ context }: any, params: any) => context.n + params.by }),
                },
            },
        }),
        events: [
            { type: "INC", by: 100 },
            { type: "INC", by: 1 },
        ],
    },
    {
        name: "raise, internal queue and always chains",
        build: (lib, r) => ({
            config: {
                id: "m",
                initial: "a",
                context: { flag: false },
                states: {
                    a: {
                        on: {
                            GO: { target: "b", actions: lib.raise({ type: "Q" }) },
                            ECHO: { actions: lib.raise(({ event }: any) => ({ type: "ECHOED", from: event.type })) },
                            ECHOED: { target: "e", actions: "echoed" },
                        },
                    },
                    b: {
                        entry: "bIn",
                        always: { target: "c", actions: "viaAlways" },
                        on: { Q: { target: "x", actions: "viaQ" } },
                    },
                    c: { entry: "cIn", on: { Q: { target: "d", actions: "cQ" } } },
                    d: {
                        entry: "dIn",
                        always: [
                            { target: "x", guard: "flag" },
                            { target: "e", actions: lib.assign({ flag: true }) },
                        ],
                    },
                    e: { entry: "eIn", on: { RESTART: "a" } },
                    x: {},
                },
            },
            implementations: {
                actions: Object.fromEntries(
                    ["bIn", "viaAlways", "viaQ", "cIn", "cQ", "dIn", "eIn", "echoed"].map((n) => [n, r(n)]),
                ),
                guards: { flag: ({ context }: any) => context.flag },
            },
        }),
        events: [{ type: "GO" }, { type: "RESTART" }, { type: "ECHO" }],
    },
    {
        name: "history: shallow, deep, defaults, parallel parent",
        build: () => ({
            config: {
                id: "h",
                initial: "off",
                states: {
                    off: {
                        on: {
                            ON: "on",
                            ON_HIST: "on.hist",
                            ON_DEEP: "on.deep",
                            ON_DEFAULT: "on.withDefault",
                            TO_P: "p",
                            TO_PH: "p.ph",
                        },
                    },
                    on: {
                        initial: "low",
                        on: { OFF: "off" },
                        states: {
                            low: { on: { UP: "high" } },
                            high: { initial: "h1", states: { h1: { on: { NEXT: "h2" } }, h2: {} } },
                            hist: { type: "history" },
                            deep: { type: "history", history: "deep" },
                            withDefault: { type: "history", target: "high" },
                        },
                    },
                    p: {
                        type: "parallel",
                        on: { OFF: "off" },
                        states: {
                            x: { initial: "x1", states: { x1: { on: { X: "x2" } }, x2: {} } },
                            y: { initial: "y1", states: { y1: {}, y2: {} } },
                            ph: { type: "history", history: "deep" },
                        },
                    },
                },
            },
        }),
        events: [
            { type: "ON_HIST" },
            { type: "OFF" },
            { type: "ON_DEFAULT" },
            { type: "OFF" },
            { type: "ON" },
            { type: "UP" },
            { type: "NEXT" },
            { type: "OFF" },
            { type: "ON_HIST" },
            { type: "OFF" },
            { type: "ON_DEEP" },
            { type: "OFF" },
            { type: "TO_PH" },
            { type: "X" },
            { type: "OFF" },
            { type: "TO_PH" },
            { type: "OFF" },
            { type: "TO_P" },
        ],
    },
    {
        name: "parallel regions, cross-region conflicts, multiple targets, onDone at every level, output",
        build: (_lib, r) => ({
            config: {
                id: "np",
                initial: "run",
                context: { total: 41 },
                output: ({ event }: any) => ({ result: event.output }),
                states: {
                    run: {
                        type: "parallel",
                        entry: "runIn",
                        exit: "runOut",
                        onDone: { target: "wrap", actions: "runDone" },
                        on: { BOTH: { target: [".a.a2", ".b.b2"], actions: "both" } },
                        states: {
                            a: {
                                entry: "aIn",
                                exit: "aOut",
                                initial: "a1",
                                states: {
                                    a1: {
                                        entry: "a1In",
                                        exit: "a1Out",
                                        on: {
                                            E: { target: "a2", actions: "tA" },
                                            CROSS: { target: "#np.run.b.b2", actions: "cross" },
                                            MULTI: { target: ["a2", "#np.run.b.b2"] },
                                        },
                                    },
                                    a2: { entry: "a2In", exit: "a2Out", on: { DONE_A: "af", BACK: "a1" } },
                                    af: { type: "final" },
                                },
                            },
                            b: {
                                entry: "bIn",
                                exit: "bOut",
                                initial: "b1",
                                states: {
                                    b1: {
                                        entry: "b1In",
                                        exit: "b1Out",
                                        on: {
                                            E: { target: "b2", actions: "tB" },
                                            CROSS: { target: "b2", actions: "bOwn" },
                                        },
                                    },
                                    b2: { entry: "b2In", exit: "b2Out", on: { DONE_B: "bf", BACK: "b1" } },
                                    bf: { type: "final" },
                                },
                            },
                        },
                    },
                    wrap: {
                        initial: "step",
                        onDone: { target: "finish", actions: "wrapDone" },
                        states: {
                            step: { on: { NEXT: "wrapped" } },
                            wrapped: { type: "final", output: ({ context }: any) => context.total + 1 },
                        },
                    },
                    finish: {
                        type: "final",
                        entry: "finishIn",
                        exit: "finishOut",
                        output: ({ context }: any) => ({ total: context.total }),
                    },
                },
            },
            implementations: {
                actions: Object.fromEntries(
                    [
                        "runIn",
                        "runOut",
                        "runDone",
                        "both",
                        "aIn",
                        "aOut",
                        "a1In",
                        "a1Out",
                        "tA",
                        "cross",
                        "a2In",
                        "a2Out",
                        "bIn",
                        "bOut",
                        "b1In",
                        "b1Out",
                        "tB",
                        "bOwn",
                        "b2In",
                        "b2Out",
                        "wrapDone",
                        "finishIn",
                        "finishOut",
                    ].map((n) => [n, r(n)]),
                ),
            },
        }),
        events: [
            { type: "E" },
            { type: "BACK" },
            { type: "CROSS" },
            { type: "BACK" },
            { type: "MULTI" },
            { type: "BACK" },
            { type: "BOTH" },
            { type: "DONE_A" },
            { type: "DONE_B" },
            { type: "NEXT" },
            { type: "AFTER_DONE" },
        ],
    },
    {
        name: "initial done and stop",
        build: (_lib, r) => ({
            config: {
                id: "m",
                initial: "a",
                states: {
                    a: { entry: "aIn", exit: "aOut", always: { target: "b", actions: "toB" } },
                    b: { entry: "bIn", exit: "bOut", on: { GO: "c" } },
                    c: { entry: "cIn", exit: "cOut" },
                },
            },
            implementations: {
                actions: Object.fromEntries(["aIn", "aOut", "toB", "bIn", "bOut", "cIn", "cOut"].map((n) => [n, r(n)])),
            },
        }),
        events: [{ type: "GO" }, STOP, { type: "GO" }],
    },
    {
        name: "parallel root done",
        build: () => ({
            config: {
                id: "pr",
                type: "parallel",
                output: ({ event }: any) => event,
                states: {
                    a: { initial: "a1", states: { a1: { on: { DONE_A: "af" } }, af: { type: "final" } } },
                    b: { initial: "b1", states: { b1: { on: { DONE_B: "bf" } }, bf: { type: "final" } } },
                },
            },
        }),
        events: [{ type: "DONE_A" }, { type: "DONE_B" }],
    },
];

describe("parity with xstate (clock-less scenarios)", () => {
    it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))("%s", (_name, scenario) => {
        expect(runOurs(scenario)).toEqual(runTheirs(scenario));
    });
});
