/**
 * Type-level contracts of the public statechart types:
 * - inference of `TContext` / `TEvent` from `context` / `types`,
 * - event narrowing inside transitions (`ExtractEvent`),
 * - contextual typing of the builtin creators (`DoNotInfer` parameters),
 * - assignability of our `MachineConfig` to XState's `MachineConfig`
 *   (xstate is a devDependency, imported from tests only).
 */
import { expectTypeOf } from "vitest";
import type { MachineConfig as XStateMachineConfig } from "xstate";

import { assign, cancel, log, mutate, raise } from "../actions";
import { unstable_createMachine as createMachine } from "../createMachine";
import { and, not, or, stateIn } from "../guards";
import type { MachineDefinition } from "../MachineDefinition";
import type {
    ActionArgs,
    AssignAction,
    DoneStateEvent,
    ExtractEvent,
    GuardArgs,
    MachineConfig,
    MachineEvent,
    MachineImplementations,
    MachineSnapshot,
    MutateAction,
    RaiseAction,
} from "../types";

interface Ctx {
    count: number;
    ready: boolean;
}

type Ev =
    { type: "INC"; by: number } | { type: "RESET" } | { type: "user.login"; name: string } | { type: "user.logout" };

describe("statechart types", () => {
    it("MachineConfig<Ctx, Ev> is assignable to xstate's MachineConfig<Ctx, Ev>", () => {
        expectTypeOf<MachineConfig<Ctx, Ev>>().toExtend<XStateMachineConfig<Ctx, Ev>>();
    });

    it("ExtractEvent narrows by exact type, partial wildcard and catch-all", () => {
        expectTypeOf<ExtractEvent<Ev, "INC">>().toEqualTypeOf<{ type: "INC"; by: number }>();
        expectTypeOf<ExtractEvent<Ev, "user.*">>().toEqualTypeOf<
            { type: "user.login"; name: string } | { type: "user.logout" }
        >();
        expectTypeOf<ExtractEvent<Ev, "*">>().toEqualTypeOf<Ev>();
    });

    it("typed config: narrowed events, contextual builtins, rejected unknown keys", () => {
        const config: MachineConfig<Ctx, Ev> = {
            id: "counter",
            context: { count: 0, ready: false },
            initial: "idle",
            states: {
                idle: {
                    entry: [log("entered"), raise({ type: "RESET" }, { delay: 10, id: "r" }), cancel("r")],
                    on: {
                        INC: {
                            actions: assign({ count: ({ context, event }) => context.count + event.by }),
                        },
                        "user.*": {
                            actions: ({ event }) => {
                                expectTypeOf(event).toEqualTypeOf<
                                    { type: "user.login"; name: string } | { type: "user.logout" }
                                >();
                            },
                        },
                        "*": {
                            guard: and(["isReady", ({ context }) => context.ready, not("isBusy"), stateIn("idle")]),
                        },
                        RESET: [
                            { target: "idle", guard: { type: "isReady", params: { strict: true } } },
                            { target: "done", guard: or([{ type: "isBusy" }, "isReady"]) },
                        ],
                        // @ts-expect-error unknown event type
                        NOPE: "idle",
                    },
                    onDone: {
                        actions: ({ event }) => {
                            expectTypeOf(event).toEqualTypeOf<DoneStateEvent>();
                        },
                    },
                },
                done: {
                    type: "final",
                    output: ({ context }) => ({ total: context.count }),
                },
            },
        };
        expect(config).toBeDefined();

        const bad: MachineConfig<Ctx, Ev> = {
            context: { count: 0, ready: false },
            states: {
                a: {
                    // @ts-expect-error raised event must be a member of Ev
                    entry: raise({ type: "NOPE" }),
                },
            },
        };
        expect(bad).toBeDefined();
    });

    it("builtins used directly inside createMachine(...) see the inferred TContext / TEvent", () => {
        // No annotated variable: TContext / TEvent must reach the nested creator
        // calls through the contextual slot while the outer call is still being
        // inferred (works only because builtins are callables, see BuiltinCallable).
        const definition = createMachineSafely(() =>
            createMachine(
                {
                    types: {} as { events: Ev },
                    context: { count: 0, ready: false },
                    initial: "a",
                    states: {
                        a: {
                            // @ts-expect-error raised event must be a member of Ev
                            entry: raise({ type: "NOPE" }),
                            exit: [
                                log(({ context }) => context.count),
                                cancel("r"),
                                raise({ type: "RESET" }, { delay: 10, id: "r" }),
                            ],
                            on: {
                                INC: {
                                    guard: and([
                                        ({ event }) => event.by > 0,
                                        not(({ event }) => event.by < 0),
                                        or(["isReady", stateIn("a")]),
                                    ]),
                                    actions: [
                                        assign({ count: ({ context, event }) => context.count + event.by }),
                                        // an inline arrow next to builtins keeps its contextual type
                                        ({ context, event }) => {
                                            expectTypeOf(context).toEqualTypeOf<{ count: number; ready: boolean }>();
                                            expectTypeOf(event).toEqualTypeOf<{ type: "INC"; by: number }>();
                                        },
                                        assign(({ context, event }) => ({ count: context.count + event.by })),
                                    ],
                                },
                            },
                        },
                    },
                },
                {
                    actions: {
                        inc: assign({ count: ({ context }) => context.count + 1 }),
                        warn: (_args, params: { level: number }) => {
                            expectTypeOf(params.level).toBeNumber();
                        },
                        again: raise({ type: "INC", by: 1 }),
                        // @ts-expect-error raised event must be a member of Ev
                        bad: raise({ type: "NOPE" }),
                    },
                    guards: {
                        isReady: ({ context }) => context.ready,
                        both: and(["isReady", ({ context }) => context.count < 10]),
                    },
                },
            ),
        );
        expectTypeOf(definition).toEqualTypeOf<MachineDefinition<
            { count: number; ready: boolean },
            Ev,
            unknown
        > | null>();
    });

    it("builtins are callables carrying the brand, the XState type and the payload", () => {
        const a = assign({ count: 1 });
        expect(typeof a).toBe("function");
        expect(a.type).toBe("xstate.assign");
        expect(a.assignment).toEqual({ count: 1 });
        expect((a as unknown as { name: string }).name).toBe("assign");
        expect(Object.isFrozen(a)).toBe(true);
        expect(() => (a as unknown as () => void)()).toThrow();

        const r = raise({ type: "X" }, { delay: 5, id: "x" });
        expect(r.event).toEqual({ type: "X" });
        expect(r.delay).toBe(5);
        expect(r.id).toBe("x");

        const g = and(["a", "b"]);
        expect(g.type).toBe("xstate.and");
        expect(g.guards).toEqual(["a", "b"]);
        expect((g as unknown as { name: string }).name).toBe("and");
    });

    it("createMachine infers TContext from `context` and TEvent from `types`", () => {
        const definition = createMachineSafely(() =>
            createMachine({
                types: {} as { events: Ev },
                context: { count: 0, ready: false },
                initial: "a",
                states: { a: {} },
            }),
        );
        expectTypeOf(definition).toEqualTypeOf<MachineDefinition<
            { count: number; ready: boolean },
            Ev,
            unknown
        > | null>();

        const withOutput = createMachineSafely(() =>
            createMachine({
                types: {} as { context: Ctx; events: Ev; output: { total: number } },
                context: { count: 0, ready: false },
                initial: "a",
                states: { a: {} },
            }),
        );
        expectTypeOf(withOutput).toEqualTypeOf<MachineDefinition<Ctx, Ev, { total: number }> | null>();
    });

    it("implementations: explicit param annotations, builtins as named implementations", () => {
        const implementations: MachineImplementations<Ctx, Ev> = {
            actions: {
                warn: (_args, params: { level: number }) => {
                    expectTypeOf(params.level).toBeNumber();
                },
                inc: assign({ count: ({ context }) => context.count + 1 }),
                again: raise({ type: "INC", by: 1 }),
            },
            guards: {
                isReady: ({ context }) => context.ready,
                both: and(["isReady", "isBusy"]),
            },
            delays: {
                SHORT: 100,
                LONG: ({ context }) => context.count * 10,
            },
        };
        expect(implementations).toBeDefined();
    });

    it("implementations: narrowed events (generated code) and system events are accepted in the tables", () => {
        type Inc = Extract<Ev, { type: "INC" }>;
        const implementations: MachineImplementations<Ctx, Ev> = {
            actions: {
                // The converter narrows `event` to the events whose transitions reference the action.
                add: mutate(({ context, event }: ActionArgs<Ctx, Inc>) => {
                    context.count += event.by;
                }),
                log: ({ event }: ActionArgs<Ctx, Inc>) => {
                    expectTypeOf(event.by).toBeNumber();
                },
                // `always` / `after` / `done` references see the full union plus the system events.
                any: ({ event }: ActionArgs<Ctx, MachineEvent<Ev>>) => {
                    expectTypeOf(event.type).toBeString();
                },
            },
            guards: {
                big: ({ event }: GuardArgs<Ctx, Inc>) => event.by > 1,
                ready: ({ context }) => context.ready,
            },
            delays: {
                byEvent: ({ event }: ActionArgs<Ctx, Inc>) => event.by * 10,
            },
        };
        expect(implementations).toBeDefined();

        // Inside the table `mutate` is contextually typed like `assign`.
        const table: MachineImplementations<Ctx, Ev> = {
            actions: {
                bump: mutate(({ context, event }) => {
                    expectTypeOf(context).toEqualTypeOf<Ctx>();
                    expectTypeOf(event).toEqualTypeOf<Ev>();
                }),
            },
        };
        expect(table).toBeDefined();
    });

    it("mutate() is a builtin callable whose recipe sees the inferred TContext / TEvent inside createMachine", () => {
        const definition = createMachine({
            context: { count: 0, ready: false } as Ctx,
            types: { events: {} as Ev },
            initial: "a",
            states: {
                a: {
                    on: {
                        INC: {
                            actions: mutate(({ context, event }) => {
                                expectTypeOf(context).toEqualTypeOf<Ctx>();
                                expectTypeOf(event).toEqualTypeOf<{ type: "INC"; by: number }>();
                                context.count += event.by;
                            }),
                        },
                    },
                },
            },
        });
        expect(definition).toBeDefined();

        const m = mutate<Ctx, Ev>(() => undefined);
        expectTypeOf(m).toEqualTypeOf<MutateAction<Ctx, Ev>>();
        expectTypeOf(m.type).toEqualTypeOf<"rx-toolkit.mutate">();
    });

    it("config.source is an optional string exposed as definition.source", () => {
        const definition = createMachine({ initial: "a", source: "stateDiagram-v2", states: { a: {} } });
        expectTypeOf(definition.source).toEqualTypeOf<string | undefined>();
        expect(() =>
            // @ts-expect-error source must be a string
            createMachine({ initial: "a", source: 1, states: { a: {} } }),
        ).toThrow(/'source' must be a string/);
    });

    it("builtin creators without context fall back to MachineContext / EventObject", () => {
        const a = assign(({ context }) => ({ x: context.anything }));
        expectTypeOf(a).toEqualTypeOf<AssignAction<Record<string, any>, { type: string }>>();

        const r = raise({ type: "X" });
        expectTypeOf(r).toEqualTypeOf<RaiseAction<Record<string, any>, { type: string }, { type: string }>>();

        expectTypeOf<ActionArgs<Ctx, Ev>>().toEqualTypeOf<{ context: Ctx; event: Ev }>();
    });

    it("MachineSnapshot is a discriminated union on status", () => {
        // Type-only: the narrowing below is checked by tsc, the function is never invoked.
        const narrow = (snapshot: MachineSnapshot<Ctx, { total: number }>) => {
            if (snapshot.status === "done") {
                expectTypeOf(snapshot.output).toEqualTypeOf<{ total: number }>();
                expectTypeOf(snapshot.error).toEqualTypeOf<undefined>();
            }
            if (snapshot.status === "error") {
                expectTypeOf(snapshot.error).toBeUnknown();
                expectTypeOf(snapshot.output).toEqualTypeOf<undefined>();
            }
            if (snapshot.status === "active") {
                expectTypeOf(snapshot.output).toEqualTypeOf<undefined>();
            }
        };
        expect(narrow).toBeTypeOf("function");
    });
});

/** `createMachine` is still a stub; run it lazily so a runtime throw does not mask the type assertions. */
function createMachineSafely<T>(factory: () => T): T | null {
    try {
        return factory();
    } catch {
        return null;
    }
}
