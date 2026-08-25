import { createActor, createMachine as createXStateMachine } from "xstate";

import type { MachineDevtoolsActor, MachineDevtoolsLike, MachineDevtoolsSnapshot } from "@/common/devtools/types";
import { SharedOptions } from "@/common/options/SharedOptions";
import { SYMBOL_DISPOSE } from "@/signals/base/disposeSymbol";
import { Signal } from "@/signals/signals/Signal";

import { assign, cancel, log, raise } from "./actions";
import { MachineConfigError } from "./core/MachineConfigError";
import { createMachine } from "./createMachine";
import { Statechart } from "./Statechart";
import type { MachineClock, MachineContext, MachineSnapshot } from "./types";

// --- helpers ---------------------------------------------------------------

/** Records every inspector call of every actor, in order. */
function createFakeInspector() {
    const calls: string[] = [];
    const actors: { sessionId: string | undefined; name: string; definition: unknown; snapshot: unknown }[] = [];
    const snapshots: { snapshot: MachineDevtoolsSnapshot; event: { type: string } }[] = [];
    const inspector: MachineDevtoolsLike = {
        actor(info) {
            actors.push({
                sessionId: info.sessionId,
                name: info.name,
                definition: info.definition,
                snapshot: info.snapshot,
            });
            calls.push(`actor:${info.name}`);
            const handle: MachineDevtoolsActor = {
                event: (event) => {
                    calls.push(`event:${event.type}`);
                },
                snapshot: (snapshot, event) => {
                    snapshots.push({ snapshot, event });
                    calls.push(`snapshot:${event.type}:${snapshot.status}:${JSON.stringify(snapshot.value)}`);
                },
                stop: () => {
                    calls.push("stop");
                },
            };
            return handle;
        },
    };
    return { inspector, calls, actors, snapshots };
}

/** Fake Redux DevTools: records the created keys and every push per key. */
function createFakeDevtools() {
    const keys: string[] = [];
    const pushes: { key: string; value: unknown; actionName: string | undefined }[] = [];
    SharedOptions.DEVTOOLS = {
        state<T>(key: string, initState: T) {
            keys.push(key);
            pushes.push({ key, value: initState, actionName: undefined });
            return (value: T, actionName?: string) => {
                pushes.push({ key, value, actionName });
            };
        },
    };
    return { keys, pushes };
}

function collect<T>(obs: { subscribe(next: (value: T) => void): { unsubscribe(): void } }) {
    const values: T[] = [];
    const subscription = obs.subscribe((value) => values.push(value));
    return { values, unsubscribe: () => subscription.unsubscribe() };
}

/** A simple traffic light with recording actions. */
function trafficLight(actions: string[]) {
    return createMachine(
        {
            id: "light",
            initial: "green",
            context: { cycles: 0 },
            states: {
                green: {
                    entry: "enterGreen",
                    exit: "exitGreen",
                    on: { TIMER: { target: "yellow", actions: "warn" } },
                },
                yellow: { on: { TIMER: "red" } },
                red: {
                    on: {
                        TIMER: { target: "green", actions: assign({ cycles: ({ context }) => context.cycles + 1 }) },
                    },
                },
            },
        },
        {
            actions: {
                enterGreen: () => {
                    actions.push("enterGreen");
                },
                exitGreen: () => {
                    actions.push("exitGreen");
                },
                warn: () => {
                    actions.push("warn");
                },
            },
        },
    );
}

beforeEach(() => {
    SharedOptions.reset();
});

afterEach(() => {
    SharedOptions.reset();
    vi.useRealTimers();
});

// --- construction ----------------------------------------------------------

describe("Statechart construction", () => {
    it("throws a descriptive MachineConfigError for an action name missing from the implementations", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { entry: "missingAction" } },
        });
        expect(() => new Statechart(definition)).toThrow(MachineConfigError);
        expect(() => new Statechart(definition)).toThrow(
            "implementations.actions: action 'missingAction' is not implemented",
        );
    });

    it("throws for missing guards and delays, in that order after actions", () => {
        const noGuard = createMachine({
            id: "m",
            initial: "a",
            states: { a: { on: { GO: { target: "b", guard: "missingGuard" } } }, b: {} },
        });
        expect(() => new Statechart(noGuard)).toThrow(
            "implementations.guards: guard 'missingGuard' is not implemented",
        );

        const noDelay = createMachine({
            id: "m",
            initial: "a",
            states: { a: { after: { SLOW: "b" } }, b: {} },
        });
        expect(() => new Statechart(noDelay)).toThrow("implementations.delays: delay 'SLOW' is not implemented");
    });

    it("accepts the definition once provide() fills the missing names", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { entry: "hello" } },
        });
        const provided = definition.provide({ actions: { hello: () => undefined } });
        const engine = new Statechart(provided);
        expect(engine.status).toBe("running");
        expect(engine.definition).toBe(provided);
        engine.dispose();
    });

    it("exposes the initial snapshot: active, initial value, initial context, tags", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            context: { n: 1 },
            states: { a: { tags: ["first"] }, b: {} },
        });
        const engine = new Statechart(definition);
        const snapshot = engine.state();
        expect(snapshot.status).toBe("active");
        expect(snapshot.value).toBe("a");
        expect(snapshot.context).toEqual({ n: 1 });
        expect(snapshot.tags).toEqual(["first"]);
        expect(snapshot.output).toBeUndefined();
        expect(snapshot.error).toBeUndefined();
        expect(engine.getSnapshot()).toBe(engine.state.peek());
        engine.dispose();
    });

    it("assigns a unique sessionId per instance", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });
        const first = new Statechart(definition);
        const second = new Statechart(definition);
        expect(first.sessionId).toMatch(/^sc:\d+$/);
        expect(first.sessionId).not.toBe(second.sessionId);
        first.dispose();
        second.dispose();
    });

    it("autoStart (default) starts the engine; autoStart: false leaves it idle with the initial snapshot computed", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: {}, b: {} } });
        const auto = new Statechart(definition);
        expect(auto.status).toBe("running");
        auto.dispose();

        const manual = new Statechart(definition, { autoStart: false });
        expect(manual.status).toBe("idle");
        expect(manual.state().value).toBe("a");
        manual.dispose();
    });

    it("defers initial entry effects until start() and queues events sent while idle", () => {
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: {
                    a: { entry: "enterA", on: { GO: "b" } },
                    b: { entry: "enterB" },
                },
            },
            {
                actions: {
                    enterA: () => {
                        trace.push("enterA");
                    },
                    enterB: () => {
                        trace.push("enterB");
                    },
                },
            },
        );
        const engine = new Statechart(definition, { autoStart: false });
        expect(trace).toEqual([]);
        engine.send({ type: "GO" });
        expect(engine.state().value).toBe("a");
        expect(trace).toEqual([]);

        engine.start();
        expect(trace).toEqual(["enterA", "enterB"]);
        expect(engine.state().value).toBe("b");
        expect(engine.status).toBe("running");
        engine.dispose();
    });
});

// --- send / macrosteps -----------------------------------------------------

describe("Statechart.send()", () => {
    it("runs a full macrostep synchronously and emits exactly one snapshot", () => {
        const actions: string[] = [];
        const engine = new Statechart(trafficLight(actions));
        const { values, unsubscribe } = collect(engine.state.obs);
        expect(values).toHaveLength(1); // BehaviorSubject replay

        engine.send({ type: "TIMER" });
        expect(values).toHaveLength(2);
        expect(values[1]!.value).toBe("yellow");
        expect(actions).toEqual(["enterGreen", "exitGreen", "warn"]);

        engine.send({ type: "TIMER" });
        engine.send({ type: "TIMER" });
        expect(values).toHaveLength(4);
        expect(engine.state().value).toBe("green");
        expect(engine.state().context).toEqual({ cycles: 1 });
        unsubscribe();
        engine.dispose();
    });

    it("emits one snapshot for a macrostep that chains raise and always transitions", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            context: { n: 0 },
            states: {
                a: { on: { GO: { target: "b", actions: raise({ type: "NEXT" }) } } },
                b: { on: { NEXT: "c" } },
                c: { always: { target: "d", actions: assign({ n: 42 }) } },
                d: {},
            },
        });
        const engine = new Statechart(definition);
        const { values, unsubscribe } = collect(engine.state.obs);
        engine.send({ type: "GO" });
        expect(values).toHaveLength(2);
        expect(values[1]).toMatchObject({ value: "d", context: { n: 42 } });
        unsubscribe();
        engine.dispose();
    });

    it("keeps the snapshot Object.is-stable when an event changes nothing", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "b" } }, b: {} } });
        const engine = new Statechart(definition);
        const before = engine.state();
        const { values, unsubscribe } = collect(engine.state.obs);
        engine.send({ type: "UNKNOWN" });
        expect(engine.state()).toBe(before);
        expect(values).toHaveLength(1);
        unsubscribe();
        engine.dispose();
    });

    it("processes re-entrant sends from actions in FIFO order after the current macrostep", () => {
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: {
                    a: { on: { GO: { target: "b", actions: ["sendTwo", "record"] } } },
                    b: { on: { X: "c" } },
                    c: { on: { Y: "d" } },
                    d: {},
                },
            },
            {
                actions: {
                    sendTwo: () => {
                        engine.send({ type: "X" });
                        engine.send({ type: "Y" });
                        trace.push(`after-send:${engine.state.peek().value}`);
                    },
                    record: () => {
                        trace.push(`record:${engine.state.peek().value}`);
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        const { values, unsubscribe } = collect(engine.state.obs);
        engine.send({ type: "GO" });
        // Both actions saw the previous snapshot: the nested sends were queued, not processed.
        expect(trace).toEqual(["after-send:a", "record:a"]);
        expect(values.map((snapshot) => snapshot.value)).toEqual(["a", "b", "c", "d"]);
        expect(engine.state().value).toBe("d");
        unsubscribe();
        engine.dispose();
    });

    it("batches the whole re-entrant burst: a Computed over the snapshot recomputes once per burst", () => {
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: {
                    a: { on: { GO: { target: "b", actions: "sendNext" } } },
                    b: { on: { X: "c" } },
                    c: {},
                },
            },
            {
                actions: {
                    sendNext: () => {
                        engine.send({ type: "X" });
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        const seen: string[] = [];
        const label = Signal.compute(() => `value:${JSON.stringify(engine.state().value)}`);
        const effect = Signal.effect(() => {
            seen.push(label());
        });
        expect(seen).toEqual(['value:"a"']);
        engine.send({ type: "GO" });
        expect(seen).toEqual(['value:"a"', 'value:"c"']);
        effect.unsubscribe();
        label.dispose();
        engine.dispose();
    });

    it("throws a TypeError for an event without a string type", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });
        const engine = new Statechart(definition);
        expect(() => engine.send({} as never)).toThrow(TypeError);
        expect(() => engine.send(null as never)).toThrow(TypeError);
        engine.dispose();
    });

    it("silently ignores events after stop() and dispose()", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "b" } }, b: {} } });
        const engine = new Statechart(definition);
        engine.stop();
        engine.send({ type: "GO" });
        expect(engine.state().value).toBe("a");
        engine.dispose();
        expect(() => engine.send({ type: "GO" })).not.toThrow();
    });

    it("throws the infinite-loop guard error after maxMicrosteps and enters the error status", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { on: { GO: "b" } }, b: { always: "c" }, c: { always: "b" } },
        });
        const engine = new Statechart(definition, { maxMicrosteps: 50 });
        expect(() => engine.send({ type: "GO" })).toThrow(/Infinite loop detected/);
        expect(engine.state().status).toBe("error");
        expect(engine.status).toBe("stopped");
        engine.dispose();
    });
});

// --- queries ---------------------------------------------------------------

describe("Statechart queries", () => {
    it("matches() accepts string paths and nested objects", () => {
        const definition = createMachine({
            id: "m",
            initial: "outer",
            states: { outer: { initial: "inner", states: { inner: {} } } },
        });
        const engine = new Statechart(definition);
        expect(engine.matches("outer")).toBe(true);
        expect(engine.matches("outer.inner")).toBe(true);
        expect(engine.matches({ outer: "inner" })).toBe(true);
        expect(engine.matches("other")).toBe(false);
        engine.dispose();
    });

    it("can() reports handled events on any engine status and false once disposed", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { on: { GO: "b", NOOP: {} } }, b: {} },
        });
        const idle = new Statechart(definition, { autoStart: false });
        expect(idle.can({ type: "GO" })).toBe(true);
        expect(idle.can({ type: "NOOP" })).toBe(false); // forbidden transition: no target, no actions
        expect(idle.can({ type: "NOPE" })).toBe(false);
        idle.dispose();
        expect(idle.can({ type: "GO" })).toBe(false);

        const stopped = new Statechart(definition);
        stopped.stop();
        expect(stopped.can({ type: "GO" })).toBe(false);
        stopped.dispose();
    });
});

// --- timers ----------------------------------------------------------------

describe("Statechart timers", () => {
    it("fires after transitions through the global clock (fake timers) and cancels them on exit", () => {
        vi.useFakeTimers();
        const definition = createMachine({
            id: "light",
            initial: "green",
            states: {
                green: { after: { 1000: "yellow" }, on: { SKIP: "red" } },
                yellow: { after: { 500: "red" } },
                red: {},
            },
        });
        const engine = new Statechart(definition);
        const { values, unsubscribe } = collect(engine.state.obs);
        vi.advanceTimersByTime(999);
        expect(engine.state().value).toBe("green");
        vi.advanceTimersByTime(1);
        expect(engine.state().value).toBe("yellow");
        expect(values).toHaveLength(2);

        engine.send({ type: "SKIP" }); // no transition from yellow: the yellow timer keeps running
        vi.advanceTimersByTime(500);
        expect(engine.state().value).toBe("red");
        expect(vi.getTimerCount()).toBe(0);
        unsubscribe();
        engine.dispose();
    });

    it("cancels the pending after timer when the state is exited early", () => {
        vi.useFakeTimers();
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { after: { 1000: "timedOut" }, on: { GO: "b" } }, b: {}, timedOut: {} },
        });
        const engine = new Statechart(definition);
        expect(vi.getTimerCount()).toBe(1);
        engine.send({ type: "GO" });
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(2000);
        expect(engine.state().value).toBe("b");
        engine.dispose();
    });

    it("resolves named delays through the implementation table (number and function)", () => {
        vi.useFakeTimers();
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                context: { factor: 2 },
                states: { a: { after: { SHORT: "b" } }, b: { after: { SCALED: "c" } }, c: {} },
            },
            { delays: { SHORT: 100, SCALED: ({ context }) => 100 * context.factor } },
        );
        const engine = new Statechart(definition);
        vi.advanceTimersByTime(100);
        expect(engine.state().value).toBe("b");
        vi.advanceTimersByTime(199);
        expect(engine.state().value).toBe("b");
        vi.advanceTimersByTime(1);
        expect(engine.state().value).toBe("c");
        engine.dispose();
    });

    it("delivers delayed raise through the queue and cancel(id) drops it", () => {
        vi.useFakeTimers();
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: raise({ type: "PING" }, { delay: 300, id: "ping" }),
                    on: { PING: "pinged", ABORT: { actions: cancel("ping") } },
                },
                pinged: {},
            },
        });
        const engine = new Statechart(definition);
        engine.send({ type: "ABORT" });
        vi.advanceTimersByTime(300);
        expect(engine.state().value).toBe("a");
        engine.dispose();

        const second = new Statechart(definition);
        vi.advanceTimersByTime(300);
        expect(second.state().value).toBe("pinged");
        second.dispose();
    });

    it("replaces a pending delayed raise scheduled under the same id (spec 11.11)", () => {
        vi.useFakeTimers();
        const hits: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: {
                    a: {
                        on: {
                            ARM: { actions: raise({ type: "FIRE" }, { delay: 100, id: "shot" }) },
                            FIRE: { actions: "hit" },
                        },
                    },
                },
            },
            {
                actions: {
                    hit: () => {
                        hits.push("hit");
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        engine.send({ type: "ARM" });
        vi.advanceTimersByTime(50);
        engine.send({ type: "ARM" });
        vi.advanceTimersByTime(50);
        expect(hits).toEqual([]);
        vi.advanceTimersByTime(50);
        expect(hits).toEqual(["hit"]);
        vi.advanceTimersByTime(1000);
        expect(hits).toEqual(["hit"]);
        engine.dispose();
    });

    it("uses the injected clock and clears every timer on stop() and dispose()", () => {
        const scheduled = new Map<number, () => void>();
        const cleared: number[] = [];
        let seq = 0;
        const clock: MachineClock = {
            setTimeout: (callback) => {
                const handle = ++seq;
                scheduled.set(handle, () => {
                    scheduled.delete(handle);
                    callback();
                });
                return handle;
            },
            clearTimeout: (handle) => {
                cleared.push(handle as number);
                scheduled.delete(handle as number);
            },
        };
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { after: { 1000: "b" } }, b: { after: { 1000: "a" } } },
        });
        const engine = new Statechart(definition, { clock });
        expect(scheduled.size).toBe(1);
        scheduled.get(1)!();
        expect(engine.state().value).toBe("b");
        expect(scheduled.size).toBe(1);

        engine.stop();
        expect(scheduled.size).toBe(0);
        expect(cleared).toEqual([2]);

        engine.start();
        expect(engine.state().value).toBe("a");
        expect(scheduled.size).toBe(1);
        engine.dispose();
        expect(scheduled.size).toBe(0);
    });

    it("ignores a stale timer callback after stop() and after a restart (a clock that never clears)", () => {
        const callbacks: (() => void)[] = [];
        const clock: MachineClock = {
            setTimeout: (callback) => {
                callbacks.push(callback);
                return callbacks.length;
            },
            clearTimeout: () => undefined,
        };
        const definition = createMachine({ id: "m", initial: "a", states: { a: { after: { 10: "b" } }, b: {} } });
        const engine = new Statechart(definition, { clock });
        engine.stop();
        callbacks[0]!();
        expect(engine.state().status).toBe("stopped");
        expect(engine.state().value).toBe("a");

        engine.start();
        expect(callbacks).toHaveLength(2);
        callbacks[0]!(); // the cancelled timer of the first run fires anyway: it belongs to a state the engine left
        expect(engine.state()).toMatchObject({ status: "active", value: "a" });
        callbacks[1]!(); // the live timer of the second run
        expect(engine.state().value).toBe("b");
        engine.dispose();
    });

    it("cancels every timer when the machine reaches a top-level final state", () => {
        vi.useFakeTimers();
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: {
                a: {
                    entry: raise({ type: "LATER" }, { delay: 5000, id: "later" }),
                    after: { 1000: "b" },
                    on: { FINISH: "done" },
                },
                b: {},
                done: { type: "final" },
            },
        });
        const engine = new Statechart(definition);
        expect(vi.getTimerCount()).toBe(2);
        engine.send({ type: "FINISH" });
        expect(engine.state().status).toBe("done");
        expect(engine.status).toBe("stopped");
        expect(vi.getTimerCount()).toBe(0);
        engine.dispose();
    });
});

// --- lifecycle -------------------------------------------------------------

describe("Statechart lifecycle", () => {
    it("stop() commits a stopped snapshot without running exit actions (xstate.stop semantics)", () => {
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: { a: { exit: "exitA", on: { GO: "b" } }, b: {} },
            },
            {
                actions: {
                    exitA: () => {
                        trace.push("exitA");
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        const { values, unsubscribe } = collect(engine.state.obs);
        engine.stop();
        expect(engine.status).toBe("stopped");
        expect(engine.state().status).toBe("stopped");
        expect(engine.state().value).toBe("a");
        expect(trace).toEqual([]);
        expect(values).toHaveLength(2);
        engine.stop(); // no-op
        expect(values).toHaveLength(2);
        unsubscribe();
        engine.dispose();
    });

    it("matches xstate: actor.stop() does not run exit actions either", () => {
        const trace: string[] = [];
        const machine = createXStateMachine({
            id: "m",
            initial: "a",
            states: { a: { exit: () => trace.push("exitA") } },
        });
        const actor = createActor(machine).start();
        actor.stop();
        expect(actor.getSnapshot().status).toBe("stopped");
        expect(trace).toEqual([]);
    });

    it("start() after stop() re-initializes from scratch (fresh context, entry actions again)", () => {
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                context: () => ({ n: 0 }),
                states: {
                    a: { entry: "enterA", on: { INC: { actions: assign({ n: ({ context }) => context.n + 1 }) } } },
                },
            },
            {
                actions: {
                    enterA: () => {
                        trace.push("enterA");
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        engine.send({ type: "INC" });
        expect(engine.state().context.n).toBe(1);
        engine.stop();
        engine.start();
        expect(engine.status).toBe("running");
        expect(engine.state().status).toBe("active");
        expect(engine.state().context.n).toBe(0);
        expect(trace).toEqual(["enterA", "enterA"]);
        engine.send({ type: "INC" });
        expect(engine.state().context.n).toBe(1);
        engine.dispose();
    });

    it("start() on a running engine is a no-op", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });
        const engine = new Statechart(definition);
        const { values, unsubscribe } = collect(engine.state.obs);
        engine.start();
        expect(values).toHaveLength(1);
        unsubscribe();
        engine.dispose();
    });

    it("moves straight to stopped when the initial snapshot is already done", () => {
        const definition = createMachine({
            id: "m",
            initial: "end",
            output: () => ({ ok: true }),
            states: { end: { type: "final" } },
        });
        const engine = new Statechart(definition, { autoStart: false });
        engine.send({ type: "IGNORED" });
        engine.start();
        expect(engine.status).toBe("stopped");
        expect(engine.state().status).toBe("done");
        expect(engine.state().output).toEqual({ ok: true });
        engine.dispose();
    });

    it("stop() called from inside an action is deferred until the macrostep finished", () => {
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: {
                    a: { on: { GO: { target: "b", actions: ["stopEngine", "afterStop"] } } },
                    b: { entry: "enterB" },
                },
            },
            {
                actions: {
                    stopEngine: () => {
                        engine.stop();
                        trace.push(`stop:${engine.status}`);
                    },
                    afterStop: () => {
                        trace.push("afterStop");
                    },
                    enterB: () => {
                        trace.push("enterB");
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        const { values, unsubscribe } = collect(engine.state.obs);
        engine.send({ type: "GO" });
        expect(trace).toEqual(["stop:running", "afterStop", "enterB"]);
        expect(engine.status).toBe("stopped");
        expect(values.map((snapshot) => `${snapshot.status}:${String(snapshot.value)}`)).toEqual([
            "active:a",
            "active:b",
            "stopped:b",
        ]);
        unsubscribe();
        engine.dispose();
    });

    it("start() from a synchronous obs subscriber of the done snapshot is deferred to the end of the burst", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { on: { FINISH: "end" } }, end: { type: "final" } },
        });
        const engine = new Statechart(definition);
        const statuses: string[] = [];
        const subscription = engine.state.obs.subscribe((snapshot) => {
            statuses.push(`${snapshot.status}:${engine.status}`);
            if (snapshot.status === "done") engine.start();
        });
        expect(() => engine.send({ type: "FINISH" })).not.toThrow();
        expect(engine.status).toBe("running");
        expect(engine.state()).toMatchObject({ status: "active", value: "a" });
        // The engine had already left `running` when the done snapshot was published.
        expect(statuses).toEqual(["active:running", "done:stopped", "active:running"]);
        subscription.unsubscribe();
        engine.dispose();
    });

    it("dispose() is idempotent, completes the observable and makes start() throw", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });
        const engine = new Statechart(definition);
        let completed = false;
        const subscription = engine.state.obs.subscribe({ complete: () => (completed = true) });
        engine.dispose();
        expect(completed).toBe(true);
        expect(engine.status).toBe("disposed");
        expect(() => engine.dispose()).not.toThrow();
        expect(() => engine.start()).toThrow("Statechart has been disposed");
        expect(engine.state().status).toBe("stopped");
        subscription.unsubscribe();
    });

    it("dispose() called from inside an action finishes after the macrostep", () => {
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: {
                    a: { on: { GO: { target: "b", actions: ["disposeEngine", "afterDispose"] } } },
                    b: {},
                },
            },
            {
                actions: {
                    disposeEngine: () => {
                        engine.dispose();
                        engine.dispose();
                        trace.push(`dispose:${engine.status}`);
                    },
                    afterDispose: () => {
                        trace.push("afterDispose");
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        let completed = false;
        const subscription = engine.state.obs.subscribe({ complete: () => (completed = true) });
        engine.send({ type: "GO" });
        expect(trace).toEqual(["dispose:running", "afterDispose"]);
        expect(engine.status).toBe("disposed");
        expect(engine.state().status).toBe("stopped");
        expect(completed).toBe(true);
        subscription.unsubscribe();
    });

    it("supports Symbol.dispose", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });
        const engine = new Statechart(definition);
        engine[SYMBOL_DISPOSE]();
        expect(engine.status).toBe("disposed");
    });
});

// --- errors ----------------------------------------------------------------

describe("Statechart errors", () => {
    it("commits an error snapshot, stops the engine and rethrows from send() without onError", () => {
        const boom = new Error("boom");
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                context: { n: 1 },
                states: { a: { on: { GO: { target: "b", actions: ["explode"] } } }, b: {} },
            },
            {
                actions: {
                    explode: () => {
                        throw boom;
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        const { values, unsubscribe } = collect(engine.state.obs);
        expect(() => engine.send({ type: "GO" })).toThrow(boom);
        expect(engine.status).toBe("stopped");
        const snapshot = engine.state();
        expect(snapshot.status).toBe("error");
        expect(snapshot.error).toBe(boom);
        expect(snapshot.value).toBe("a"); // last good configuration kept
        expect(snapshot.context).toEqual({ n: 1 });
        expect(values).toHaveLength(2);
        engine.send({ type: "GO" }); // ignored
        expect(values).toHaveLength(2);
        unsubscribe();
        engine.dispose();
    });

    it("calls onError instead of throwing when provided", () => {
        const boom = new Error("boom");
        const onError = vi.fn();
        const definition = createMachine(
            { id: "m", initial: "a", states: { a: { on: { GO: { actions: "explode" } } } } },
            {
                actions: {
                    explode: () => {
                        throw boom;
                    },
                },
            },
        );
        const engine = new Statechart(definition, { onError });
        expect(() => engine.send({ type: "GO" })).not.toThrow();
        expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
        expect(engine.state().status).toBe("error");
        engine.dispose();
    });

    it("wraps guard errors like XState and reports them through the same policy", () => {
        const definition = createMachine(
            { id: "m", initial: "a", states: { a: { on: { GO: { target: "b", guard: "bad" } } }, b: {} } },
            {
                guards: {
                    bad: () => {
                        throw new Error("nope");
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        expect(() => engine.send({ type: "GO" })).toThrow(
            "Unable to evaluate guard 'bad' in transition for event 'GO' in state node 'm.a':\nnope",
        );
        expect(engine.state().status).toBe("error");
        engine.dispose();
    });

    it("throws from the constructor when an initial builtin fails (assign at init) and releases resources", () => {
        const devtools = createFakeDevtools();
        const { inspector, calls } = createFakeInspector();
        const boom = new Error("init boom");
        const definition = createMachine({
            id: "m",
            initial: "a",
            context: { n: 0 },
            states: {
                a: {
                    entry: assign(() => {
                        throw boom;
                    }),
                },
            },
        });
        expect(() => new Statechart(definition, { inspector })).toThrow(boom);
        expect(calls).toEqual(["actor:m", "stop"]);
        expect(devtools.pushes.map((push) => push.value)).toEqual([
            expect.objectContaining({ status: "error", error: boom }),
            "$COMPLETED",
        ]);
    });

    it("keeps a stopped engine with the error snapshot when onError handles an init-time builtin failure", () => {
        const boom = new Error("init boom");
        const onError = vi.fn();
        const definition = createMachine({
            id: "m",
            initial: "a",
            context: { n: 0 },
            states: {
                a: {
                    entry: assign(() => {
                        throw boom;
                    }),
                },
            },
        });
        const engine = new Statechart(definition, { onError });
        expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
        expect(engine.status).toBe("stopped");
        expect(engine.state().status).toBe("error");
        expect(engine.state().error).toBe(boom);
        expect(engine.state().context).toEqual({ n: 0 });
        engine.dispose();
    });

    it("reports a throwing initial custom entry action from start() with actionName xstate.init", () => {
        const devtools = createFakeDevtools();
        const boom = new Error("entry boom");
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: { a: { entry: ["explode", "never"] } },
            },
            {
                actions: {
                    explode: () => {
                        throw boom;
                    },
                    never: () => {
                        trace.push("never");
                    },
                },
            },
        );
        const engine = new Statechart(definition, { autoStart: false });
        expect(() => engine.start()).toThrow(boom);
        expect(trace).toEqual([]);
        expect(engine.status).toBe("stopped");
        expect(engine.state().status).toBe("error");
        expect(engine.state().value).toBe("a");
        expect(devtools.pushes.at(-1)).toMatchObject({
            actionName: "xstate.init",
            value: expect.objectContaining({ status: "error", error: boom }),
        });
        engine.dispose();

        // With autoStart the same failure leaves the constructor.
        expect(() => new Statechart(definition)).toThrow(boom);
    });

    it("rethrows from a re-initializing start() after stop()", () => {
        let shouldThrow = false;
        const boom = new Error("second init");
        const definition = createMachine({
            id: "m",
            initial: "a",
            context: () => {
                if (shouldThrow) throw boom;
                return { n: 0 };
            },
            states: { a: {} },
        });
        const engine = new Statechart(definition);
        engine.stop();
        shouldThrow = true;
        expect(() => engine.start()).toThrow(boom);
        expect(engine.status).toBe("stopped");
        expect(engine.state().status).toBe("error");
        engine.dispose();
    });

    it("surfaces timer-driven errors from the clock callback (no onError) or through onError", () => {
        vi.useFakeTimers();
        const boom = new Error("timer boom");
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: { a: { after: { 100: { target: "b", actions: "explode" } } }, b: {} },
            },
            {
                actions: {
                    explode: () => {
                        throw boom;
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        expect(() => vi.advanceTimersByTime(100)).toThrow(boom);
        expect(engine.state().status).toBe("error");
        engine.dispose();

        const onError = vi.fn();
        const handled = new Statechart(definition, { onError });
        vi.advanceTimersByTime(100);
        expect(onError).toHaveBeenCalledExactlyOnceWith(boom);
        handled.dispose();
    });

    it("onError may dispose the engine safely", () => {
        const definition = createMachine(
            { id: "m", initial: "a", states: { a: { on: { GO: { actions: "explode" } } } } },
            {
                actions: {
                    explode: () => {
                        throw new Error("x");
                    },
                },
            },
        );
        const engine = new Statechart(definition, { onError: () => engine.dispose() });
        engine.send({ type: "GO" });
        expect(engine.status).toBe("disposed");
    });
});

// --- devtools --------------------------------------------------------------

describe("Statechart Redux DevTools", () => {
    it("registers under Statechart/<machine id> by default and pushes with the event type as actionName", () => {
        const devtools = createFakeDevtools();
        const definition = createMachine({ id: "light", initial: "a", states: { a: { on: { GO: "b" } }, b: {} } });
        const engine = new Statechart(definition);
        expect(devtools.keys).toEqual(["Statechart/light"]);
        engine.send({ type: "GO" });
        engine.send({ type: "IGNORED" });
        engine.stop();
        engine.dispose();
        expect(devtools.pushes.map((push) => [push.actionName, push.value])).toEqual([
            [undefined, expect.objectContaining({ value: "a" })],
            ["GO", expect.objectContaining({ value: "b" })],
            ["xstate.stop", expect.objectContaining({ status: "stopped" })],
            [undefined, "$COMPLETED"],
        ]);
    });

    it("uses an explicit key verbatim, a string option as the key, and honours {base}", () => {
        const devtools = createFakeDevtools();
        const definition = createMachine({ id: "light", initial: "a", states: { a: {} } });
        const withKey = new Statechart(definition, { key: "trafficLight" });
        const withString = new Statechart(definition, "asString");
        const withBase = new Statechart(definition, { key: "{base}/custom" });
        expect(devtools.keys).toEqual(["trafficLight", "asString", "Statechart/custom"]);
        withKey.dispose();
        withString.dispose();
        withBase.dispose();
    });

    it("gives concurrent keyless instances of one machine id distinct default keys and reuses freed slots", () => {
        const devtools = createFakeDevtools();
        const definition = createMachine({ id: "keyed", initial: "a", states: { a: {} } });
        const other = createMachine({ id: "other", initial: "a", states: { a: {} } });
        const first = new Statechart(definition);
        const second = new Statechart(definition);
        const third = new Statechart(definition);
        const unrelated = new Statechart(other);
        expect(devtools.keys).toEqual([
            "Statechart/keyed",
            "Statechart/keyed#2",
            "Statechart/keyed#3",
            "Statechart/other",
        ]);

        second.dispose();
        const fourth = new Statechart(definition); // the lowest free slot
        expect(devtools.keys.at(-1)).toBe("Statechart/keyed#2");

        first.dispose();
        third.dispose();
        fourth.dispose();
        unrelated.dispose();
        const again = new Statechart(definition); // everything released: the bare name again
        expect(devtools.keys.at(-1)).toBe("Statechart/keyed");
        again.dispose();
    });

    it("re-mount pattern: dispose then re-create yields the same default key (no #2)", () => {
        const devtools = createFakeDevtools();
        const definition = createMachine({ id: "remount", initial: "a", states: { a: {} } });
        const mounted = new Statechart(definition);
        mounted.dispose();
        const remounted = new Statechart(definition);
        expect(devtools.keys).toEqual(["Statechart/remount", "Statechart/remount"]);
        remounted.dispose();
    });

    it("releases the default key slot when the constructor throws", () => {
        const devtools = createFakeDevtools();
        const definition = createMachine({
            id: "failing",
            initial: "a",
            states: {
                a: {
                    entry: assign(() => {
                        throw new Error("x");
                    }),
                },
            },
        });
        expect(() => new Statechart(definition)).toThrow("x");
        expect(() => new Statechart(definition)).toThrow("x");
        expect(devtools.keys).toEqual(["Statechart/failing", "Statechart/failing"]);
    });

    it("isDisabled turns Redux DevTools off for the instance", () => {
        const devtools = createFakeDevtools();
        const definition = createMachine({ id: "light", initial: "a", states: { a: {} } });
        const engine = new Statechart(definition, { isDisabled: true });
        expect(devtools.keys).toEqual([]);
        engine.dispose();
    });
});

describe("Statechart inspector", () => {
    it("registers the actor at construction, then event + snapshot per macrostep, stop snapshot only, stop on dispose", () => {
        const { inspector, calls, actors } = createFakeInspector();
        const definition = createMachine({
            id: "light",
            initial: "a",
            states: { a: { on: { GO: "b" } }, b: {} },
        });
        const engine = new Statechart(definition, { inspector, autoStart: false });
        expect(actors).toEqual([
            {
                sessionId: engine.sessionId,
                name: "light",
                definition: definition.config,
                snapshot: expect.objectContaining({ status: "active", value: "a" }),
            },
        ]);
        expect(calls).toEqual(["actor:light"]);

        engine.start();
        engine.send({ type: "GO" });
        engine.send({ type: "IGNORED" }); // unchanged snapshot is still reported
        engine.stop();
        engine.dispose();
        expect(calls).toEqual([
            "actor:light",
            "event:xstate.init",
            'snapshot:xstate.init:active:"a"',
            "event:GO",
            'snapshot:GO:active:"b"',
            "event:IGNORED",
            'snapshot:IGNORED:active:"b"',
            'snapshot:xstate.stop:stopped:"b"',
            "stop",
        ]);
    });

    it("reports internal after events and error snapshots", () => {
        vi.useFakeTimers();
        const { inspector, calls } = createFakeInspector();
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: { a: { after: { 10: "b" } }, b: { on: { GO: { actions: "explode" } } } },
            },
            {
                actions: {
                    explode: () => {
                        throw new Error("x");
                    },
                },
            },
        );
        const engine = new Statechart(definition, { inspector, onError: () => undefined });
        vi.advanceTimersByTime(10);
        engine.send({ type: "GO" });
        expect(calls.slice(3)).toEqual([
            "event:xstate.after.10.m.a",
            'snapshot:xstate.after.10.m.a:active:"b"',
            "event:GO",
            'snapshot:GO:error:"b"',
        ]);
        engine.dispose();
    });

    it("treats a throwing adapter as best-effort: engine invariants hold, the adapter is disabled, one console.error", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        vi.useFakeTimers();
        const calls: string[] = [];
        const inspector: MachineDevtoolsLike = {
            actor: () => ({
                event: (event) => {
                    calls.push(`event:${event.type}`);
                },
                snapshot: (snapshot) => {
                    calls.push(`snapshot:${snapshot.status}`);
                    if (snapshot.status === "done") throw new Error("adapter boom");
                },
                stop: () => {
                    calls.push("stop");
                },
            }),
        };
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: {
                a: { entry: raise({ type: "LATER" }, { delay: 1000, id: "later" }), on: { FINISH: "end" } },
                end: { type: "final" },
            },
        });
        const engine = new Statechart(definition, { inspector });
        expect(() => engine.send({ type: "FINISH" })).not.toThrow();
        expect(engine.status).toBe("stopped");
        expect(engine.state().status).toBe("done");
        expect(vi.getTimerCount()).toBe(0);
        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(consoleError.mock.calls[0]![0]).toContain("inspector adapter threw");
        engine.dispose();
        // Nothing after the failure reaches the adapter, not even `stop`.
        expect(calls).toEqual(["event:xstate.init", "snapshot:active", "event:FINISH", "snapshot:done"]);
        consoleError.mockRestore();
    });

    it("a throwing actor() registration neither breaks construction nor leaks the devtools entry", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const devtools = createFakeDevtools();
        const inspector: MachineDevtoolsLike = {
            actor: () => {
                throw new Error("no actor");
            },
        };
        const definition = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "b" } }, b: {} } });
        const engine = new Statechart(definition, { inspector });
        expect(engine.status).toBe("running");
        expect(consoleError).toHaveBeenCalledTimes(1);
        engine.send({ type: "GO" });
        expect(engine.state().value).toBe("b");
        engine.dispose();
        expect(devtools.pushes.map((push) => push.value).at(-1)).toBe("$COMPLETED");
        consoleError.mockRestore();
    });

    it("defaults to SharedOptions.MACHINE_DEVTOOLS and lets the instance override it (null = off)", () => {
        const shared = createFakeInspector();
        const own = createFakeInspector();
        SharedOptions.MACHINE_DEVTOOLS = shared.inspector;
        const definition = createMachine({ id: "m", initial: "a", states: { a: {} } });

        const fromShared = new Statechart(definition);
        const fromOwn = new Statechart(definition, { inspector: own.inspector });
        const off = new Statechart(definition, { inspector: null });
        expect(shared.actors).toHaveLength(1);
        expect(own.actors).toHaveLength(1);
        fromShared.dispose();
        fromOwn.dispose();
        off.dispose();
        expect(shared.calls.at(-1)).toBe("stop");
        expect(own.calls.at(-1)).toBe("stop");
    });
});

// --- Batcher-scheduled subscribers (Signal.effect) ---------------------------

describe("Statechart and Batcher-scheduled subscribers (Signal.effect)", () => {
    it("send() from an effect reacting to the snapshot is processed in the same synchronous burst", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { on: { GO: "b" } }, b: { on: { NEXT: "c" } }, c: { on: { NEXT: "d" } }, d: {} },
        });
        const engine = new Statechart(definition);
        const seen: string[] = [];
        const effect = Signal.effect(() => {
            const value = String(engine.state().value);
            seen.push(value);
            if (value === "b" || value === "c") engine.send({ type: "NEXT" });
        });
        engine.send({ type: "GO" });
        expect(engine.state().value).toBe("d");
        expect(seen).toEqual(["a", "b", "c", "d"]);
        effect.unsubscribe();
        engine.dispose();
    });

    it("effects reacting to snapshots produced by start() (initial actions sending events) get their events processed too", () => {
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: { a: { entry: "kick", on: { GO: "b" } }, b: { on: { NEXT: "c" } }, c: {} },
            },
            {
                actions: {
                    kick: () => {
                        engine.send({ type: "GO" });
                    },
                },
            },
        );
        const engine = new Statechart(definition, { autoStart: false });
        const seen: string[] = [];
        const effect = Signal.effect(() => {
            const value = String(engine.state().value);
            seen.push(value);
            if (value === "b") engine.send({ type: "NEXT" });
        });
        engine.start();
        expect(engine.state().value).toBe("c");
        expect(seen).toEqual(["a", "b", "c"]);
        effect.unsubscribe();
        engine.dispose();
    });

    it("stop() and dispose() from an effect take effect within the burst", () => {
        const definition = createMachine({ id: "m", initial: "a", states: { a: { on: { GO: "b" } }, b: {} } });
        const stopping = new Statechart(definition);
        const stopEffect = Signal.effect(() => {
            if (stopping.state().value === "b") stopping.stop();
        });
        stopping.send({ type: "GO" });
        expect(stopping.status).toBe("stopped");
        expect(stopping.state()).toMatchObject({ status: "stopped", value: "b" });
        stopEffect.unsubscribe();
        stopping.dispose();

        const disposing = new Statechart(definition);
        let completed = false;
        const subscription = disposing.state.obs.subscribe({ complete: () => (completed = true) });
        const disposeEffect = Signal.effect(() => {
            if (disposing.state().value === "b") disposing.dispose();
        });
        disposing.send({ type: "GO" });
        expect(disposing.status).toBe("disposed");
        expect(completed).toBe(true);
        disposeEffect.unsubscribe();
        subscription.unsubscribe();
    });

    it("start() from an effect reacting to a done snapshot restarts the engine after the burst", () => {
        const trace: string[] = [];
        const definition = createMachine(
            {
                id: "m",
                initial: "a",
                states: { a: { entry: "enterA", on: { FINISH: "end" } }, end: { type: "final" } },
            },
            {
                actions: {
                    enterA: () => {
                        trace.push("enterA");
                    },
                },
            },
        );
        const engine = new Statechart(definition);
        const statuses: string[] = [];
        const effect = Signal.effect(() => {
            const snapshot = engine.state();
            statuses.push(`${snapshot.status}:${engine.status}`);
            if (snapshot.status === "done") engine.start();
        });
        engine.send({ type: "FINISH" });
        expect(engine.status).toBe("running");
        expect(engine.state()).toMatchObject({ status: "active", value: "a" });
        expect(trace).toEqual(["enterA", "enterA"]);
        expect(statuses).toEqual(["active:running", "done:stopped", "active:running"]);
        effect.unsubscribe();
        engine.dispose();
    });

    it("a restart requested inside a failed burst runs after onError, and is dropped when the error is rethrown", () => {
        const boom = new Error("boom");
        const definition = createMachine(
            { id: "m", initial: "a", states: { a: { on: { GO: { actions: "explode" } } } } },
            {
                actions: {
                    explode: () => {
                        throw boom;
                    },
                },
            },
        );
        const unhandled = new Statechart(definition);
        const restartUnhandled = Signal.effect(() => {
            if (unhandled.state().status === "error") unhandled.start();
        });
        expect(() => unhandled.send({ type: "GO" })).toThrow(boom);
        expect(unhandled.status).toBe("stopped");
        expect(unhandled.state().status).toBe("error");
        restartUnhandled.unsubscribe();
        unhandled.dispose();

        const seenByOnError: string[] = [];
        const handled = new Statechart(definition, {
            onError: () => {
                seenByOnError.push(`${handled.state().status}:${handled.status}`);
            },
        });
        const restartHandled = Signal.effect(() => {
            if (handled.state().status === "error") handled.start();
        });
        handled.send({ type: "GO" });
        expect(seenByOnError).toEqual(["error:stopped"]); // onError saw the error state, the restart came after
        expect(handled.status).toBe("running");
        expect(handled.state().status).toBe("active");
        restartHandled.unsubscribe();
        handled.dispose();
    });

    it("dispose() requested inside the burst wins over a restart requested by another effect", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            states: { a: { on: { FINISH: "end" } }, end: { type: "final" } },
        });
        const engine = new Statechart(definition);
        const restart = Signal.effect(() => {
            if (engine.state().status === "done") engine.start();
        });
        const dispose = Signal.effect(() => {
            if (engine.state().status === "done") engine.dispose();
        });
        engine.send({ type: "FINISH" });
        expect(engine.status).toBe("disposed");
        restart.unsubscribe();
        dispose.unsubscribe();
    });
});

// --- misc ------------------------------------------------------------------

describe("Statechart builtins wiring", () => {
    it("routes log() to the logger (value only, or label + value)", () => {
        const logger = vi.fn();
        const definition = createMachine({
            id: "m",
            initial: "a",
            context: { n: 7 },
            states: {
                a: {
                    entry: [log(({ context }) => context.n), log("hello", "greeting")],
                },
            },
        });
        const engine = new Statechart(definition, { logger });
        expect(logger.mock.calls).toEqual([[7], ["greeting", "hello"]]);
        engine.dispose();
    });

    it("snapshot typing narrows on status", () => {
        const definition = createMachine({
            id: "m",
            initial: "a",
            output: () => 42,
            states: { a: { on: { END: "end" } }, end: { type: "final" } },
        });
        const engine = new Statechart(definition);
        engine.send({ type: "END" });
        const snapshot: MachineSnapshot<MachineContext, number> = engine.state();
        if (snapshot.status === "done") {
            expect(snapshot.output).toBe(42);
        } else {
            throw new Error("expected done");
        }
        engine.dispose();
    });
});
