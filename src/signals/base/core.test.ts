import { config, map, Observable, Subject, Subscriber, tap } from "rxjs";

import { Batcher, Signal, SignalCycleError, SourceSignal, unstable_KeyedSignal } from "@/index";

/** A raw subscriber: unlike `subscribe(fn)`, RxJS does not catch what its `next` throws. */
class ThrowingSubscriber extends Subscriber<number> {
    constructor(private readonly _when: number) {
        super();
    }

    protected override _next(value: number): void {
        if (value === this._when) throw new Error(`next ${value}`);
    }
}

describe("engine robustness", () => {
    it("a State.obs subscriber that throws out of the engine fails the write, and later writes still flush", () => {
        const s = Signal.state(0);
        const after: number[] = [];
        s.obs.subscribe(new ThrowingSubscriber(1));
        const sub = s.obs.subscribe((v) => after.push(v));

        expect(() => s.set(1)).toThrow("next 1");
        expect(after).toEqual([0, 1]);

        const t = Signal.state(0);
        const seen: number[] = [];
        const effect = Signal.effect(() => {
            seen.push(t());
        });
        t.set(1);

        expect(seen).toEqual([0, 1]);
        effect.unsubscribe();
        sub.unsubscribe();
    });

    it("the same inside Batcher.run: the batch rethrows the error after its reactions", () => {
        const s = Signal.state(0);
        const t = Signal.state(0);
        const seen: number[] = [];
        const effect = Signal.effect(() => {
            seen.push(t());
        });
        s.obs.subscribe(new ThrowingSubscriber(1));

        expect(() =>
            Batcher.run(() => {
                s.set(1);
                t.set(1);
            }),
        ).toThrow("next 1");
        expect(seen).toEqual([0, 1]);

        t.set(2);
        expect(seen).toEqual([0, 1, 2]);
        effect.unsubscribe();
    });

    it("many .obs watchers in one flush are no cycle, and all keep receiving", () => {
        const s = Signal.state(0);
        let got = 0;
        const subs = Array.from({ length: 2500 }, (_, i) => Signal.compute(() => s() + i).obs.subscribe(() => got++));
        got = 0;

        expect(() => s.set(1)).not.toThrow();
        expect(got).toBe(2500);
        got = 0;
        s.set(2);
        expect(got).toBe(2500);
        subs.forEach((sub) => sub.unsubscribe());
    });

    describe("a wide acyclic graph is no cycle, whatever its width", () => {
        const WIDTH = 3000;

        it("readers of their own bridge, observed through .obs", () => {
            const head = Signal.state(0);
            let got = 0;
            const subs = Array.from({ length: WIDTH }, (_, j) => {
                const b = Signal.from(Signal.state(j).obs.pipe(map((v) => v * 2)));
                return Signal.compute(() => head() + b()).obs.subscribe(() => got++);
            });
            got = 0;

            expect(() => head.set(1)).not.toThrow();
            expect(got).toBe(WIDTH);
            subs.forEach((sub) => sub.unsubscribe());
        });

        it("the same readers drained by a read inside a batch", () => {
            const head = Signal.state(0);
            const readers = Array.from({ length: WIDTH }, (_, j) => {
                const b = Signal.from(Signal.state(j).obs.pipe(map((v) => v * 2)));
                return Signal.compute(() => head() + b());
            });
            const subs = readers.map((r) => r.obs.subscribe());

            let read: number | undefined;
            expect(() =>
                Batcher.run(() => {
                    head.set(1);
                    read = readers[WIDTH - 1]();
                }),
            ).not.toThrow();
            expect(read).toBe(1 + 2 * (WIDTH - 1));
            subs.forEach((sub) => sub.unsubscribe());
        });

        it("effects each writing a state observed through .obs", () => {
            const head = Signal.state(0);
            let got = 0;
            const subs = Array.from({ length: WIDTH }, () => {
                const s = Signal.state(0);
                const sub = Signal.compute(() => s()).obs.subscribe(() => got++);
                const effect = Signal.effect(() => s.set(head()));
                return { unsubscribe: () => (sub.unsubscribe(), effect.unsubscribe()) };
            });
            got = 0;

            expect(() => head.set(1)).not.toThrow();
            expect(got).toBe(WIDTH);
            subs.forEach((sub) => sub.unsubscribe());
        });

        it("bridges recovering from an error that arrived through a delivery", () => {
            const head = Signal.state(0);
            const bridges = Array.from({ length: WIDTH }, () =>
                Signal.from(
                    Signal.compute(() => head()).obs.pipe(
                        map((v) => {
                            if (v === 1) throw new Error("odd");
                            return v;
                        }),
                    ),
                ),
            );
            const values: number[] = [];
            const subs = bridges.map((b) =>
                Signal.compute(() => {
                    try {
                        return b();
                    } catch {
                        return -1;
                    }
                }).obs.subscribe((v) => values.push(v)),
            );
            expect(() => head.set(1)).not.toThrow();
            expect(values.filter((v) => v === -1)).toHaveLength(WIDTH);

            expect(() => head.set(2)).not.toThrow();
            expect(values.filter((v) => v === 2)).toHaveLength(WIDTH);
            subs.forEach((sub) => sub.unsubscribe());
        });
    });

    it("an evaluation keeps exactly the sources it read, whatever their order, repeats and drops", () => {
        const live = new Set<string>();
        const source = (name: string) =>
            SourceSignal.create<number>((subscriber) => {
                live.add(name);
                subscriber.next(0);
                return () => live.delete(name);
            });
        const a = source("a");
        const b = source("b");
        const c = source("c");
        const plan = Signal.state<string[]>(["a", "b", "c"]);
        const byName: Record<string, () => number> = { a, b, c };
        let runs = 0;
        const effect = Signal.effect(() => {
            runs++;
            for (const name of plan()) byName[name]();
        });
        const sources = () => [...live].sort().join();

        expect(sources()).toBe("a,b,c");
        for (const [order, expected] of [
            [["a", "b", "c"], "a,b,c"],
            [["a", "b"], "a,b"],
            [["b", "a", "c"], "a,b,c"],
            [["b", "a", "b", "a"], "a,b"],
            [["c", "c", "a"], "a,c"],
            [["a", "c", "b", "c"], "a,b,c"],
            [[], ""],
            [["b"], "b"],
        ] as const) {
            plan.set([...order]);
            expect(sources()).toBe(expected);
        }
        expect(runs).toBe(9);
        effect.unsubscribe();
        expect(sources()).toBe("");
    });

    it("a throwing upstream teardown is reported, and the effect keeps its other dependencies", () => {
        const reported: unknown[] = [];
        const previous = config.onUnhandledError;
        config.onUnhandledError = (error) => reported.push(error);
        try {
            const bad = SourceSignal.create<number>((subscriber) => {
                subscriber.next(1);
                return () => {
                    throw new Error("teardown");
                };
            });
            const other = { active: 0 };
            const good = SourceSignal.create<number>((subscriber) => {
                other.active++;
                subscriber.next(2);
                return () => other.active--;
            });
            const x = Signal.state(0);
            const useBad = Signal.state(true);
            const seen: number[] = [];
            const effect = Signal.effect(() => {
                seen.push(x());
                if (useBad()) bad();
                good();
            });

            useBad.set(false);
            x.set(1);
            x.set(2);

            expect(seen).toEqual([0, 0, 1, 2]);
            expect(reported).toHaveLength(1);
            useBad.set(true);
            effect.unsubscribe();
            expect(other.active).toBe(0);
        } finally {
            config.onUnhandledError = previous;
        }
    });

    it("an error of a batch the loop limit ended does not leak into a later write", () => {
        const k = unstable_KeyedSignal.state<number>({ a: 0 });
        const boom = new Error("boom");
        let thrown = false;
        const e1 = Signal.effect(() => {
            const v = k.get$("a") ?? 0;
            if (v === 150 && !thrown) {
                thrown = true;
                throw boom;
            }
            try {
                k.set("b", v + 1);
            } catch {
                // the loop limit refuses writes
            }
        });
        let on = false;
        const e2 = Signal.effect(() => {
            const v = k.get$("b") ?? 0;
            if (!on) return;
            try {
                k.set("a", v + 1);
            } catch {
                // the loop limit refuses writes
            }
        });
        on = true;

        expect(() => k.set("a", 100)).toThrow();
        e1.unsubscribe();
        e2.unsubscribe();

        expect(() => Signal.state(0).set(1)).not.toThrow();
    });

    it("RxJS callbacks run outside the tracking of the effect whose write triggered them", () => {
        const s = Signal.state(0);
        const a = Signal.state(0);
        const b = Signal.state(0);
        const c = Signal.compute(() => s() * 2);
        const sub1 = s.obs.subscribe(() => b());
        const sub2 = c.obs.pipe(map((v) => v + b())).subscribe();
        const runs = vi.fn();
        const effect = Signal.effect(() => {
            runs();
            s.set(a() + 1);
        });
        Batcher.run(() => a.set(1));
        runs.mockClear();

        b.set(1);

        expect(runs).not.toHaveBeenCalled();
        effect.unsubscribe();
        sub1.unsubscribe();
        sub2.unsubscribe();
    });

    it("a loop through effects, started by a write, throws SignalCycleError from it", () => {
        const a = Signal.state(0);
        const b = Signal.state(0);
        let on = false;
        const e1 = Signal.effect(() => b.set(a() + 1));
        const e2 = Signal.effect(() => {
            const v = b();
            if (on) a.set(v + 1);
        });
        on = true;

        let thrown: unknown;
        try {
            a.set(100);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(SignalCycleError);
        e1.unsubscribe();
        e2.unsubscribe();
    });

    it("an upstream that fails on every subscribe is retried per read, not in a loop", () => {
        let subscribes = 0;
        const f = Signal.from(
            new Observable<number>((subscriber) => {
                subscribes++;
                subscriber.error(new Error("parse"));
            }),
        );
        const c = Signal.compute(() => f() + 1);
        const errors: unknown[] = [];
        const sub = c.obs.subscribe({ error: (e) => errors.push(e) });
        const effect = Signal.effect(() => {
            try {
                c();
            } catch {
                // handled
            }
        });

        expect(errors).toHaveLength(1);
        expect(subscribes).toBeLessThan(10);
        effect.unsubscribe();
        sub.unsubscribe();
    });

    it("an effect error during a new subscription is not that subscriber's error", () => {
        const reported: unknown[] = [];
        const previous = config.onUnhandledError;
        config.onUnhandledError = (error) => reported.push(error);
        try {
            const t = Signal.state(0);
            const effect = Signal.effect(() => {
                if (t() === 1) throw new Error("eff");
            });
            const f = Signal.from(
                new Observable<number>((subscriber) => {
                    t.set(1);
                    subscriber.next(5);
                }),
            );
            const values: number[] = [];
            const errors: unknown[] = [];
            const sub = f.obs.subscribe({ next: (v) => values.push(v), error: (e) => errors.push(e) });

            expect(values).toEqual([5]);
            expect(errors).toEqual([]);
            expect(reported).toHaveLength(1);
            sub.unsubscribe();
            effect.unsubscribe();
        } finally {
            config.onUnhandledError = previous;
        }
    });

    it("a bridge recovers within the batch that changed its source, with no other receiver live", () => {
        const a = Signal.state(0);
        const b = Signal.from(
            a.obs.pipe(
                map((v) => {
                    if (v === 5) throw new Error("bad");
                    return v * 10;
                }),
            ),
        );
        const values: number[] = [];
        const errors: unknown[] = [];
        const sub = b.obs.subscribe({ next: (v) => values.push(v), error: (e) => errors.push(e) });
        let inside: unknown;

        Batcher.run(() => {
            a.set(5);
            a.set(4);
            inside = b();
        });

        expect(inside).toBe(40);
        expect(values).toEqual([0, 40]);
        expect(errors).toEqual([]);
        sub.unsubscribe();
    });

    it("a disposed computed still computes on read", () => {
        const s = Signal.state(1);
        const c = Signal.compute(() => s() * 2);
        expect(c()).toBe(2);

        c.dispose();

        expect(c()).toBe(2);
        s.set(2);
        expect(c()).toBe(4);
    });

    it("dispose() inside the upstream subscribe function releases the upstream", () => {
        let torn = 0;
        const f: ReturnType<typeof Signal.from<number>> = Signal.from(
            new Observable<number>((subscriber) => {
                subscriber.next(1);
                f.dispose();
                return () => torn++;
            }),
            { default: 0 },
        );

        f();

        expect(torn).toBe(1);
    });

    it("a teardown of an effect disposed inside another effect is not tracked by it", () => {
        const x = Signal.state(0);
        const s = Signal.state(0);
        const a = Signal.effect(() => () => {
            x();
        });
        let runs = 0;
        const b = Signal.effect(() => {
            runs++;
            if (s() === 0) a.unsubscribe();
        });

        x.set(1);

        expect(runs).toBe(1);
        b.unsubscribe();
    });

    it("a loop through .obs callbacks throws SignalCycleError from the write", () => {
        const s1 = Signal.state(0);
        const s2 = Signal.state(0);
        let on = false;
        const subs = [
            Signal.compute(() => s1()).obs.subscribe((v) => on && s2.set(v + 1)),
            Signal.compute(() => s2()).obs.subscribe((v) => on && s1.set(v + 1)),
        ];
        on = true;

        expect(() => s1.set(1000)).toThrow(SignalCycleError);
        subs.forEach((sub) => sub.unsubscribe());
    });

    it("a read inside a batch drains .obs deliveries only if a receiver can change what it reads", () => {
        const keep = Signal.from(new Subject<number>(), { default: 0 }).obs.subscribe();
        const s = Signal.state(0);
        const c = Signal.compute(() => s());
        const u = Signal.compute(() => 42);
        u.peek();
        const values: number[] = [];
        const sub = c.obs.subscribe((v) => values.push(v));

        Batcher.run(() => {
            s.set(1);
            u.peek();
            s.set(2);
        });

        expect(values).toEqual([0, 2]);
        sub.unsubscribe();
        keep.unsubscribe();
    });

    it("a disposed observed computed recomputing to the same value wakes nobody", () => {
        const s = Signal.state(0);
        const c = Signal.compute(() => s() % 2);
        let runs = 0;
        const effect = Signal.effect(() => {
            runs++;
            c();
        });

        c.dispose();
        s.set(2);

        expect(runs).toBe(1);
        effect.unsubscribe();
    });

    describe.each([
        ["State", () => Signal.state(0)],
        ["Computed", () => Signal.compute(() => 0)],
    ] as const)("%s.obs subscribers", (_, create) => {
        it("unsubscribe one by one in linear time", () => {
            const signal = create();
            const subs = Array.from({ length: 40000 }, () => signal.obs.subscribe(() => {}));

            const start = performance.now();
            for (const sub of subs) sub.unsubscribe();

            expect(performance.now() - start).toBeLessThan(500);
        });
    });

    it("a loop through writes inside bridge chains throws SignalCycleError from the write, and the engine keeps working", () => {
        const a = Signal.state(0);
        const b = Signal.state(0);
        let on = false;
        const fa = Signal.from(a.obs.pipe(tap((v) => on && b.set(v + 1))));
        const fb = Signal.from(b.obs.pipe(tap((v) => on && a.set(v + 1))));
        const subs = [fa.obs.subscribe({ error: () => {} }), fb.obs.subscribe({ error: () => {} })];
        on = true;

        expect(() => a.set(1)).toThrow(SignalCycleError);
        on = false;
        subs.forEach((sub) => sub.unsubscribe());

        const t = Signal.state(0);
        const seen: number[] = [];
        const effect = Signal.effect(() => {
            seen.push(t());
        });
        t.set(1);
        expect(seen).toEqual([0, 1]);
        effect.unsubscribe();
    });

    it("a subscriber that leaves and one that joins during a delivery leave the upstream released at the end", () => {
        const subject = new Subject<number>();
        const f = Signal.from(subject, { default: 0, keepAlive: "none" });
        let second: { unsubscribe(): void } | undefined;
        const first = f.obs.subscribe((v) => {
            if (v !== 1) return;
            first.unsubscribe();
            second = f.obs.subscribe(() => {});
        });

        subject.next(1);
        second!.unsubscribe();

        expect(subject.observed).toBe(false);
    });

    it("subscribers that stay get every value, whoever leaves and when", () => {
        for (const kind of ["state", "computed"]) {
            const s = Signal.state(0);
            const signal = kind === "state" ? s : Signal.compute(() => s());
            const got: number[][] = [];
            const subs = Array.from({ length: 10 }, (_, i) => {
                got.push([]);
                return signal.obs.subscribe((v) => {
                    got[i].push(v);
                    if (v === 2 && i === 0) for (let j = 1; j < 10; j += 2) subs[j].unsubscribe();
                });
            });
            for (let j = 2; j < 10; j += 4) subs[j].unsubscribe();

            s.set(s.peek() + 1);
            s.set(s.peek() + 1);
            s.set(s.peek() + 1);

            const kept = got.filter((_, i) => i % 2 === 0 && i % 4 !== 2).map((values) => values.at(-1));
            expect(kept).toEqual(Array(kept.length).fill(s.peek()));
            expect(got[1].at(-1)).toBe(1);
            subs.forEach((sub) => sub.unsubscribe());
        }
    });

    it("a computed observed again while it lets its sources go stays subscribed to all of them", () => {
        const closed = Signal.state(false);
        const src = SourceSignal.create<number>((subscriber) => {
            subscriber.next(1);
            // an upstream teardown that writes a state
            return () => closed.set(true);
        });
        const other = Signal.state(10);
        const c = Signal.compute(() => src() + other());
        const sub = c.obs.subscribe();
        const seen: number[] = [];
        const effect = Signal.effect(() => {
            if (closed()) seen.push(c());
        });

        sub.unsubscribe();
        other.set(20);

        expect(seen).toEqual([11, 21]);
        effect.unsubscribe();
    });

    describe("dispose() completes .obs subscribers after the value they are due", () => {
        const log = (into: unknown[], tag: string) => ({
            next: (v: unknown) => into.push(`${tag}${String(v)}`),
            complete: () => into.push(`${tag}C`),
        });

        function arrange(kind: "state" | "computed" | "from") {
            const s = Signal.state(1);
            const subject = new Subject<number>();
            const signal =
                kind === "state"
                    ? s
                    : kind === "computed"
                      ? Signal.compute(() => s() * 10)
                      : Signal.from(subject, { default: 0, keepAlive: "forever" });
            const write = (v: number) => (kind === "from" ? subject.next(v * 10) : s.set(v));
            return { signal, write };
        }

        it.each(["state", "computed", "from"] as const)(
            "%s: disposed from the first of two subscribers, both get the value, then complete",
            (kind) => {
                const { signal, write } = arrange(kind);
                const got: unknown[] = [];
                signal.obs.subscribe({
                    next: (v) => {
                        got.push(`a${v}`);
                        if (v === 20 || v === 2) signal.dispose();
                    },
                    complete: () => got.push("aC"),
                });
                signal.obs.subscribe(log(got, "b"));
                got.length = 0;

                expect(() => write(2)).not.toThrow();

                const v = kind === "state" ? 2 : 20;
                expect(got).toEqual([`a${v}`, `b${v}`, "aC", "bC"]);
            },
        );

        it.each(["computed", "from"] as const)(
            "%s: a write, then dispose() inside one batch: the value, then complete",
            (kind) => {
                const { signal, write } = arrange(kind);
                const got: unknown[] = [];
                signal.obs.subscribe(log(got, ""));
                got.length = 0;

                Batcher.run(() => {
                    write(5);
                    signal.dispose();
                });

                expect(got).toEqual(["50", "C"]);
            },
        );

        it("complete callbacks of a signal disposed in an effect are no dependencies of the effect", () => {
            const read = Signal.state(0);
            const c = Signal.compute(() => 1);
            c.obs.subscribe({ complete: () => read() });
            let runs = 0;
            const effect = Signal.effect(() => {
                runs++;
                c.dispose();
            });

            read.set(1);

            expect(runs).toBe(1);
            effect.unsubscribe();
        });

        it("a Signal.from teardown that reads the signal does not subscribe the upstream again", () => {
            let subscriptions = 0;
            const signal: ReturnType<typeof Signal.from<number>> = Signal.from(
                new Observable<number>((subscriber) => {
                    subscriptions++;
                    subscriber.next(1);
                    return () => signal.peek();
                }),
                { keepAlive: "forever" },
            );
            signal();

            signal.dispose();

            expect(subscriptions).toBe(1);
            expect(signal()).toBe(1);
        });
    });

    describe("an .obs subscriber of a bridge's source, subscribed before the bridge, reads the bridge current", () => {
        it("a State.obs subscriber reads the bridge", () => {
            const a = Signal.state(1);
            const b = Signal.from(a.obs.pipe(map((v) => v * 10)));
            const seen: string[] = [];
            const sub = a.obs.subscribe((v) => seen.push(`${v}:${b()}`));
            const effect = Signal.effect(() => {
                b();
            });

            a.set(2);

            expect(seen).toEqual(["1:10", "2:20"]);
            effect.unsubscribe();
            sub.unsubscribe();
        });

        it("a State.obs subscriber reads a computed over the source and the bridge", () => {
            const a = Signal.state(1);
            const b = Signal.from(a.obs.pipe(map((v) => v * 10)), { keepAlive: "forever" });
            const pair = Signal.compute(() => `${a()}:${b()}`);
            const seen: string[] = [];
            const sub = a.obs.subscribe(() => seen.push(pair()));
            b();

            a.set(2);

            expect(seen).toEqual(["1:10", "2:20"]);
            sub.unsubscribe();
            b.dispose();
        });

        it("a State.obs subscriber reads a bridge of a state that another bridge's chain wrote", () => {
            const a = Signal.state(0);
            const x = Signal.state(0);
            const ab = Signal.from(a.obs.pipe(tap((v) => x.set(v))));
            const xb = Signal.from(x.obs.pipe(map((v) => v * 10)));
            const effect = Signal.effect(() => {
                ab();
                xb();
            });
            const seen: string[] = [];
            const sub = a.obs.subscribe((v) => seen.push(`${v}:${x()}:${xb()}`));

            a.set(1);

            expect(seen.at(-1)).toBe("1:1:10");
            effect.unsubscribe();
            sub.unsubscribe();
        });

        it("a State.obs subscriber whose write starts a chain reads the bridges it wrote, and so does the next one", () => {
            const a = Signal.state(0);
            const p = Signal.state(0);
            const q = Signal.state(0);
            const pb = Signal.from(p.obs.pipe(tap((v) => q.set(v))));
            const qb = Signal.from(q.obs.pipe(map((v) => v * 10)));
            const effect = Signal.effect(() => {
                pb();
                qb();
            });
            const seen: string[] = [];
            const subs = [
                a.obs.subscribe((v) => {
                    if (!v) return;
                    p.set(v);
                    seen.push(`${q()}:${qb()}`);
                }),
                a.obs.subscribe((v) => seen.push(`${v}:${q()}:${qb()}`)),
            ];
            seen.length = 0;

            a.set(1);

            expect(seen).toEqual(["1:10", "1:1:10"]);
            effect.unsubscribe();
            subs.forEach((sub) => sub.unsubscribe());
        });

        it("a State.obs subscriber reads a bridge over a computed of the state", () => {
            const a = Signal.state(0);
            const ca = Signal.compute(() => a() + 1);
            const b = Signal.from(ca.obs.pipe(map((v) => v * 10)));
            const effect = Signal.effect(() => {
                b();
            });
            const seen: string[] = [];
            const sub = a.obs.subscribe((v) => seen.push(`${v}:${b()}`));

            a.set(1);

            expect(seen).toEqual(["0:10", "1:20"]);
            effect.unsubscribe();
            sub.unsubscribe();
        });

        it("a Computed.obs subscriber reads the bridge", () => {
            const s = Signal.state(1);
            const a = Signal.compute(() => s() + 1);
            const b = Signal.from(a.obs.pipe(map((v) => v * 10)));
            const seen: string[] = [];
            const sub = a.obs.subscribe((v) => seen.push(`${v}:${b()}`));
            const effect = Signal.effect(() => {
                b();
            });

            s.set(2);

            expect(seen).toEqual(["2:20", "3:30"]);
            effect.unsubscribe();
            sub.unsubscribe();
        });
    });

    describe("a read outside reactions inside a batch sees its writes, and leaves what observed nodes observe as it is", () => {
        function arrange() {
            const flag = Signal.state(false);
            let live = 0;
            const source = SourceSignal.create<number>((subscriber) => {
                live++;
                subscriber.next(1);
                return () => live--;
            });
            const c = Signal.compute(() => (flag() ? source() : 0));
            const effect = Signal.effect(() => {
                c();
            });
            return { flag, c, effect, live: () => live };
        }

        it("computes each observed computed once per state of the batch, however often a diamond reads it", () => {
            const a = Signal.state(0);
            let runs = 0;
            let top = Signal.compute(() => {
                runs++;
                return a() + 1;
            });
            for (let i = 0; i < 16; i++) {
                const below = top;
                top = Signal.compute(() => {
                    runs++;
                    return below() + below();
                });
            }
            const sub = top.obs.subscribe();
            let read = 0;
            let readRuns = 0;

            Batcher.run(() => {
                a.set(1);
                runs = 0;
                read = top.peek();
                top.peek();
                readRuns = runs;
            });

            expect(read).toBe(2 ** 17);
            expect(readRuns).toBe(17);
            sub.unsubscribe();
        });

        it("an observed computed recovering from an error to an equal value keeps the previous reference", () => {
            const fail = Signal.state(false);
            const c = Signal.compute(
                () => {
                    if (fail()) throw new Error("fail");
                    return { id: 1 };
                },
                { equals: (x, y) => x.id === y.id },
            );
            const effect = Signal.effect(() => {
                try {
                    c();
                } catch {
                    // observed through the error
                }
            });
            const before = c.peek();
            fail.set(true);
            let read: unknown;

            Batcher.run(() => {
                fail.set(false);
                read = c.peek();
            });

            expect(read).toBe(before);
            expect(c.peek()).toBe(before);
            effect.unsubscribe();
        });

        it("a peek of an observed computed", () => {
            const { flag, c, effect, live } = arrange();
            let read = -1;
            let liveAtRead = -1;

            Batcher.run(() => {
                flag.set(true);
                read = c.peek();
                liveAtRead = live();
                flag.set(false);
            });

            expect(read).toBe(1);
            expect(liveAtRead).toBe(0);
            expect(live()).toBe(0);
            effect.unsubscribe();
        });

        it("a peek of an observed computed through a cold one", () => {
            const { flag, c, effect, live } = arrange();
            const cold = Signal.compute(() => c());
            let read = -1;
            let liveAtRead = -1;

            Batcher.run(() => {
                flag.set(true);
                read = cold.peek();
                liveAtRead = live();
                flag.set(false);
            });

            expect(read).toBe(1);
            expect(liveAtRead).toBe(0);
            expect(live()).toBe(0);
            effect.unsubscribe();
        });

        it("a read through a cold computed neither stops nor restarts the upstream an observed computed holds", () => {
            let starts = 0;
            let stops = 0;
            const upstream = SourceSignal.create<number>((subscriber) => {
                starts++;
                subscriber.next(1);
                return () => stops++;
            });
            const flag = Signal.state(false);
            const c = Signal.compute(() => (flag() ? 0 : upstream()));
            const effect = Signal.effect(() => {
                c();
            });
            const cold = Signal.compute(() => c());
            starts = 0;

            Batcher.run(() => {
                flag.set(true);
                expect(cold.peek()).toBe(0);
                flag.set(false);
            });

            expect({ starts, stops }).toEqual({ starts: 0, stops: 0 });
            effect.unsubscribe();
        });

        it("the first value of a new .obs subscriber of an observed computed, which later writes of the batch still reach", () => {
            const { flag, c, effect } = arrange();
            const other = Signal.state(0);
            const d = Signal.compute(() => c() + other());
            const keep = d.obs.subscribe();
            const values: number[] = [];

            Batcher.run(() => {
                flag.set(true);
                d.obs.subscribe((v) => values.push(v));
                other.set(10);
            });

            expect(values).toEqual([1, 11]);
            keep.unsubscribe();
            effect.unsubscribe();
        });
    });
});
