import { config, map, Observable, Subject } from "rxjs";

import { Batcher, Signal, SignalCycleError, SourceSignal, unstable_KeyedSignal } from "@/index";

describe("engine robustness", () => {
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
        const e2 = Signal.effect(() => {
            const v = k.get$("b") ?? 0;
            try {
                k.set("a", v + 1);
            } catch {
                // the loop limit refuses writes
            }
        });

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

    it("a loop through effects still reports SignalCycleError after the fixes", () => {
        const a = Signal.state(0);
        const b = Signal.state(0);
        const e1 = Signal.effect(() => b.set(a() + 1));
        const e2 = Signal.effect(() => a.set(b() + 1));

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
