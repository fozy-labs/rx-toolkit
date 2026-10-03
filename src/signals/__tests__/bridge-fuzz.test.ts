/**
 * Random graphs of states, computeds and bridges (`Signal.from` over RxJS
 * chains from other nodes' `.obs`), ported from the delivery-gate fuzzers
 * (.tmp/bridge-design/a-proto/fuzz.ts, a-attack/fuzz3.ts in the main
 * checkout). No reference engine: every observation of a wave is compared
 * with the value the node settles on after the wave.
 *
 * - Effects must only ever see settled values, in every graph class.
 * - Raw `.obs` must emit at most once per wave, the settled value, in the
 *   classes where no residual applies: no `share()` at all, or hot joins to a
 *   running `share()` only from nodes that depend on no receiver.
 */
import {
    combineLatest,
    config,
    distinctUntilChanged,
    filter,
    map,
    mergeMap,
    share,
    startWith,
    switchMap,
    take,
    withLatestFrom,
    type Observable,
} from "rxjs";

import { Batcher, Signal, type ReadonlySignal, type StateSignal } from "@/index";

type Kind =
    | "state"
    | "comp"
    | "cond"
    | "map"
    | "filter"
    | "comb"
    | "switch"
    | "switchD"
    | "wlf"
    | "startD"
    | "merge1"
    | "take"
    | "hot";

type GraphClass = "no-share" | "hot-join-root" | "hot-join-any";

const BASE_KINDS: Kind[] = [
    "state",
    "comp",
    "comp",
    "cond",
    "map",
    "filter",
    "comb",
    "switch",
    "switchD",
    "switchD",
    "wlf",
    "startD",
    "merge1",
    "take",
];

function rng(seed: number) {
    let s = seed >>> 0 || 1;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

type Report = { waves: number; obsGlitches: string[]; effectGlitches: string[]; errors: string[] };

function runGraph(seed: number, graphClass: GraphClass, waves: number, batched: boolean): Report {
    const r = rng(seed);
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
    const nodes: ReadonlySignal<number>[] = [];
    const states: StateSignal<number>[] = [];
    const kinds: Kind[] = [];
    // Whether a node depends on a receiver (a Signal.from) through current links.
    const hasReceiver: boolean[] = [];
    const holds: { unsubscribe(): void }[] = [];
    const kindsHere = graphClass === "no-share" ? BASE_KINDS : [...BASE_KINDS, "hot" as const, "hot" as const];

    const n = 8 + Math.floor(r() * 14);
    for (let i = 0; i < n; i++) {
        let kind: Kind = i < 3 ? "state" : pick(kindsHere);
        const p = nodes.length ? pick(nodes) : null;
        const q = nodes.length ? pick(nodes) : null;
        const k = nodes.length ? pick(nodes) : null;
        const idx = (x: ReadonlySignal<number> | null) => nodes.indexOf(x!);
        if (kind === "hot" && graphClass === "hot-join-root" && hasReceiver[idx(p)]) kind = "map";
        const from = (source: Observable<number>) => Signal.from(source, { default: -1 });
        let s: ReadonlySignal<number>;
        let receiver = true;
        switch (kind) {
            case "state": {
                const st = Signal.state(Math.floor(r() * 5));
                states.push(st);
                s = st;
                receiver = false;
                break;
            }
            case "comp":
                s = Signal.compute(() => p!() + 2 * q!() - k!());
                receiver = hasReceiver[idx(p)] || hasReceiver[idx(q)] || hasReceiver[idx(k)];
                break;
            case "cond":
                s = Signal.compute(() => (k!() % 2 ? p!() : q!() + 1));
                receiver = hasReceiver[idx(p)] || hasReceiver[idx(q)] || hasReceiver[idx(k)];
                break;
            case "map":
                s = from(p!.obs.pipe(map((v) => v + 1)));
                break;
            case "filter":
                s = from(p!.obs.pipe(filter((v) => v % 3 !== 0)));
                break;
            case "comb":
                s = from(combineLatest([p!.obs, q!.obs]).pipe(map(([u, w]) => u - w)));
                break;
            case "switch":
                s = from(p!.obs.pipe(switchMap((v) => (v % 2 ? q!.obs : k!.obs))));
                break;
            case "switchD":
                s = from(
                    p!.obs.pipe(
                        switchMap((v) => (v % 2 ? q!.obs : k!.obs)),
                        distinctUntilChanged(),
                    ),
                );
                break;
            case "wlf":
                s = from(
                    p!.obs.pipe(
                        withLatestFrom(q!.obs),
                        map(([u, w]) => u * 3 + w),
                    ),
                );
                break;
            case "startD":
                s = from(
                    p!.obs.pipe(
                        startWith(0),
                        distinctUntilChanged(),
                        map((v) => v * 2),
                    ),
                );
                break;
            case "merge1":
                s = from(p!.obs.pipe(mergeMap(() => q!.obs.pipe(take(1)))));
                break;
            case "take":
                s = from(p!.obs.pipe(take(3)));
                break;
            case "hot": {
                // Hot join: the chain already runs, the receiver joins without replay.
                const shared = p!.obs.pipe(
                    map((v) => v * 10),
                    share(),
                );
                holds.push(shared.subscribe());
                s = from(shared);
                break;
            }
        }
        kinds.push(kind);
        hasReceiver.push(receiver);
        nodes.push(s);
    }

    let wave = 0;
    const obsLog: { i: number; w: number; v: number }[] = [];
    const effectLog: { i: number; w: number; v: number }[] = [];
    const observed = new Set<number>();
    const effects: { unsubscribe(): void }[] = [];
    nodes.forEach((s, i) => {
        if (i < 3) return;
        if (r() < 0.5) {
            observed.add(i);
            holds.push(s.obs.subscribe({ next: (v) => obsLog.push({ i, w: wave, v }), error: () => {} }));
        }
        if (r() < 0.3) {
            observed.add(i);
            effects.push(Signal.effect(() => void effectLog.push({ i, w: wave, v: s() })));
        }
    });

    const report: Report = { waves: 0, obsGlitches: [], effectGlitches: [], errors: [] };
    for (let w = 0; w < waves; w++) {
        wave++;
        const writes: string[] = [];
        try {
            const m = batched ? 1 + Math.floor(r() * 3) : 1;
            Batcher.run(() => {
                for (let j = 0; j < m; j++) {
                    const si = Math.floor(r() * states.length);
                    const v = Math.floor(r() * 7);
                    writes.push(`s${si}=${v}`);
                    states[si].set(v);
                }
            });
        } catch (error) {
            report.errors.push(`seed ${seed} wave ${wave} writes ${writes.join(",")}: threw ${String(error)}`);
            continue;
        }
        const settled = new Map<number, number>();
        for (const i of observed) settled.set(i, nodes[i].peek());
        const where = `seed ${seed} wave ${wave} writes ${writes.join(",")}`;
        const perNode = new Map<number, number[]>();
        for (const o of obsLog) if (o.w === wave) perNode.set(o.i, [...(perNode.get(o.i) ?? []), o.v]);
        for (const [i, vs] of perNode) {
            // State.obs gives every write of a batch immediately (kept behavior).
            if (kinds[i] === "state") continue;
            if (vs.length > 1 || !Object.is(vs[0], settled.get(i))) {
                report.obsGlitches.push(
                    `${where}: node ${i} (${kinds[i]}) .obs ${JSON.stringify(vs)}, settled ${settled.get(i)}`,
                );
            }
        }
        for (const e of effectLog) {
            if (e.w === wave && !Object.is(e.v, settled.get(e.i))) {
                report.effectGlitches.push(
                    `${where}: effect over node ${e.i} (${kinds[e.i]}) saw ${e.v}, settled ${settled.get(e.i)}`,
                );
            }
        }
        report.waves++;
    }
    effects.forEach((e) => e.unsubscribe());
    holds.forEach((h) => h.unsubscribe());
    return report;
}

/**
 * Runs `graphs` seeded graphs. Errors the engine throws, or that RxJS reports
 * as unhandled (asynchronously, hence the macrotask), count as failures too.
 */
async function runMany(graphClass: GraphClass, graphs: number, batched: boolean, waves = 12) {
    const total: Report = { waves: 0, obsGlitches: [], effectGlitches: [], errors: [] };
    const previous = config.onUnhandledError;
    config.onUnhandledError = (error) => total.errors.push(`unhandled: ${String(error)}`);
    try {
        for (let g = 1; g <= graphs; g++) {
            const seed = g * 7919;
            try {
                const report = runGraph(seed, graphClass, waves, batched);
                total.waves += report.waves;
                total.obsGlitches.push(...report.obsGlitches);
                total.effectGlitches.push(...report.effectGlitches);
                total.errors.push(...report.errors);
            } catch (error) {
                total.errors.push(`seed ${seed}: setup threw ${String(error)}`);
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
        config.onUnhandledError = previous;
    }
    return total;
}

const summary = (report: Report, found: string[]) =>
    `${found.length} in ${report.waves} waves, first:\n${found.slice(0, 3).join("\n")}`;

describe("bridge: random graphs", () => {
    it.each(["no-share", "hot-join-root", "hot-join-any"] as const)(
        "effects only see settled values and the engine does not throw, batches of 1-3 writes (%s)",
        async (graphClass) => {
            const report = await runMany(graphClass, 150, true);

            expect(report.errors.length, summary(report, report.errors)).toBe(0);
            expect(report.effectGlitches.length, summary(report, report.effectGlitches)).toBe(0);
        },
    );

    // Single writes: with several writes in a batch, State.obs delivers each
    // one immediately, and a chain that subscribes to a computed's .obs at that
    // moment (switchMap, mergeMap) may legitimately drain the queue early.
    it.each(["no-share", "hot-join-root"] as const)(
        ".obs gives at most one value per write, the settled one (%s)",
        async (graphClass) => {
            const report = await runMany(graphClass, 150, false);

            expect(report.obsGlitches.length, summary(report, report.obsGlitches)).toBe(0);
        },
    );
});
