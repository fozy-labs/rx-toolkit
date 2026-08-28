import { Signal } from "@fozy-labs/rx-toolkit";
import type { StateNodeJson, TransitionJson, TransitionListJson } from "@fozy-labs/statechart-converter";

import type { StateValue, VizEvent, VizMachine, VizSnapshot } from "../types";

import type { FixtureEvent, VizFixture } from "./fixtures/types";

/** Timer source of the fake; tests pass a manual clock. */
export type FakeClock = {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
};

export type FakeVizMachineStatus = "idle" | "running" | "stopped" | "disposed";

/** The test double: a `VizMachine` plus the lifecycle of the real signal. */
export interface FakeVizMachine<TContext = unknown> extends VizMachine<TContext, VizEvent> {
    readonly status: FakeVizMachineStatus;
    /** Enters the initial configuration; no-op while running. */
    start(): void;
    /** Cancels timers, snapshot status becomes `"stopped"`. */
    stop(): void;
    /** `stop()` and completes the snapshot signal. */
    dispose(): void;
}

export type FakeVizMachineOptions = {
    clock?: FakeClock;
    /** Default `true`. */
    autoStart?: boolean;
};

type Path = readonly string[];

type Candidate = { target?: string; guard?: string; actions: string[] };

type Selected = { source: Path; candidate: Candidate };

/** A subtree that a selected transition will exit: at/below `path` or strictly below it. */
type ExitMark = { path: Path; inclusive: boolean };

const MAX_SETTLE_ITERATIONS = 100;

const defaultClock: FakeClock = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function pathKey(path: Path): string {
    return path.join(".");
}

function isPrefix(prefix: Path, path: Path): boolean {
    return prefix.length <= path.length && prefix.every((key, i) => key === path[i]);
}

function commonPrefix(a: Path, b: Path): Path {
    const out: string[] = [];
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) {
        out.push(a[i]);
    }
    return out;
}

function normalizeTransitions(list: TransitionListJson | undefined): Candidate[] {
    if (list === undefined) return [];
    const items: TransitionJson[] = Array.isArray(list) ? list : [list];
    return items.map((item) =>
        typeof item === "string"
            ? { target: item, actions: [] }
            : { target: item.target, guard: item.guard, actions: item.actions ?? [] },
    );
}

function matchesValue(actual: StateValue, partial: StateValue): boolean {
    if (typeof partial === "string") {
        return typeof actual === "string" ? actual === partial : partial in actual;
    }
    if (typeof actual === "string") return false;
    return Object.keys(partial).every((key) => {
        const actualChild = actual[key];
        const partialChild = partial[key];
        return actualChild !== undefined && partialChild !== undefined && matchesValue(actualChild, partialChild);
    });
}

/**
 * A deliberately small interpreter over the JSON config: compound and
 * parallel states, `$final` + `onDone`, `always`, numeric `after` delays,
 * guards and actions from the fixture tables. Named delays, history and
 * entry/exit actions are outside its scope.
 */
class FakeInterpreter<TContext> {
    readonly snapshot$;
    status: FakeVizMachineStatus = "idle";

    /** Active configuration as dotted path keys, in entry order. */
    private readonly active = new Set<string>();
    private readonly timers = new Map<string, unknown[]>();
    private context: TContext;
    private done = false;

    constructor(
        private readonly fixture: VizFixture<TContext>,
        private readonly clock: FakeClock,
    ) {
        this.context = fixture.context;
        this.snapshot$ = Signal.state<VizSnapshot<TContext>>({
            status: "stopped",
            value: fixture.config.initial,
            context: fixture.context,
        });
    }

    // === lifecycle ===

    start(): void {
        if (this.status === "running" || this.status === "disposed") return;
        this.active.clear();
        this.done = false;
        this.context = this.fixture.context;
        this.status = "running";
        this.enterPath([this.fixture.config.initial], 0);
        this.settle();
        this.publish();
    }

    stop(): void {
        if (this.status === "disposed" || this.status === "stopped") return;
        this.cancelAllTimers();
        this.status = "stopped";
        this.snapshot$.set({ ...this.snapshot$.peek(), status: "stopped" });
    }

    dispose(): void {
        if (this.status === "disposed") return;
        this.stop();
        this.status = "disposed";
        this.snapshot$.dispose();
    }

    // === protocol ===

    send(event: VizEvent): void {
        if (this.status !== "running") return;
        const fixtureEvent = event as FixtureEvent;
        const selected = this.select(fixtureEvent);
        if (selected.length === 0) return;
        for (const transition of selected) {
            this.execute(transition, fixtureEvent);
        }
        this.settle();
        this.publish();
    }

    can(event: VizEvent): boolean {
        return this.status === "running" && this.select(event as FixtureEvent).length > 0;
    }

    matches(value: StateValue): boolean {
        return matchesValue(this.snapshot$.peek().value, value);
    }

    // === config lookup ===

    private node(path: Path): StateNodeJson | undefined {
        let states: Record<string, StateNodeJson> | undefined = this.fixture.config.states;
        let node: StateNodeJson | undefined;
        for (const key of path) {
            node = states?.[key];
            if (!node) return undefined;
            states = node.states;
        }
        return node;
    }

    private requireNode(path: Path): StateNodeJson {
        const node = this.node(path);
        if (!node) throw new Error(`FakeVizMachine: unknown state "${pathKey(path)}"`);
        return node;
    }

    private childKeys(path: Path): string[] {
        const states = path.length === 0 ? this.fixture.config.states : this.node(path)?.states;
        return states ? Object.keys(states) : [];
    }

    private resolveTarget(source: Path, target: string): Path {
        let path: Path;
        if (target.startsWith("#")) {
            const prefix = `#${this.fixture.config.id}.`;
            if (!target.startsWith(prefix)) {
                throw new Error(
                    `FakeVizMachine: target "${target}" does not address machine "${this.fixture.config.id}"`,
                );
            }
            path = target.slice(prefix.length).split(".");
        } else {
            path = [...source.slice(0, -1), target];
        }
        this.requireNode(path);
        return path;
    }

    // === configuration queries ===

    private activePaths(): Path[] {
        return [...this.active].map((key) => key.split("."));
    }

    private isActive(path: Path): boolean {
        return this.active.has(pathKey(path));
    }

    private hasActiveChild(path: Path): boolean {
        const prefix = path.length === 0 ? "" : `${pathKey(path)}.`;
        for (const key of this.active) {
            if (key.startsWith(prefix)) return true;
        }
        return false;
    }

    private leaves(): Path[] {
        return this.activePaths().filter((path) => !this.hasActiveChild(path));
    }

    private valueOf(prefix: Path): StateValue {
        const node = prefix.length === 0 ? undefined : this.node(prefix);
        const keys = this.childKeys(prefix).filter((key) => this.isActive([...prefix, key]));
        if (node?.type === "parallel") {
            const regions: Record<string, StateValue> = {};
            for (const key of keys) {
                regions[key] = this.valueOf([...prefix, key]);
            }
            return regions;
        }
        const key = keys[0];
        if (key === undefined) {
            throw new Error(`FakeVizMachine: no active child under "${pathKey(prefix) || "<root>"}"`);
        }
        const child = [...prefix, key];
        return this.hasActiveChild(child) ? { [key]: this.valueOf(child) } : key;
    }

    private publish(): void {
        this.snapshot$.set({
            status: this.done ? "done" : "active",
            value: this.valueOf([]),
            context: this.context,
        });
    }

    // === guards and actions ===

    private guardPasses(guard: string | undefined, event: FixtureEvent): boolean {
        if (guard === undefined) return true;
        const fn = this.fixture.guards?.[guard];
        return fn ? fn({ context: this.context, event }) : false;
    }

    private pick(candidates: Candidate[], event: FixtureEvent): Candidate | undefined {
        return candidates.find((candidate) => this.guardPasses(candidate.guard, event));
    }

    private runActions(names: string[], event: FixtureEvent): void {
        for (const name of names) {
            const fn = this.fixture.actions?.[name];
            if (!fn) continue;
            const next = fn({ context: this.context, event });
            if (next !== undefined) this.context = next;
        }
    }

    // === selection ===

    private exitMark(source: Path, candidate: Candidate): ExitMark | null {
        if (candidate.target === undefined) return null;
        const target = this.resolveTarget(source, candidate.target);
        if (isPrefix(source, target)) return { path: source, inclusive: false };
        const domain = commonPrefix(source, target);
        if (domain.length === target.length) return { path: target, inclusive: true };
        return { path: source.slice(0, domain.length + 1), inclusive: true };
    }

    private select(event: FixtureEvent): Selected[] {
        const selected: Selected[] = [];
        const consumed = new Set<string>();
        const exits: ExitMark[] = [];
        const isExited = (path: Path) =>
            exits.some((mark) => isPrefix(mark.path, path) && (mark.inclusive || path.length > mark.path.length));

        for (const leaf of this.leaves()) {
            for (let depth = leaf.length; depth >= 1; depth--) {
                const statePath = leaf.slice(0, depth);
                if (isExited(statePath)) break;
                if (consumed.has(pathKey(statePath))) break;
                const candidate = this.pick(normalizeTransitions(this.node(statePath)?.on?.[event.type]), event);
                if (!candidate) continue;
                selected.push({ source: statePath, candidate });
                consumed.add(pathKey(statePath));
                const mark = this.exitMark(statePath, candidate);
                if (mark) exits.push(mark);
                break;
            }
        }
        return selected;
    }

    // === execution ===

    private execute({ source, candidate }: Selected, event: FixtureEvent): void {
        if (candidate.target === undefined) {
            this.runActions(candidate.actions, event);
            return;
        }
        const target = this.resolveTarget(source, candidate.target);

        if (isPrefix(source, target)) {
            // Internal: the source stays, its active descendants are replaced.
            this.exitSubtree(source, false);
            this.runActions(candidate.actions, event);
            if (target.length === source.length) {
                this.enterDescendants(source);
            } else {
                this.enterPath(target, source.length);
            }
            return;
        }

        const domain = commonPrefix(source, target);
        if (domain.length === target.length) {
            // The target is an ancestor: external transition, re-enter its subtree.
            this.exitSubtree(target, true);
            this.runActions(candidate.actions, event);
            this.enterPath(target, target.length - 1);
            return;
        }

        this.exitSubtree(source.slice(0, domain.length + 1), true);
        this.runActions(candidate.actions, event);
        this.enterPath(target, domain.length);
    }

    private exitSubtree(root: Path, inclusive: boolean): void {
        for (const key of [...this.active]) {
            const path = key.split(".");
            if (!isPrefix(root, path)) continue;
            if (!inclusive && path.length === root.length) continue;
            this.cancelTimers(key);
            this.active.delete(key);
        }
    }

    /** Enters every prefix of `target` longer than `from`, then the target's descendants. */
    private enterPath(target: Path, from: number): void {
        for (let length = from + 1; length <= target.length; length++) {
            const prefix = target.slice(0, length);
            this.addState(prefix);
            const node = this.requireNode(prefix);
            if (node.type === "parallel" && length < target.length) {
                for (const key of this.childKeys(prefix)) {
                    if (key !== target[length]) this.enterState([...prefix, key]);
                }
            }
        }
        this.enterDescendants(target);
    }

    private enterState(path: Path): void {
        this.addState(path);
        this.enterDescendants(path);
    }

    private enterDescendants(path: Path): void {
        const node = this.requireNode(path);
        if (node.type === "parallel") {
            for (const key of this.childKeys(path)) {
                this.enterState([...path, key]);
            }
            return;
        }
        if (node.states) {
            if (node.initial === undefined) {
                throw new Error(`FakeVizMachine: compound state "${pathKey(path)}" has no initial`);
            }
            this.enterState([...path, node.initial]);
        }
    }

    private addState(path: Path): void {
        this.requireNode(path);
        this.active.add(pathKey(path));
        this.scheduleAfter(path);
    }

    // === eventless steps ===

    private settle(): void {
        for (let i = 0; i < MAX_SETTLE_ITERATIONS; i++) {
            if (this.checkRootDone()) return;
            if (!this.fireDone() && !this.fireAlways()) return;
        }
    }

    private checkRootDone(): boolean {
        const finalKey = this.childKeys([]).find((key) => this.isActive([key]) && this.node([key])?.type === "final");
        if (finalKey === undefined) return false;
        this.done = true;
        this.cancelAllTimers();
        return true;
    }

    private hasFinalChild(path: Path): boolean {
        return this.childKeys(path).some(
            (key) => this.node([...path, key])?.type === "final" && this.isActive([...path, key]),
        );
    }

    private fireDone(): boolean {
        const paths = this.activePaths().sort((a, b) => b.length - a.length);
        for (const path of paths) {
            const node = this.node(path);
            if (!node?.states) continue;
            const isDone =
                node.type === "parallel"
                    ? this.childKeys(path).every((key) => this.hasFinalChild([...path, key]))
                    : this.hasFinalChild(path);
            if (!isDone) continue;
            const event: FixtureEvent = { type: "done", state: pathKey(path) };
            const candidate = this.pick(normalizeTransitions(node.onDone), event);
            if (!candidate) continue;
            this.execute({ source: path, candidate }, event);
            return true;
        }
        return false;
    }

    private fireAlways(): boolean {
        for (const path of this.activePaths()) {
            const node = this.node(path);
            if (!node?.always) continue;
            const event: FixtureEvent = { type: "always" };
            const candidate = this.pick(normalizeTransitions(node.always), event);
            if (!candidate) continue;
            this.execute({ source: path, candidate }, event);
            return true;
        }
        return false;
    }

    // === timers ===

    private scheduleAfter(path: Path): void {
        const after = this.node(path)?.after;
        if (!after) return;
        const key = pathKey(path);
        for (const delayKey of Object.keys(after)) {
            const ms = Number(delayKey);
            if (!Number.isFinite(ms)) continue;
            const handle: unknown = this.clock.setTimeout(() => {
                const handles = this.timers.get(key);
                if (handles)
                    this.timers.set(
                        key,
                        handles.filter((h) => h !== handle),
                    );
                this.onTimer(path, delayKey, ms);
            }, ms);
            this.timers.set(key, [...(this.timers.get(key) ?? []), handle]);
        }
    }

    private onTimer(path: Path, delayKey: string, ms: number): void {
        if (this.status !== "running" || !this.isActive(path)) return;
        const event: FixtureEvent = { type: "after", delay: ms };
        const candidate = this.pick(normalizeTransitions(this.node(path)?.after?.[delayKey]), event);
        if (!candidate) return;
        this.execute({ source: path, candidate }, event);
        this.settle();
        this.publish();
    }

    private cancelTimers(key: string): void {
        for (const handle of this.timers.get(key) ?? []) {
            this.clock.clearTimeout(handle);
        }
        this.timers.delete(key);
    }

    private cancelAllTimers(): void {
        for (const key of [...this.timers.keys()]) {
            this.cancelTimers(key);
        }
    }
}

/**
 * Creates the signal-based `VizMachine` test double over a fixture. The
 * snapshot lives in one `Signal.state`; `machine()` is a tracked read of it.
 */
export function createFakeVizMachine<TContext>(
    fixture: VizFixture<TContext>,
    options: FakeVizMachineOptions = {},
): FakeVizMachine<TContext> {
    const interpreter = new FakeInterpreter(fixture, options.clock ?? defaultClock);
    const machine = (() => interpreter.snapshot$()) as FakeVizMachine<TContext>;

    const definition: FakeVizMachine<TContext>["definition"] = {
        id: fixture.config.id,
        source: fixture.source,
        config: fixture.config,
        toMermaid: () => fixture.source,
    };

    Object.defineProperties(machine, {
        status: { get: () => interpreter.status, enumerable: true },
        obs: { value: interpreter.snapshot$.obs, enumerable: true },
        definition: { value: definition, enumerable: true },
        send: { value: (event: VizEvent) => interpreter.send(event) },
        can: { value: (event: VizEvent) => interpreter.can(event) },
        matches: { value: (value: StateValue) => interpreter.matches(value) },
        start: { value: () => interpreter.start() },
        stop: { value: () => interpreter.stop() },
        dispose: { value: () => interpreter.dispose() },
    });

    if (options.autoStart ?? true) interpreter.start();
    return machine;
}
