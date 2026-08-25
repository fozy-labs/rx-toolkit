/**
 * Round 2 differential scenarios: guards / actions / mappers throwing at
 * different points of a macrostep (exit action, raised-event handler, assign,
 * composite guard, named guard with params, timer-driven transition, named
 * delay resolver, final output mapper, onDone action, always action).
 *
 * The harness blanks `value` / `context` on `status: "error"` (spec 11.14) and
 * reports `can()` as `null` for non-active snapshots; `matches()` probes are
 * still compared.
 */
import { describeScenarios, type Scenario } from "./harness";

function boom(message: string): () => never {
    return () => {
        throw new Error(message);
    };
}

export const scenarios: Scenario[] = [
    {
        name: "a throwing exit action aborts the transition: no transition / entry actions, matches reflects the last good value",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    exit: [lib.record("aOut1"), boom("exit boom"), lib.record("aOut2")],
                    on: { GO: { target: "b", actions: lib.record("go") } },
                },
                b: { entry: lib.record("bIn") },
            },
        }),
        events: [{ type: "GO" }, { type: "GO" }],
        probes: { matches: ["a", "b"], can: [{ type: "GO" }] },
    },
    {
        name: "a throwing action in a raised event's handler: the first microstep's actions ran, raw error message",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", actions: [lib.record("go"), lib.raise({ type: "NEXT" })] } } },
                b: {
                    entry: lib.record("bIn"),
                    on: { NEXT: { target: "c", actions: [lib.record("next"), boom("next boom")] } },
                },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ type: "GO" }, { type: "GO" }],
    },
    {
        name: "a throwing assign during a transition: later actions of the list never run",
        config: (lib) => ({
            id: "m",
            initial: "a",
            context: { n: 1 },
            states: {
                a: {
                    on: {
                        GO: {
                            target: "b",
                            actions: [lib.assign({ n: 2 }), lib.assign(boom("assign boom")), lib.record("never")],
                        },
                    },
                },
                b: { entry: lib.record("bIn") },
            },
        }),
        events: [{ type: "GO" }, { type: "GO" }],
    },
    {
        name: "a throwing predicate inside a composite and() guard: wrapper message without a guard name",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", guard: lib.and([() => true, boom("inner boom")]) } } },
                b: {},
            },
        }),
        events: [{ type: "GO" }, { type: "GO" }],
    },
    {
        name: "a throwing named guard with params: the wrapper names the guard, the raw message carries the params",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", guard: { type: "check", params: { level: 3 } } } } },
                b: {},
            },
        },
        implementations: () => ({
            guards: {
                check: (_args: unknown, params: any) => {
                    throw new Error(`check failed at level ${params.level}`);
                },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "a throwing named guard inside a not() from the implementation table",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", guard: lib.not("broken") } } },
                b: {},
            },
        }),
        implementations: () => ({ guards: { broken: boom("broken guard") } }),
        events: [{ type: "GO" }],
    },
    {
        name: "a throwing action in an after transition (timer-driven): error status, later timers and events ignored",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: {
                    after: { 10: { target: "b", actions: [lib.record("afterAction"), boom("after boom")] } },
                    on: { GO: { target: "c", actions: lib.record("go") } },
                },
                b: { after: { 10: "c" } },
                c: {},
            },
        }),
        events: [{ advance: 10 }, { type: "GO" }, { advance: 10 }],
        probes: { matches: ["a", "b", "c"] },
    },
    {
        name: "a throwing named delay resolver puts the machine into error status when the state is entered",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", actions: lib.record("go") } } },
                b: { entry: lib.record("bIn"), after: { SLOW: "c" } },
                c: {},
            },
        }),
        implementations: () => ({ delays: { SLOW: boom("delay boom") } }),
        events: [{ type: "GO" }, { type: "GO" }],
    },
    {
        name: "a throwing output mapper of a top-level final state",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { FINISH: "f" } },
                f: { type: "final", entry: lib.record("fIn"), output: boom("output boom") },
            },
        }),
        events: [{ type: "FINISH" }, { type: "FINISH" }],
    },
    {
        name: "a throwing output mapper of a nested final state (resolved for the done event)",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { FINISH: "f" } },
                        f: { type: "final", entry: lib.record("fIn"), output: boom("nested output boom") },
                    },
                    onDone: { target: "q", actions: lib.record("pDone") },
                },
                q: {},
            },
        }),
        events: [{ type: "FINISH" }],
    },
    {
        name: "a throwing action in an onDone transition",
        config: (lib) => ({
            id: "m",
            initial: "p",
            states: {
                p: {
                    initial: "a",
                    states: {
                        a: { on: { FINISH: "f" } },
                        f: { type: "final", entry: lib.record("fIn") },
                    },
                    onDone: { target: "q", actions: [lib.record("pDone"), boom("onDone boom")] },
                },
                q: { entry: lib.record("qIn") },
            },
        }),
        events: [{ type: "FINISH" }, { type: "FINISH" }],
    },
    {
        name: "a throwing action in an always transition after an event: the event's own transition actions ran first",
        config: (lib) => ({
            id: "m",
            initial: "a",
            states: {
                a: { on: { GO: { target: "b", actions: lib.record("go") } } },
                b: {
                    entry: lib.record("bIn"),
                    always: { target: "c", actions: [lib.record("always"), boom("always boom")] },
                },
                c: { entry: lib.record("cIn") },
            },
        }),
        events: [{ type: "GO" }],
    },
    {
        name: "non-Error throwables: the error field carries the thrown value",
        config: {
            id: "m",
            initial: "a",
            states: {
                a: {
                    on: {
                        GO: {
                            actions: () => {
                                throw "plain string failure";
                            },
                        },
                    },
                },
            },
        },
        events: [{ type: "GO" }],
    },
];

describeScenarios("differential: errors thrown by guards / actions / mappers", scenarios);
