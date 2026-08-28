/**
 * Differential harness: runs one scenario through xstate (`createActor`) and
 * through our `Statechart`, recording the same trace shape from both, and
 * compares the traces. XState v5 is the ground truth (brief: "Differential
 * tests against createActor decide any dispute").
 *
 * Trace = one entry after `start()` plus one entry after every step. Each entry
 * holds the snapshot (`status`, `value`, `context`, `output`, `error` message),
 * the custom actions executed since the previous entry (in call order) and the
 * optional `matches()` / `can()` probes.
 *
 * Timers: both libraries use `globalThis.setTimeout` resolved at call time, so
 * `{ advance: ms }` steps drive `vi.advanceTimersByTime` under fake timers
 * installed by `runScenario`.
 *
 * Documented deviations normalized here (spec section 11):
 * - 11.14: on `status === "error"` `value` and `context` are blanked (XState's
 *   init-time builtin error snapshot has neither, ours keeps the pre-initial ones).
 * - 11.13: `can()` on a non-active snapshot is reported as `null` (XState still
 *   evaluates transitions of a done/stopped snapshot; ours answers `false`).
 */
import {
    createActor,
    createMachine as createXStateMachine,
    and as xAnd,
    assign as xAssign,
    cancel as xCancel,
    log as xLog,
    not as xNot,
    or as xOr,
    raise as xRaise,
    stateIn as xStateIn,
} from "xstate";

import { and, assign, cancel, createMachine, log, not, or, raise, Statechart, stateIn } from "@/statechart";
import type { StateValue } from "@/statechart";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ScenarioEvent = { type: string; [key: string]: unknown };

export type ScenarioStep = ScenarioEvent | { advance: number } | { stop: true } | { start: true };

export interface RecordArgs {
    context: any;
    event: any;
}

/** What a scenario sees while building its config / implementations for one library. */
export interface ScenarioLib {
    readonly name: "xstate" | "rx-toolkit";
    readonly assign: any;
    readonly raise: any;
    readonly cancel: any;
    readonly log: any;
    readonly and: any;
    readonly or: any;
    readonly not: any;
    readonly stateIn: any;
    /**
     * An action implementation that appends `name` to the action trace when
     * executed. With `detail`, the entry becomes `name(<JSON of detail(args, params)>)`
     * so scenarios can assert the event / context / params an action observed.
     */
    record(name: string, detail?: (args: RecordArgs, params: unknown) => unknown): (args: any, params?: any) => void;
    /** Sends an event to the running instance (for re-entrant sends from inside actions). */
    send(event: ScenarioEvent): void;
}

/** `object` (not `any`) keeps the builder form contextually typed. */
export type ScenarioConfig = object | ((lib: ScenarioLib) => object);

export interface Scenario {
    readonly name: string;
    /** Plain config or a builder (required when the config uses builtins / inline functions). */
    readonly config: ScenarioConfig;
    readonly implementations?: (lib: ScenarioLib) => any;
    readonly events: readonly ScenarioStep[];
    /** Evaluated after `start()` and after every step. */
    readonly probes?: {
        readonly matches?: readonly StateValue[];
        readonly can?: readonly ScenarioEvent[];
    };
}

export interface TraceSnapshot {
    status: string;
    value: unknown;
    context: unknown;
    output: unknown;
    error: string | undefined;
    /** Sorted: xstate builds its `Set` in configuration order, ours in document order. */
    tags: string[];
}

export interface TraceEntry extends TraceSnapshot {
    step: string;
    actions: string[];
    probes?: {
        matches: Record<string, boolean>;
        can: Record<string, boolean | null>;
    };
}

interface Runner {
    start(): void;
    send(event: ScenarioEvent): void;
    stop(): void;
    dispose(): void;
    snapshot(): TraceSnapshot;
    matches(value: StateValue): boolean;
    can(event: ScenarioEvent): boolean;
}

export interface Library {
    readonly name: ScenarioLib["name"];
    readonly builtins: Omit<ScenarioLib, "name" | "record" | "send">;
    createRunner(config: any, implementations: any): Runner;
}

function errorMessage(error: unknown): string | undefined {
    if (error === undefined) return undefined;
    return error instanceof Error ? error.message : String(error);
}

function normalizeSnapshot(s: {
    status: string;
    value: unknown;
    context: unknown;
    output: unknown;
    error: unknown;
    tags: Iterable<string> | undefined;
}): TraceSnapshot {
    const isError = s.status === "error";
    return {
        status: s.status,
        value: isError ? undefined : s.value,
        context: isError ? undefined : s.context,
        output: s.output,
        error: errorMessage(s.error),
        tags: isError ? [] : [...(s.tags ?? [])].sort(),
    };
}

const xstateLibrary: Library = {
    name: "xstate",
    builtins: {
        assign: xAssign,
        raise: xRaise,
        cancel: xCancel,
        log: xLog,
        and: xAnd,
        or: xOr,
        not: xNot,
        stateIn: xStateIn,
    },
    createRunner(config, implementations) {
        const machine = createXStateMachine(config, implementations);
        const actor = createActor(machine, { logger: () => undefined });
        // An error observer keeps xstate from `setTimeout(() => { throw err })`.
        actor.subscribe({ error: () => undefined });
        return {
            start: () => actor.start(),
            send: (event) => actor.send(event as any),
            stop: () => actor.stop(),
            dispose: () => actor.stop(),
            snapshot: () => normalizeSnapshot(actor.getSnapshot()),
            matches: (value) => actor.getSnapshot().matches(value as any),
            can: (event) => actor.getSnapshot().can(event as any),
        };
    },
};

const rxToolkitLibrary: Library = {
    name: "rx-toolkit",
    builtins: { assign, raise, cancel, log, and, or, not, stateIn },
    createRunner(config, implementations) {
        const definition = createMachine(config, implementations);
        const engine = new Statechart(definition, {
            autoStart: false,
            isDisabled: true,
            inspector: null,
            logger: () => undefined,
            onError: () => undefined,
        });
        return {
            start: () => engine.start(),
            send: (event) => engine.send(event as any),
            stop: () => engine.stop(),
            dispose: () => engine.dispose(),
            snapshot: () => normalizeSnapshot(engine.getSnapshot()),
            matches: (value) => engine.matches(value),
            can: (event) => engine.can(event as any),
        };
    },
};

export const libraries = { xstate: xstateLibrary, rxToolkit: rxToolkitLibrary } as const;

type ClassifiedStep =
    | { kind: "send"; event: ScenarioEvent }
    | { kind: "advance"; ms: number }
    | { kind: "stop" }
    | { kind: "start" };

/** An event is anything with a string `type`; the other step shapes are control steps. */
function classifyStep(step: ScenarioStep): ClassifiedStep {
    if ("type" in step && typeof step.type === "string") return { kind: "send", event: step };
    if ("advance" in step && typeof step.advance === "number") return { kind: "advance", ms: step.advance };
    if ("stop" in step) return { kind: "stop" };
    if ("start" in step) return { kind: "start" };
    throw new Error(`Unknown scenario step: ${JSON.stringify(step)}`);
}

function describeStep(step: ClassifiedStep): string {
    switch (step.kind) {
        case "send":
            return `send ${JSON.stringify(step.event)}`;
        case "advance":
            return `advance ${step.ms}`;
        default:
            return step.kind;
    }
}

function probeKey(value: unknown): string {
    return JSON.stringify(value);
}

/** Runs `scenario` through `library` under fake timers and returns its trace. */
export function runScenario(library: Library, scenario: Scenario): TraceEntry[] {
    const actions: string[] = [];
    let runner: Runner | undefined;
    const lib: ScenarioLib = {
        name: library.name,
        ...library.builtins,
        record: (name, detail) => (args, params) => {
            actions.push(detail ? `${name}(${JSON.stringify(detail(args, params))})` : name);
        },
        send: (event) => {
            if (!runner) throw new Error("lib.send() is only available while the scenario runs");
            runner.send(event);
        },
    };
    const config = typeof scenario.config === "function" ? scenario.config(lib) : scenario.config;
    const implementations = scenario.implementations?.(lib);

    vi.useFakeTimers();
    // xstate warns (console.warn) when an event reaches a stopped actor; scenarios do that on purpose.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const trace: TraceEntry[] = [];
    try {
        runner = library.createRunner(config, implementations);
        const capture = (step: string) => {
            const entry: TraceEntry = { step, ...runner!.snapshot(), actions: actions.splice(0) };
            if (scenario.probes) {
                const active = entry.status === "active";
                entry.probes = {
                    matches: Object.fromEntries(
                        (scenario.probes.matches ?? []).map((v) => [probeKey(v), runner!.matches(v)]),
                    ),
                    can: Object.fromEntries(
                        (scenario.probes.can ?? []).map((e) => [probeKey(e), active ? runner!.can(e) : null]),
                    ),
                };
            }
            trace.push(entry);
        };

        runner.start();
        capture("start");
        for (const rawStep of scenario.events) {
            const step = classifyStep(rawStep);
            switch (step.kind) {
                case "send":
                    runner.send(step.event);
                    break;
                case "advance":
                    vi.advanceTimersByTime(step.ms);
                    break;
                case "stop":
                    runner.stop();
                    break;
                case "start":
                    runner.start();
                    break;
            }
            capture(describeStep(step));
        }
    } finally {
        runner?.dispose();
        warn.mockRestore();
        vi.useRealTimers();
    }
    return trace;
}

/** Asserts that our runtime produces exactly the trace xstate produces for `scenario`. */
export function expectSameTrace(scenario: Scenario): void {
    const expected = runScenario(xstateLibrary, scenario);
    const actual = runScenario(rxToolkitLibrary, scenario);
    expect(actual).toEqual(expected);
}

/** `describe` block with one `it` per scenario. */
export function describeScenarios(title: string, scenarios: readonly Scenario[]): void {
    describe(title, () => {
        it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))("%s", (_name, scenario) => {
            expectSameTrace(scenario);
        });
    });
}
