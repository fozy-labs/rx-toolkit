/**
 * The bridge through RxJS: `a → b`, where `a` is a signal, `b` is
 * `Signal.from` / `SourceSignal.create` and an RxJS chain from `a.obs` sits in
 * between. Requirements come from the proposal (section "Мост через RxJS" of
 * .tmp/0.13.0/proposal/signals-core-without-rxjs.md in the main checkout); the
 * scenarios are ported from the delivery-gate prototype probes and attacks
 * (.tmp/bridge-design/a-proto, a-attack) and from the alternative design's
 * tests (b-proto).
 *
 * Signal readers (computeds, effects, get/peek) must never see `b` lagging
 * behind `a`. Raw `.obs` of a dependent must give one value per batch unless
 * code inside the batch reads a computed or `b`. The accepted residual (a raw
 * `.obs` subscriber may see one stale value on the first pass through a hidden
 * bridge whose root depends on the receiver) is deliberately not pinned.
 */
import {
    combineLatest,
    delay,
    distinctUntilChanged,
    filter,
    finalize,
    map,
    NEVER,
    retry,
    scan,
    share,
    skip,
    Subject,
    switchMap,
    timer,
} from "rxjs";

import { Batcher, Computed, Signal, SignalCycleError, type DisposableSignal, type ReadonlySignal } from "@/index";

import { caught, effectLog, hangGuard, record } from "./helpers";

/** Observes a signal through raw `.obs` and through an effect. */
function watch<T>(signal: ReadonlySignal<T>) {
    const obs = record(signal.obs);
    const eff = effectLog(() => signal());
    return {
        obs: obs.values,
        obsErrors: obs.errors,
        eff: eff.values,
        stop() {
            obs.unsubscribe();
            eff.unsubscribe();
        },
    };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const join = (...values: unknown[]) => values.join("|");
const parse = (value: string) => value.split("|").map(Number);

describe("bridge: consistency", () => {
    /**
     * The blocker: b hot-joins a running share() of a.obs without replay, and
     * the reader subscribes to `a` before the chain does (adversarial order).
     */
    function blocker() {
        const a = Signal.state(0);
        const flag = Signal.state(false);
        const shared = a.obs.pipe(
            map((v) => v * 10),
            share(),
        );
        let b!: DisposableSignal<number>;
        const r = Signal.compute(() => (flag() ? join(a(), b()) : join(a(), a() * 10)));
        const log = watch(r);
        const hold = shared.subscribe();
        b = Signal.from(shared, { default: 0 });
        flag.set(true);
        return {
            a,
            r,
            log,
            stop() {
                hold.unsubscribe();
                log.stop();
            },
        };
    }

    it("blocker: a reader of a and b sees them consistent, one value per write or batch", () => {
        const { a, log, stop } = blocker();

        a.set(1);
        a.set(2);
        Batcher.run(() => {
            a.set(3);
            a.set(4);
        });

        expect(log.obs).toEqual(["0|0", "1|10", "2|20", "4|40"]);
        expect(log.eff).toEqual(log.obs);
        stop();
    });

    it("blocker: a read of the reader inside a batch is consistent", () => {
        const { a, r, log, stop } = blocker();
        let insideBatch = "";

        Batcher.run(() => {
            a.set(3);
            insideBatch = r.peek();
            a.set(4);
        });

        expect(insideBatch).toBe("3|30");
        expect(log.eff).toEqual(["0|0", "4|40"]);
        // The read may drain the queue early and add one value to .obs, but never a stale one.
        expect(log.obs.at(-1)).toBe("4|40");
        for (const v of log.obs) expect(parse(v)[1]).toBe(parse(v)[0] * 10);
        stop();
    });

    it("blocker through computeds: the reader reaches b through one computed and a through another", () => {
        const a = Signal.state(1);
        const shared = a.obs.pipe(
            map((v) => v * 10),
            share(),
        );
        const hold = shared.subscribe();
        const b = Signal.from(shared, { default: 0 });
        const a2 = Signal.compute(() => a() + 100);
        const b2 = Signal.compute(() => b() + 100);
        const c = Signal.compute(() => join(b2(), a2())); // b read before a
        const log = watch(c);

        a.set(2);
        a.set(3);

        expect(log.obs).toEqual(["100|101", "120|102", "130|103"]);
        expect(log.eff).toEqual(log.obs);
        hold.unsubscribe();
        log.stop();
    });

    it("a hidden bridge from a computed ancestor: the ancestor's chain runs before the reader", () => {
        const x = Signal.state(1);
        const c1 = Signal.compute(() => x() * 2);
        const shared = c1.obs.pipe(
            map((v) => v + 1),
            share(),
        );
        const hold = shared.subscribe();
        const b = Signal.from(shared, { default: -1 });
        const v = Signal.compute(() => join(c1(), b()));
        const log = watch(v);

        x.set(2);
        x.set(3);

        // "2|-1": b has not received anything yet (no replay) — its default, not a glitch.
        expect(log.obs).toEqual(["2|-1", "4|5", "6|7"]);
        expect(log.eff).toEqual(log.obs);
        hold.unsubscribe();
        log.stop();
    });

    it("a hidden bridge from an ancestor through intermediate computeds, the reader reads b first", () => {
        const x = Signal.state(1);
        const c = Signal.compute(() => x() * 2);
        const m = Signal.compute(() => c() + 100);
        const shared = c.obs.pipe(
            map((y) => y + 1),
            share(),
        );
        const hold = shared.subscribe();
        const b = Signal.from(shared, { default: 3 });
        const v = Signal.compute(() => join(b(), m()));
        const log = watch(v);

        x.set(2);
        x.set(3);

        expect(log.obs).toEqual(["3|102", "5|104", "7|106"]);
        expect(log.eff).toEqual(log.obs);
        hold.unsubscribe();
        log.stop();
    });

    it("the blocker one hop further: b2 hot-joins x.obs.pipe(share()) where x reads another bridge", () => {
        const a = Signal.state(0);
        const flag = Signal.state(false);
        const s1 = a.obs.pipe(
            map((v) => v + 1),
            share(),
        );
        const hold1 = s1.subscribe();
        const b1 = Signal.from(s1, { default: 1 });
        const x = Signal.compute(() => b1() * 2);
        let b2!: DisposableSignal<number>;
        const r = Signal.compute(() => (flag() ? join(x(), b2()) : join(x(), x())));
        const log = watch(r);
        const s2 = x.obs.pipe(share());
        const hold2 = s2.subscribe();
        b2 = Signal.from(s2, { default: 2 });

        flag.set(true);
        for (let i = 1; i <= 3; i++) a.set(i);

        expect(log.obs).toEqual(["2|2", "4|4", "6|6", "8|8"]);
        expect(log.eff).toEqual(log.obs);
        hold1.unsubscribe();
        hold2.unsubscribe();
        log.stop();
    });

    describe("three bridges through computeds", () => {
        const expected = ["0|1|2|2|3|3", "1|2|4|4|5|5", "2|3|6|6|7|7", "3|4|8|8|9|9", "11|12|24|24|25|25"];
        const run = (a: ReturnType<typeof Signal.state<number>>) => {
            for (let i = 1; i <= 3; i++) a.set(i);
            Batcher.run(() => {
                a.set(10);
                a.set(11);
            });
        };

        it("fresh chains (bridges known when they connect)", () => {
            const a = Signal.state(0);
            const b1 = Signal.from(a.obs.pipe(map((v) => v + 1)), { default: -1 });
            const x1 = Signal.compute(() => b1() * 2);
            const b2 = Signal.from(x1.obs, { default: -1 });
            const x2 = Signal.compute(() => b2() + 1);
            const b3 = Signal.from(x2.obs, { default: -1 });
            const r = Signal.compute(() => join(a(), b1(), x1(), b2(), x2(), b3()));
            const log = watch(r);

            run(a);

            expect(log.obs).toEqual(expected);
            expect(log.eff).toEqual(expected);
            log.stop();
        });

        it("every link hot-joins a running share() without replay, one reader over all stages", () => {
            const a = Signal.state(0);
            const flag = Signal.state(false);
            let b1!: DisposableSignal<number>;
            let x1!: DisposableSignal<number>;
            let b2!: DisposableSignal<number>;
            let x2!: DisposableSignal<number>;
            let b3!: DisposableSignal<number>;
            const r = Signal.compute(() => (flag() ? join(a(), b1(), x1(), b2(), x2(), b3()) : expected[0]));
            const log = watch(r);
            const s1 = a.obs.pipe(
                map((v) => v + 1),
                share(),
            );
            const holds = [s1.subscribe()];
            b1 = Signal.from(s1, { default: 1 });
            x1 = Signal.compute(() => b1() * 2);
            const s2 = x1.obs.pipe(share());
            holds.push(s2.subscribe());
            b2 = Signal.from(s2, { default: 2 });
            x2 = Signal.compute(() => b2() + 1);
            const s3 = x2.obs.pipe(share());
            holds.push(s3.subscribe());
            b3 = Signal.from(s3, { default: 3 });
            const x2Log = record(x2.obs);
            const b3Log = record(b3.obs);

            flag.set(true);
            run(a);

            expect(log.obs).toEqual(expected);
            expect(log.eff).toEqual(expected);
            expect(x2Log.values).toEqual([3, 5, 7, 9, 25]);
            expect(b3Log.values).toEqual([5, 7, 9, 25]);
            holds.forEach((h) => h.unsubscribe());
            log.stop();
        });
    });

    describe("a diamond of known bridges with combineLatest", () => {
        function run() {
            const x = Signal.state(1);
            const c = Signal.compute(() => x() + 1);
            const b1 = Signal.from(c.obs.pipe(map((y) => y * 10)));
            const d = Signal.compute(() => b1() + x());
            const b2 = Signal.from(combineLatest([d.obs, x.obs, c.obs]).pipe(map(([p, q, s]) => p + q + s)));
            const v = Signal.compute(() => join(x(), b2()));
            const log = watch(v);
            x.set(2);
            x.set(3);
            Batcher.run(() => {
                x.set(4);
                x.set(5);
            });
            log.stop();
            return log;
        }
        const ok = (xv: number) => join(xv, 13 * xv + 11);

        it("effects see one consistent value per write", () => {
            expect(run().eff).toEqual([ok(1), ok(2), ok(3), ok(5)]);
        });

        it(".obs of the reader gives one consistent value per write", () => {
            expect(run().obs).toEqual([ok(1), ok(2), ok(3), ok(5)]);
        });
    });

    describe("a switchMap inner whose first value is swallowed by distinctUntilChanged (no share)", () => {
        function run() {
            const s = Signal.state(0);
            const t2 = Signal.from(s.obs.pipe(map((v) => v * 100)), { default: 0 });
            const r = Signal.compute(() => t2());
            const u = Signal.from(
                s.obs.pipe(
                    switchMap(() => r.obs),
                    distinctUntilChanged(),
                ),
                { default: -1 },
            );
            const t = Signal.from(s.obs.pipe(map((v) => v * 10)), { default: 0 });
            t.peek();
            u.peek();
            const v = Signal.compute(() => join(t(), u()));
            const log = watch(v);
            s.set(1);
            s.set(2);
            log.stop();
            return log;
        }

        it("effects see one consistent value per write", () => {
            expect(run().eff).toEqual(["0|0", "10|100", "20|200"]);
        });

        it(".obs of the reader gives one consistent value per write", () => {
            expect(run().obs).toEqual(["0|0", "10|100", "20|200"]);
        });
    });
});

describe("bridge: reading b", () => {
    it("get, peek and a computed inside a batch run a changed computed root through the chain first", () => {
        const a = Signal.state(1);
        const x = Signal.compute(() => a() * 2);
        const b = Signal.from(x.obs.pipe(map((v) => v + 1)));
        const log = effectLog(() => b());
        let reads: number[] = [];

        Batcher.run(() => {
            a.set(5);
            reads = [b.peek(), b(), Signal.compute(() => b()).peek()];
        });

        expect(reads).toEqual([11, 11, 11]);
        expect(log.values).toEqual([3, 11]);
        log.unsubscribe();
    });

    it("get and peek inside a batch see a changed State root through the chain", () => {
        const a = Signal.state(1);
        const b = Signal.from(a.obs.pipe(map((v) => v * 10)));
        const log = effectLog(() => b());
        let reads: number[] = [];

        Batcher.run(() => {
            a.set(5);
            reads = [b.peek(), b(), Signal.compute(() => b()).peek()];
        });

        expect(reads).toEqual([50, 50, 50]);
        expect(log.values).toEqual([10, 50]);
        log.unsubscribe();
    });

    it("an effect that writes the root and then reads [a, b] sees them consistent", () => {
        const a = Signal.state(0);
        const trigger = Signal.state(0);
        const shared = a.obs.pipe(
            map((v) => v * 10),
            share(),
        );
        const hold = shared.subscribe();
        const b = Signal.from(shared, { default: 0 });
        const r = Signal.compute(() => join(a(), b()));
        const rLog = record(r.obs);
        const seen: string[] = [];
        const effect = Signal.effect(() => {
            const t = trigger();
            if (!t) return;
            a.set(t);
            seen.push(r());
        });

        trigger.set(1);
        trigger.set(2);

        // Whether the effect's own write re-runs it is not pinned here; every read must be consistent.
        expect(seen[0]).toBe("1|10");
        expect(seen.at(-1)).toBe("2|20");
        for (const v of [...seen, ...rLog.values]) expect(parse(v)[1]).toBe(parse(v)[0] * 10);
        effect.unsubscribe();
        hold.unsubscribe();
    });

    it("a State.obs subscriber reading a hot computed of that State sees the fresh value", () => {
        const s = Signal.state(1);
        const d = Signal.compute(() => s() * 2);
        const hot = effectLog(() => d());
        const seen: string[] = [];
        s.obs.subscribe((val) => seen.push(join(val, s(), d(), Signal.compute(() => join(s(), d())).peek())));

        s.set(2);

        expect(seen.at(-1)).toBe("2|2|4|2|4");
        hot.unsubscribe();
    });

    it("a State.obs subscriber registered after a bridge reads a consistent computed over the bridge", () => {
        const x = Signal.state(1);
        const bx = Signal.from(x.obs.pipe(map((y) => y * 10)));
        const c = Signal.compute(() => x() * 2);
        const v = Signal.compute(() => join(c(), bx()));
        const hot = effectLog(() => v());
        const seen: string[] = [];
        x.obs.subscribe(() => seen.push(v.peek()));

        x.set(2);

        expect(seen.at(-1)).toBe("4|20");
        hot.unsubscribe();
    });
});

describe("bridge: several sources", () => {
    it("combineLatest of two states written in one batch: dependents see only the value after both", () => {
        const a = Signal.state(1);
        const x = Signal.state(1);
        const inner: string[] = [];
        const b = Signal.from(
            combineLatest([a.obs, x.obs]).pipe(
                map(([p, q]) => {
                    inner.push(join(p, q));
                    return p + q;
                }),
            ),
        );
        const c = Signal.compute(() => join(a(), x(), b()));
        const log = watch(c);

        Batcher.run(() => {
            a.set(2);
            x.set(5);
        });
        Batcher.run(() => {
            x.set(7);
            a.set(3);
        });

        expect(log.obs).toEqual(["1|1|2", "2|5|7", "3|7|10"]);
        expect(log.eff).toEqual(log.obs);
        // Only the chain itself sees the intermediate pairs.
        expect(inner).toContain("2|1");
        log.stop();
    });

    it("combineLatest of two computeds changed by one write: dependents see only the final pair", () => {
        const x = Signal.state(1);
        const c1 = Signal.compute(() => x() + 1);
        const c2 = Signal.compute(() => x() * 10);
        const b = Signal.from(combineLatest([c1.obs, c2.obs]).pipe(map(([p, q]) => `${p}/${q}`)));
        const v = Signal.compute(() => b());
        const log = watch(v);

        x.set(2);
        x.set(3);

        expect(log.obs).toEqual(["2/10", "3/20", "4/30"]);
        expect(log.eff).toEqual(log.obs);
        log.stop();
    });
});

describe("bridge: filtering", () => {
    const roots = {
        "a State": (a: ReadonlySignal<number>) => a,
        "a computed": (a: ReadonlySignal<number>) => Signal.compute(() => a() * 1),
    };

    it.each(Object.entries(roots))(
        "a value dropped by filter leaves b and its dependents untouched (root: %s)",
        (_, root) => {
            const a = Signal.state(0);
            const b = Signal.from(root(a).obs.pipe(filter((v) => v % 2 === 0)), { default: -1 });
            const dFn = vi.fn(() => b() * 10);
            const d = Signal.compute(dFn);
            const dLog = record(d.obs);
            const effectFn = vi.fn(() => {
                d();
            });
            const effect = Signal.effect(effectFn);
            dFn.mockClear();
            effectFn.mockClear();

            a.set(1);
            a.set(3);

            expect(dFn).not.toHaveBeenCalled();
            expect(effectFn).not.toHaveBeenCalled();

            a.set(4);

            expect(dFn).toHaveBeenCalledTimes(1);
            expect(effectFn).toHaveBeenCalledTimes(1);
            expect(dLog.values).toEqual([0, 40]);
            effect.unsubscribe();
            dLog.unsubscribe();
        },
    );

    it("a value dropped by distinctUntilChanged leaves b and its dependents untouched", () => {
        const a = Signal.state(0);
        const x = Signal.compute(() => a() + 1);
        const b = Signal.from(
            x.obs.pipe(
                map((v) => v % 2),
                distinctUntilChanged(),
            ),
        );
        const effectFn = vi.fn(() => {
            b();
        });
        const effect = Signal.effect(effectFn);
        effectFn.mockClear();

        a.set(2);
        a.set(4);
        expect(effectFn).not.toHaveBeenCalled();

        a.set(5);
        expect(effectFn).toHaveBeenCalledTimes(1);
        expect(b.peek()).toBe(0);
        effect.unsubscribe();
    });
});

describe("bridge: asynchronous operators", () => {
    it("delay leaves b with its previous value; the later emission is an ordinary write", async () => {
        const a = Signal.state(1);
        const b = Signal.from(a.obs.pipe(delay(5)), { default: 0 });
        const r = Signal.compute(() => join(a(), b()));
        const log = watch(r);

        await sleep(20);
        a.set(2);
        const right = b.peek();
        await sleep(20);

        expect(right).toBe(1);
        expect(log.eff).toEqual(["1|0", "1|1", "2|1", "2|2"]);
        expect(log.obs).toEqual(log.eff);
        log.stop();
    });

    it("switchMap to a request: only the latest response lands, as a write of its own", async () => {
        const a = Signal.state(1);
        const b = Signal.from(a.obs.pipe(switchMap((v) => timer(5).pipe(map(() => v * 10)))), { default: 0 });
        const log = effectLog(() => b());

        await sleep(20);
        a.set(2);
        a.set(3);
        await sleep(20);

        expect(log.values).toEqual([0, 10, 30]);
        log.unsubscribe();
    });
});

describe("bridge: lifetime", () => {
    it("observers of b hold its computed root; the chain is released when the last one leaves", () => {
        const src = Signal.state(1);
        const xFn = vi.fn(() => src() * 2);
        const x = Signal.compute(xFn);
        const released = vi.fn();
        const b = Signal.from(
            x.obs.pipe(
                map((v) => v + 1),
                finalize(released),
            ),
            { keepAlive: "none" },
        );
        const log = effectLog(() => b());
        src.set(2);

        expect(log.values).toEqual([3, 5]);
        expect(xFn).toHaveBeenCalledTimes(2);

        log.unsubscribe();
        expect(released).toHaveBeenCalledTimes(1);
        src.set(3);
        expect(xFn).toHaveBeenCalledTimes(2);
    });

    it("keepAlive of b releases the chain only after its window", () => {
        vi.useFakeTimers();
        try {
            const src = Signal.state(1);
            const xFn = vi.fn(() => src() * 2);
            const x = Signal.compute(xFn);
            const b = Signal.from(x.obs, { keepAlive: 100 });
            const log = effectLog(() => b());
            log.unsubscribe();

            src.set(2);
            expect(xFn).toHaveBeenCalledTimes(2);

            vi.advanceTimersByTime(100);
            src.set(3);
            expect(xFn).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("switchMap unsubscribing from an inner .obs removes its bridge", () => {
        const sel = Signal.state<"A" | "B">("A");
        const A = Signal.state(1);
        const B = Signal.state(10);
        const aFn = vi.fn(() => A() * 2);
        const aDoubled = Signal.compute(aFn);
        const b = Signal.from(sel.obs.pipe(switchMap((k) => (k === "A" ? aDoubled.obs : B.obs))));
        const log = effectLog(() => b());

        sel.set("B");
        aFn.mockClear();
        A.set(5);

        expect(aFn).not.toHaveBeenCalled();
        expect(log.values).toEqual([2, 10]);
        log.unsubscribe();
    });
});

describe("bridge: switchMap to another signal's .obs", () => {
    it("the inner switches in the same batch as a change of the new inner", () => {
        const key = Signal.state<"A" | "B">("A");
        const A = Signal.state(1);
        const B = Signal.state(10);
        let b!: DisposableSignal<number>;
        const r = Signal.compute(() => join(key() === "A" ? A() : B(), b()));
        b = Signal.from(key.obs.pipe(switchMap((k) => (k === "A" ? A.obs : B.obs))), { default: 0 });
        const log = watch(r);

        A.set(2);
        Batcher.run(() => {
            key.set("B");
            B.set(20);
        });
        B.set(30);
        A.set(3);

        expect(log.obs).toEqual(["1|1", "2|2", "20|20", "30|30"]);
        expect(log.eff).toEqual(log.obs);
        log.stop();
    });

    it("a source inner and a computed inner, with the old inner dropped after switching", () => {
        const sel = Signal.state<"p" | "q">("p");
        const p = Signal.state(1);
        const q = Signal.state(100);
        const qc = Signal.compute(() => q() * 2);
        const b = Signal.from(sel.obs.pipe(switchMap((k) => (k === "p" ? p.obs : qc.obs))));
        const c = Signal.compute(() => join(sel(), sel() === "p" ? p() : qc(), b()));
        const log = watch(c);

        p.set(2);
        sel.set("q");
        q.set(101);
        Batcher.run(() => {
            sel.set("p");
            p.set(3);
        });
        q.set(500);

        expect(log.obs).toEqual(["p|1|1", "p|2|2", "q|200|200", "q|202|202", "p|3|3"]);
        expect(log.eff).toEqual(log.obs);
        log.stop();
    });

    it("the selector and the old inner change in one write: effects see only the new inner", () => {
        const x = Signal.state(0);
        const p1 = Signal.compute(() => x() * 10);
        const hold = p1.obs.subscribe();
        const sel = Signal.compute(() => x() > 0);
        const p2 = Signal.compute(() => x() * 100);
        const b = Signal.from(sel.obs.pipe(switchMap((k) => (k ? p2.obs : p1.obs))));
        const log = effectLog(() => b());

        x.set(1);

        expect(log.values).toEqual([0, 100]);
        log.unsubscribe();
        hold.unsubscribe();
    });

    it("effects over combineLatest and switchMap bridges see only settled values", () => {
        const x = Signal.state(1);
        const c1 = Signal.compute(() => x() + 1);
        const c2 = Signal.compute(() => x() * 10);
        const b = Signal.from(combineLatest([c1.obs, c2.obs]).pipe(map(([p, q]) => q - (p - 1) * 10)));
        const sel = Signal.compute(() => x() % 2 === 0);
        const p = Signal.compute(() => x() * 3);
        const q = Signal.compute(() => x() * 5);
        const s = Signal.from(sel.obs.pipe(switchMap((k) => (k ? p.obs : q.obs))));
        const log = effectLog(() => [b(), s(), x()]);

        for (let i = 2; i < 6; i++) x.set(i);
        Batcher.run(() => {
            x.set(10);
            x.set(11);
        });

        expect(log.values.map(([, , xv]) => xv)).toEqual([1, 2, 3, 4, 5, 11]);
        for (const [bv, sv, xv] of log.values) {
            expect(bv).toBe(0);
            expect(sv).toBe(xv * (xv % 2 ? 5 : 3));
        }
        log.unsubscribe();
    });
});

describe("bridge: errors", () => {
    it("an error in the middle becomes the state of b, and b recovers when the source changes", () => {
        const a = Signal.state(1);
        const boom = new Error("neg");
        const x = Signal.compute(() => {
            if (a() < 0) throw boom;
            return a();
        });
        const b = Signal.from(x.obs.pipe(map((v) => v * 10)), { default: 0 });
        const r = Signal.compute(() => {
            try {
                return String(b());
            } catch (error) {
                return (error as Error).message;
            }
        });
        const log = watch(r);

        a.set(-1);
        const thrown = caught(() => b.peek());
        a.set(2);
        a.set(3);

        expect(thrown).toBe(boom);
        expect(log.obs).toEqual(["10", "neg", "20", "30"]);
        expect(log.eff).toEqual(log.obs);
        log.stop();
    });

    it("an effect over a dependent of b sees the error and the recovery", () => {
        const a = Signal.state(1);
        const boom = new Error("neg");
        const c = Signal.compute(() => {
            if (a() < 0) throw boom;
            return a();
        });
        const b = Signal.from(c.obs.pipe(map((v) => v * 10)));
        const d = Signal.compute(() => b() + 1);
        const seen: unknown[] = [];
        const effect = Signal.effect(() => {
            try {
                seen.push(d());
            } catch (error) {
                seen.push((error as Error).message);
            }
        });

        a.set(-1);
        expect(() => b()).toThrow(boom);
        a.set(2);

        expect(b()).toBe(20);
        expect(seen).toEqual([11, "neg", 21]);
        effect.unsubscribe();
    });

    it("stateful operators start over after the resubscription", () => {
        const a = Signal.state(1);
        const x = Signal.compute(() => {
            if (a() < 0) throw new Error("neg");
            return a();
        });
        const b = Signal.from(x.obs.pipe(scan((acc, v) => acc + v, 0)));
        const seen: unknown[] = [];
        const effect = Signal.effect(() => {
            try {
                seen.push(b());
            } catch {
                seen.push("ERR");
            }
        });

        a.set(2);
        a.set(-1);
        a.set(5);

        expect(seen).toEqual([1, 3, "ERR", 5]);
        effect.unsubscribe();
    });

    it("recovers after the erroring computed was notified without a change (same error)", () => {
        const a = Signal.state(-1);
        const k = Signal.state(0);
        const neg = new Error("neg");
        const x = Signal.compute(() => {
            k();
            if (a() < 0) throw neg;
            return a();
        });
        const t = Signal.from(x.obs.pipe(map((v) => v * 10)), { default: 0 });
        a.set(1);
        const seen: string[] = [];
        const effect = Signal.effect(() => {
            try {
                seen.push(String(t()));
            } catch {
                seen.push("ERR");
            }
        });

        a.set(-1);
        k.set(1);
        a.set(5);

        expect(seen).toEqual(["10", "ERR", "50"]);
        expect(t.peek()).toBe(50);
        effect.unsubscribe();
    });

    it("recovers when the first reader is an effect and b errors while connecting", () => {
        const a = Signal.state(0);
        const x = Signal.compute(() => {
            if (a() === 0) throw new Error("zero");
            return a();
        });
        const t = Signal.from(x.obs.pipe(map((v) => v * 10)), { default: -1 });
        const seen: string[] = [];
        const effect = Signal.effect(() => {
            try {
                seen.push(String(t()));
            } catch {
                seen.push("ERR");
            }
        });

        a.set(1);
        a.set(2);

        expect(seen).toEqual(["ERR", "10", "20"]);
        effect.unsubscribe();
    });

    it("a cold read of an errored b recovers after the source changes", () => {
        const a = Signal.state(-1);
        const boom = new Error("neg");
        const c = Signal.compute(() => {
            if (a() < 0) throw boom;
            return a();
        });
        const b = Signal.from(c.obs.pipe(map((v) => v * 10)));

        expect(() => b()).toThrow(boom);
        a.set(2);
        expect(b()).toBe(20);
    });

    it("the error from the inner computed of a switchMap becomes the state of b and recovers", () => {
        const sel = Signal.state(true);
        const a = Signal.state(1);
        const boom = new Error("boom");
        const inner = Signal.compute(() => {
            if (a() < 0) throw boom;
            return a();
        });
        const other = Signal.state(100);
        const b = Signal.from(sel.obs.pipe(switchMap((k) => (k ? inner.obs : other.obs))));
        const seen: unknown[] = [];
        const effect = Signal.effect(() => {
            try {
                seen.push(b());
            } catch (error) {
                seen.push((error as Error).message);
            }
        });

        a.set(-1);
        a.set(3);
        sel.set(false);

        expect(seen).toEqual([1, "boom", 3, 100]);
        effect.unsubscribe();
    });

    describe("a recovering bridge is consistent with a bridge derived from it", () => {
        function setup() {
            const a = Signal.state(0);
            const cx = Signal.compute(() => {
                if (a() === 0) throw new Error("zero");
                return a();
            });
            const t = Signal.from(cx.obs, { default: -1 });
            caught(() => t.peek());
            const safeT = () => {
                try {
                    return t();
                } catch {
                    return -1;
                }
            };
            const x = Signal.compute(safeT);
            const t2 = Signal.from(x.obs.pipe(map((v) => v * 10)), { default: 0 }); // t2 == 10 * t
            t2.peek();
            return { a, t2, safeT };
        }

        it("read at top level", () => {
            const { a, t2, safeT } = setup();
            const r = Signal.compute(() => join(safeT(), t2()));

            a.set(3);

            expect(r.peek()).toBe("3|30");
        });

        it("read inside a batch", () => {
            const { a, t2, safeT } = setup();
            const r = Signal.compute(() => join(safeT(), t2()));
            a.set(3);
            let read = "";

            Batcher.run(() => {
                read = r.peek();
            });

            expect(read).toBe("3|30");
        });

        it("observed through .obs and an effect", () => {
            const { a, t2, safeT } = setup();
            const z = Signal.state(0);
            const r = Signal.compute(() => join(z(), safeT(), t2()));
            const log = watch(r);

            a.set(3);
            z.set(1);

            for (const v of [...log.obs, ...log.eff]) expect(parse(v)[2]).toBe(parse(v)[1] * 10);
            expect(log.eff.at(-1)).toBe("1|3|30");
            log.stop();
        });
    });
});

describe("bridge: cycles", () => {
    it("a hot cycle through a bridge throws SignalCycleError from the write that closes it", () => {
        const flag = Signal.state(false);
        const guard = hangGuard("x");
        let b!: DisposableSignal<number>;
        const x: DisposableSignal<number> = Signal.compute(() => {
            guard();
            return flag() ? b() + 1 : 0;
        });
        b = Signal.from(x.obs, { default: 0 });
        const effect = Signal.effect(() => {
            caught(() => b());
        });

        expect(caught(() => flag.set(true))).toBeInstanceOf(SignalCycleError);
        effect.unsubscribe();
    });

    it("a hot cycle through a bridge observed by .obs throws SignalCycleError", () => {
        const on = Signal.state(false);
        const src = Signal.state(1);
        const guard = hangGuard("a");
        let b!: DisposableSignal<number>;
        const a: DisposableSignal<number> = Signal.compute(() => {
            guard();
            return on() ? b() + 1 : src();
        });
        b = Signal.from(a.obs.pipe(map((v) => v * 2)));
        const log = record(b.obs);

        expect(caught(() => on.set(true))).toBeInstanceOf(SignalCycleError);
        log.unsubscribe();
    });

    it("a cold cycle through a bridge throws SignalCycleError on read", () => {
        let b!: DisposableSignal<number>;
        const guard = hangGuard("x");
        const x: DisposableSignal<number> = Signal.compute(() => {
            guard();
            return b() + 1;
        });
        b = Signal.from(x.obs.pipe(map((v) => v)), { default: 0 });

        expect(caught(() => b())).toBeInstanceOf(SignalCycleError);
        expect(caught(() => x())).toBeInstanceOf(SignalCycleError);
    });

    describe("single-bridge cycle variants", () => {
        it("b hot-joins a running share() of the node that reads it", () => {
            const on = Signal.state(false);
            const guard = hangGuard("x");
            let b!: DisposableSignal<number>;
            const x: DisposableSignal<number> = Signal.compute(() => {
                guard();
                return on() ? b() + 1 : 0;
            });
            const shared = x.obs.pipe(share());
            const hold = shared.subscribe({ error: () => {} });
            b = Signal.from(shared, { default: 0 });
            const effect = Signal.effect(() => {
                caught(() => b());
            });

            expect(caught(() => on.set(true))).toBeInstanceOf(SignalCycleError);
            effect.unsubscribe();
            hold.unsubscribe();
        });

        it("the inner .obs of a switchMap is the node that reads b", () => {
            const on = Signal.state(false);
            const s = Signal.state(0);
            const guard = hangGuard("x");
            let b!: DisposableSignal<number>;
            const x: DisposableSignal<number> = Signal.compute(() => {
                guard();
                return on() ? b() + 1 : 0;
            });
            b = Signal.from(s.obs.pipe(switchMap(() => x.obs)), { default: 0 });
            const effect = Signal.effect(() => {
                caught(() => b());
            });

            const thrown = caught(() =>
                Batcher.run(() => {
                    on.set(true);
                    s.set(1);
                }),
            );

            expect(thrown).toBeInstanceOf(SignalCycleError);
            effect.unsubscribe();
        });

        it("the cycle runs through an intermediate computed and a filter", () => {
            const k = Signal.state(0);
            const guard = hangGuard("x");
            let b!: DisposableSignal<number>;
            const x: DisposableSignal<number> = Signal.compute(() => {
                guard();
                return b() + k();
            });
            const y = Signal.compute(() => x() * 2);
            b = Signal.from(y.obs.pipe(filter((v) => v > 3)), { default: 0 });
            const effect = Signal.effect(() => {
                caught(() => y());
            });

            expect(caught(() => k.set(5))).toBeInstanceOf(SignalCycleError);
            effect.unsubscribe();
        });
    });

    describe("a diverging loop through two bridges", () => {
        function setup() {
            const on = Signal.state(false);
            const guard = hangGuard("c1");
            let b!: DisposableSignal<number>;
            const c1: DisposableSignal<number> = Signal.compute(() => {
                guard();
                return on() ? b() + 1 : 0;
            });
            const b2 = Signal.from(c1.obs, { default: 0 });
            const c2 = Signal.compute(() => b2() + 1);
            b = Signal.from(c2.obs.pipe(map((v) => v)), { default: 0 });
            b.peek();
            return { on, b };
        }

        it("throws SignalCycleError from the write", () => {
            const { on } = setup();

            expect(caught(() => on.set(true))).toBeInstanceOf(SignalCycleError);
        });

        it("throws SignalCycleError from a batch that reads the loop", () => {
            const { on, b } = setup();

            const thrown = caught(() =>
                Batcher.run(() => {
                    on.set(true);
                    b.peek();
                }),
            );

            expect(thrown).toBeInstanceOf(SignalCycleError);
        });
    });

    it("the graph works again once the cycle is broken", () => {
        const on = Signal.state(false);
        const src = Signal.state(1);
        const guard = hangGuard("a");
        let b!: DisposableSignal<number>;
        const a: DisposableSignal<number> = Signal.compute(() => {
            guard();
            return on() ? b() + 1 : src();
        });
        b = Signal.from(a.obs.pipe(map((v) => v * 2)));
        const bLog = record(b.obs);
        expect(caught(() => on.set(true))).toBeInstanceOf(SignalCycleError);

        const thrown = caught(() => {
            on.set(false);
            src.set(5);
        });

        expect(thrown).toBeUndefined();
        expect(a.peek()).toBe(5);
        expect(b.peek()).toBe(10);
        expect(record(a.obs).values).toEqual([5]);
        bLog.unsubscribe();
    });

    it("no false cycle: a b.obs subscriber lazily subscribes to a computed over b", () => {
        const x = Signal.state(1);
        const c = Signal.compute(() => x() * 2);
        const b = Signal.from(c.obs.pipe(map((y) => y + 1)), { default: 0 });
        const z = Signal.compute(() => b() * 10);
        let zLog: ReturnType<typeof record<number>> | null = null;
        const bSub = b.obs.subscribe((v) => {
            if (v > 3 && !zLog) zLog = record(z.obs);
        });

        const thrown = caught(() => x.set(2));

        expect(thrown).toBeUndefined();
        expect(zLog!.errors).toEqual([]);
        expect(zLog!.values).toEqual([50]);
        bSub.unsubscribe();
    });

    it("no false cycle: a v.obs subscriber reads a bridged signal that v starts reading later", () => {
        const x = Signal.state(1);
        const flag = Signal.state(false);
        const c = Signal.compute(() => x() * 2);
        const bs = Signal.from(c.obs.pipe(map((y) => y + 1)));
        const v = Signal.compute(() => (flag() ? x() + bs() : x()));
        const seen: string[] = [];
        const vSub = v.obs.subscribe((val) => seen.push(join(val, bs())));
        const hot = effectLog(() => bs());
        x.set(2);

        const thrown = caught(() => flag.set(true));

        expect(thrown).toBeUndefined();
        expect(seen.at(-1)).toBe("7|5");
        hot.unsubscribe();
        vSub.unsubscribe();
    });
});

describe("bridge: the accepted residual and non-bridges", () => {
    // Two configurations the core cannot tell apart before the first flow
    // (a.md, "Остаток и контрпример"). Raw `.obs` may emit one stale value in
    // one of them; signal readers and effects must stay consistent in both.
    function pq(which: "P" | "Q") {
        const a = Signal.state(0);
        const joined = Signal.state(false);
        let tx!: DisposableSignal<number>;
        let ty!: DisposableSignal<number>;
        const x = Signal.compute(() => a() + (joined() ? ty() : 0));
        const y = Signal.compute(() => a() + (joined() ? tx() : 0));
        const hotXY = Signal.effect(() => void (x(), y()));
        const sx = x.obs.pipe(
            map((v) => v * 100),
            share(),
        );
        const sy = y.obs.pipe(
            map((v) => v * 100),
            share(),
        );
        const holds = [sx.subscribe(), sy.subscribe()];
        if (which === "P") {
            tx = Signal.from(sx, { default: 0 }); // hot join: x.obs feeds tx, read by y
            ty = Signal.from<number>(NEVER, { default: 0 });
        } else {
            tx = Signal.from<number>(NEVER, { default: 0 });
            ty = Signal.from(sy, { default: 0 }); // hot join: y.obs feeds ty, read by x
        }
        const r = Signal.compute(() => (joined() ? [x(), y(), tx(), ty()] : [0, 0, 0, 0]));
        const consistent = ([X, Y, TX, TY]: number[]) => (which === "P" ? TX === X * 100 : TY === Y * 100);
        const log = effectLog(() => r());
        const xLog = record(x.obs);
        const yLog = record(y.obs);
        return {
            a,
            joined,
            r,
            consistent,
            log,
            stop() {
                log.unsubscribe();
                xLog.unsubscribe();
                yLog.unsubscribe();
                hotXY.unsubscribe();
                holds.forEach((h) => h.unsubscribe());
            },
        };
    }

    it.each(["P", "Q"] as const)("configuration %s: effects and reads stay consistent", (which) => {
        const { a, joined, r, consistent, log, stop } = pq(which);

        joined.set(true);
        const reads: number[][] = [];
        for (let i = 1; i <= 3; i++) {
            a.set(i);
            reads.push(r.peek());
        }

        for (const v of log.values) expect(consistent(v), JSON.stringify(v)).toBe(true);
        for (const v of reads) expect(consistent(v), JSON.stringify(v)).toBe(true);
        expect(log.values.at(-1)).toEqual(r.peek());
        stop();
    });

    // The symmetric counterexample of the alternative design: one raw
    // subscription per node both logs and, in one world, feeds the other side.
    it.each(["A", "B"] as const)(
        "symmetric counterexample, world %s: effects never see the intermediate value",
        (kind) => {
            const x = Signal.state(0);
            const hubP = new Subject<number>();
            const hubQ = new Subject<number>();
            const p = Signal.from(hubP, { default: 0 });
            const q = Signal.from(hubQ, { default: 0 });
            const c = Signal.compute(() => x() + p());
            const e = Signal.compute(() => x() + q());
            const subs = [
                c.obs.pipe(skip(1)).subscribe(kind === "A" ? hubQ : new Subject<number>()),
                e.obs.pipe(skip(1)).subscribe(kind === "B" ? hubP : new Subject<number>()),
            ];
            const cLog = effectLog(() => c());
            const eLog = effectLog(() => e());

            x.set(1);

            if (kind === "A") expect(eLog.values).toEqual([0, 2]);
            else expect(cLog.values).toEqual([0, 2]);
            cLog.unsubscribe();
            eLog.unsubscribe();
            subs.forEach((s) => s.unsubscribe());
        },
    );

    describe("sibling bridge from a root that does not depend on the receiver (not the residual)", () => {
        const odd = (list: number[]) => list.filter((v) => v % 2);

        it("the chain started before the reader", () => {
            const items = Signal.state([1, 2, 3]);
            const filtered = Signal.compute(() => odd(items()));
            const shared = filtered.obs.pipe(
                map((l) => l.length),
                share(),
            );
            const hold = shared.subscribe();
            const count = Signal.from(shared, { default: -1 });
            const view = Signal.compute(() => join(odd(items()).length, count()));
            const log = watch(view);

            items.set([1, 2, 3, 5]);
            items.set([7]);

            expect(log.obs).toEqual(["2|-1", "3|3", "1|1"]);
            expect(log.eff).toEqual(log.obs);
            hold.unsubscribe();
            log.stop();
        });

        it("the reader subscribed before the chain and starts reading the receiver later", () => {
            const items = Signal.state([1, 2, 3]);
            const useCount = Signal.state(false);
            const filtered = Signal.compute(() => odd(items()));
            let count!: DisposableSignal<number>;
            const view = Signal.compute(() => join(odd(items()).length, useCount() ? count() : "-"));
            const log = watch(view);
            const shared = filtered.obs.pipe(
                map((l) => l.length),
                share(),
            );
            const hold = shared.subscribe();
            count = Signal.from(shared, { default: -1 });

            useCount.set(true);
            items.set([1, 2, 3, 5]);
            items.set([7]);

            expect(log.obs).toEqual(["2|-", "2|-1", "3|3", "1|1"]);
            expect(log.eff).toEqual(log.obs);
            hold.unsubscribe();
            log.stop();
        });
    });

    it("a Subject-fed signal written from a .obs subscriber: settled reads are never stale", () => {
        const x = Signal.state(1);
        const c = Signal.compute(() => x() * 2);
        const hub = new Subject<number>();
        const b = Signal.from(hub, { default: 0 });
        const hold = b.obs.subscribe();
        const v = Signal.compute(() => (x() > 1 ? join(b(), c()) : "-"));
        const vLog = record(v.obs);
        const eff = effectLog(() => v());
        hub.next(3);
        const feed = c.obs
            .pipe(
                skip(1),
                map((y) => y + 1),
            )
            .subscribe(hub);

        x.set(2);

        expect(v.peek()).toBe(join(b.peek(), c.peek()));
        expect(v.peek()).toBe("5|4");
        expect(eff.values.at(-1)).toBe("5|4");
        feed.unsubscribe();
        hold.unsubscribe();
        vLog.unsubscribe();
        eff.unsubscribe();
    });
});

describe("bridge: consecutive gate rounds", () => {
    it("a subscription that fed a receiver before a retry still orders its node first", () => {
        const a = Signal.state(0);
        const r1 = Signal.from(
            a.obs.pipe(
                map((v) => {
                    if (v === 1) throw new Error("boom");
                    return v;
                }),
            ),
            { keepAlive: "forever" },
        );
        const r2 = Signal.from(r1.obs.pipe(retry(1)), { keepAlive: "forever" });
        const x = Signal.compute(() => {
            let v: number | string;
            try {
                v = r2();
            } catch {
                v = "err";
            }
            return `${a()}:${v}`;
        });
        const seen: string[] = [];
        const sub = x.obs.subscribe((v) => seen.push(v));
        a.set(1);
        seen.length = 0;

        a.set(2);

        expect(seen).toEqual(["2:2"]);
        sub.unsubscribe();
    });

    it("a pending node marked again while the gate refreshes is refreshed before the next round", () => {
        const t = Signal.state(0);
        const s = Signal.state(1);
        let a: DisposableSignal<number> | undefined;
        const r = Signal.from(
            Signal.compute(() => a!())
                .obs.pipe(filter((v) => v === 1))
                .pipe(map((v) => v * 100)),
            { default: 0, keepAlive: "forever" },
        );
        const r2 = Signal.from(Signal.state(2).obs, { keepAlive: "forever" });
        a = Signal.compute(() => (s() ? t() : t() + r() + r2()));
        const d = Signal.compute(() => t() + r());
        // Its refresh writes s, which changes a's dependencies.
        const b = Signal.compute(() => {
            const v = t();
            if (v === 1) s.set(1);
            return v;
        });
        const log: string[] = [];
        const subs = [
            a.obs.subscribe((v) => log.push(`a ${v}`)),
            d.obs.subscribe((v) => log.push(`d ${v}`)),
            b.obs.subscribe((v) => log.push(`b ${v}`)),
        ];
        s.set(0);
        log.length = 0;

        t.set(1);

        expect(log).toEqual(["b 1", "a 1", "d 101"]);
        subs.forEach((sub) => sub.unsubscribe());
    });
});
