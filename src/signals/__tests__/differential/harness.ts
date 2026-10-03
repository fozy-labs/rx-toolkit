// Differential harness: builds the same seeded random graph of state / computed /
// effect on rx-toolkit and on @preact/signals-core (the reference), drives both
// with the same writes and compares what every observer saw.
import * as preact from "@preact/signals-core";

import { Batcher, Signal } from "@/index";

// ---------------------------------------------------------------------------
// Engine adapters
// ---------------------------------------------------------------------------

interface NodeHandle {
    /** Tracked read. */
    read(): number;
    peek(): number;
}

interface StateHandle extends NodeHandle {
    set(value: number): void;
}

interface Engine {
    readonly name: string;
    state(value: number): StateHandle;
    computed(fn: () => number): NodeHandle;
    effect(fn: () => void): () => void;
    batch(fn: () => void): void;
    /**
     * Pushes every value of a computed to `cb`: `.obs` for rx-toolkit, an
     * effect over the computed for preact (the reference `.obs` semantics:
     * the current value on subscribe, then one value per settled change).
     */
    observe(node: NodeHandle, cb: (value: number) => void): () => void;
}

const OBS = Symbol("obs");

export const rxToolkit: Engine = {
    name: "rx-toolkit",
    state(value) {
        const s = Signal.state(value);
        return { read: () => s(), peek: () => s.peek(), set: (v) => s.set(v) };
    },
    computed(fn) {
        const c = Signal.compute(fn);
        return Object.assign({ read: () => c(), peek: () => c.peek() }, { [OBS]: c.obs });
    },
    effect(fn) {
        const e = Signal.effect(fn);
        return () => e.unsubscribe();
    },
    batch(fn) {
        Batcher.run(fn);
    },
    observe(node, cb) {
        const obs = (node as unknown as { [OBS]: { subscribe(cb: (v: number) => void): { unsubscribe(): void } } })[
            OBS
        ];
        const sub = obs.subscribe(cb);
        return () => sub.unsubscribe();
    },
};

export const preactReference: Engine = {
    name: "preact",
    state(value) {
        const s = preact.signal(value);
        return {
            read: () => s.value,
            peek: () => s.peek(),
            set: (v) => {
                s.value = v;
            },
        };
    },
    computed(fn) {
        const c = preact.computed(fn);
        return { read: () => c.value, peek: () => c.peek() };
    },
    effect(fn) {
        return preact.effect(fn);
    },
    batch(fn) {
        preact.batch(fn);
    },
    observe(node, cb) {
        return preact.effect(() => cb(node.read()));
    },
};

// ---------------------------------------------------------------------------
// Graph spec (engine-agnostic, generated from a seed)
// ---------------------------------------------------------------------------

/** Node indices: states first, then computeds in creation order (a computed reads only earlier nodes). */
type ComputedSpec =
    | { kind: "lin"; a: number; b: number; k: number }
    | { kind: "cond"; sel: number; then: number; else: number }
    | { kind: "gate"; sel: number; deep: number; other: number };

type EffectSpec = { kind: "list"; reads: number[] } | { kind: "cond"; sel: number; then: number[]; else: number[] };

interface StepSpec {
    writes: [state: number, value: number][];
    batched: boolean;
    /** Computeds peeked inside the batch, after the writes. */
    batchReads: number[];
}

export interface GraphSpec {
    states: number[];
    computeds: ComputedSpec[];
    effects: EffectSpec[];
    /** Computeds whose `.obs` is subscribed. */
    observed: number[];
    steps: StepSpec[];
}

export interface GenOptions {
    /** Conditional dependencies in computeds and effects. */
    dynamic: boolean;
    /** Subscribe `.obs` of some computeds. */
    obs: boolean;
    /** Peek computeds inside batches, after the writes. */
    batchReads: boolean;
}

function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function generate(seed: number, opts: GenOptions): GraphSpec {
    const rnd = mulberry32(seed);
    const int = (n: number) => Math.floor(rnd() * n);
    const pick = <T>(xs: T[]) => xs[int(xs.length)];
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);

    const nStates = 2 + int(4);
    const nComputeds = 3 + int(10);
    const states = range(nStates).map(() => int(10));
    const computeds: ComputedSpec[] = [];
    for (let i = 0; i < nComputeds; i++) {
        const before = range(nStates + i);
        const r = rnd();
        if (!opts.dynamic || r < 0.4) {
            computeds.push({ kind: "lin", a: pick(before), b: pick(before), k: 1 + int(3) });
        } else if (r < 0.75) {
            computeds.push({ kind: "cond", sel: pick(before), then: pick(before), else: pick(before) });
        } else {
            // Deep branch: prefer the latest (deepest) node, so a newly read node is often hot and deep.
            computeds.push({ kind: "gate", sel: pick(before), deep: before[before.length - 1], other: pick(before) });
        }
    }
    const all = range(nStates + nComputeds);
    const someNodes = () => range(1 + int(3)).map(() => pick(all));
    const effects: EffectSpec[] = range(1 + int(4)).map(() =>
        opts.dynamic && rnd() < 0.5
            ? { kind: "cond", sel: pick(all), then: someNodes(), else: someNodes() }
            : { kind: "list", reads: someNodes() },
    );
    const computedIdx = range(nComputeds);
    const observed = opts.obs ? computedIdx.filter(() => rnd() < 0.4) : [];
    // Current state values, to keep batches free of A -> B -> A writes: preact
    // 1.14 reconciles such a batch as "no change" and skips the effects, the
    // proposal does not require that, so the case is left out of the comparison.
    const current = [...states];
    const steps: StepSpec[] = range(12).map(() => {
        const batched = rnd() < 0.6;
        const writes = range(batched ? 1 + int(3) : 1).map((): [number, number] => [int(nStates), int(10)]);
        const before = [...current];
        const written = new Set<number>();
        for (let w = writes.length - 1; w >= 0; w--) {
            const [s, v] = writes[w];
            // The last write of a state written more than once must leave it changed.
            if (!written.has(s) && writes.some(([o], j) => j !== w && o === s) && v === before[s]) {
                writes[w] = [s, (v + 1) % 10];
            }
            written.add(s);
        }
        for (const [s, v] of writes) current[s] = v;
        const batchReads = batched && opts.batchReads ? range(1 + int(3)).map(() => pick(computedIdx)) : [];
        return { writes, batched, batchReads };
    });
    return { states, computeds, effects, observed, steps };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** What the observers saw: one sequence per observer key, in the order it saw it. */
export type Trace = Record<string, unknown[]>;

export function run(engine: Engine, spec: GraphSpec): Trace {
    const trace: Trace = {};
    const log = (key: string, value: unknown) => (trace[key] ??= []).push(value);
    const nodes: NodeHandle[] = [];
    const states = spec.states.map((v) => engine.state(v));
    nodes.push(...states);
    for (const c of spec.computeds) {
        const n = nodes;
        let fn: () => number;
        if (c.kind === "lin") fn = () => (n[c.a].read() + c.k * n[c.b].read()) % 10;
        else if (c.kind === "cond") fn = () => (n[c.sel].read() % 2 ? n[c.then].read() : (n[c.else].read() + 1) % 10);
        else fn = () => (n[c.sel].read() > 4 ? n[c.deep].read() : n[c.other].read());
        nodes.push(engine.computed(fn));
    }

    const stops: (() => void)[] = [];
    spec.observed.forEach((ci) => {
        stops.push(engine.observe(nodes[spec.states.length + ci], (v) => log(`obs c${ci}`, v)));
    });
    spec.effects.forEach((e, ei) => {
        stops.push(
            engine.effect(() => {
                const reads = e.kind === "list" ? e.reads : nodes[e.sel].read() % 2 ? e.then : e.else;
                log(`effect ${ei}`, reads.map((r) => `n${r}=${nodes[r].read()}`).join(" "));
            }),
        );
    });

    spec.steps.forEach((step, si) => {
        const write = () => {
            for (const [s, v] of step.writes) states[s].set(v);
            for (const ci of step.batchReads) {
                log(`batch read (step ${si})`, `c${ci}=${nodes[spec.states.length + ci].peek()}`);
            }
        };
        if (step.batched) engine.batch(write);
        else write();
    });

    log("hot values", nodes.map((n, i) => `n${i}=${n.peek()}`).join(" "));
    stops.forEach((stop) => stop());
    log("cold values", nodes.map((n, i) => `n${i}=${n.peek()}`).join(" "));
    return trace;
}

function describeSpec(spec: GraphSpec): string {
    const ns = spec.states.length;
    const name = (i: number) => (i < ns ? `s${i}` : `c${i - ns}`);
    const lines = spec.states.map((v, i) => `s${i} (n${i}) = state(${v})`);
    spec.computeds.forEach((c, i) => {
        const body =
            c.kind === "lin"
                ? `(${name(c.a)} + ${c.k}*${name(c.b)}) % 10`
                : c.kind === "cond"
                  ? `${name(c.sel)} % 2 ? ${name(c.then)} : (${name(c.else)} + 1) % 10`
                  : `${name(c.sel)} > 4 ? ${name(c.deep)} : ${name(c.other)}`;
        lines.push(`c${i} (n${ns + i}) = computed(${body})`);
    });
    spec.effects.forEach((e, i) => {
        const body =
            e.kind === "list"
                ? e.reads.map(name).join(", ")
                : `${name(e.sel)} % 2 ? [${e.then.map(name).join(", ")}] : [${e.else.map(name).join(", ")}]`;
        lines.push(`effect ${i}: reads ${body}`);
    });
    if (spec.observed.length) lines.push(`.obs subscribed: ${spec.observed.map((c) => `c${c}`).join(", ")}`);
    spec.steps.forEach((s, i) => {
        const writes = s.writes.map(([st, v]) => `s${st}=${v}`).join(", ");
        const reads = s.batchReads.length ? `; peek ${s.batchReads.map((c) => `c${c}`).join(", ")}` : "";
        lines.push(`step ${i}: ${s.batched ? `batch(${writes}${reads})` : writes}`);
    });
    return lines.join("\n");
}

/** First divergence between the reference and the tested trace, or null. */
function diff(expected: Trace, actual: Trace): string | null {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
        const e = expected[key] ?? [];
        const a = actual[key] ?? [];
        const len = Math.max(e.length, a.length);
        for (let i = 0; i < len; i++) {
            if (!Object.is(e[i], a[i])) {
                return (
                    `${key} diverges at entry ${i}:\n` +
                    `  preact:     ${JSON.stringify(e)}\n` +
                    `  rx-toolkit: ${JSON.stringify(a)}`
                );
            }
        }
    }
    return null;
}

/**
 * Runs `count` seeds from `firstSeed`; throws on the first seed where
 * rx-toolkit diverges from preact, with the seed, the diff and the graph.
 */
export function expectSameAsPreact(opts: GenOptions, firstSeed: number, count: number) {
    for (let seed = firstSeed; seed < firstSeed + count; seed++) {
        const spec = generate(seed, opts);
        const expected = run(preactReference, spec);
        let actual: Trace;
        try {
            actual = run(rxToolkit, spec);
        } catch (error) {
            throw new Error(`seed ${seed}: rx-toolkit threw ${String(error)}\n\n${describeSpec(spec)}`, {
                cause: error,
            });
        }
        const d = diff(expected, actual);
        if (d) throw new Error(`seed ${seed} (${JSON.stringify(opts)}): ${d}\n\n${describeSpec(spec)}`);
    }
}
