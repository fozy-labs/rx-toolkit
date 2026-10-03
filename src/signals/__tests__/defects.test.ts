/**
 * Defects of the rank-ordered push engine that the push-pull core must fix,
 * one block per section of the defects document (.tmp/0.13.0/defects.md in
 * the main checkout). `it.fails` marks the behavior the current engine gets
 * wrong; the new core flips them to `it`.
 */
import { Batcher, Computed, Signal, SignalCycleError, type DisposableSignal } from "@/index";

import { caught, effectLog, hangGuard, record } from "./helpers";

describe("defect: a cycle in a subscribed graph is not detected", () => {
    /** `isCyclic` closes a cycle between two already subscribed computeds. */
    function createCycle(fixedPoint: boolean) {
        const isCyclic = Signal.state(false);
        const guard = hangGuard("A");
        const a: DisposableSignal<boolean> = Computed.create(() => {
            guard();
            if (!isCyclic()) return true;
            return fixedPoint ? b() : !b();
        }, "A");
        const b: DisposableSignal<boolean> = Computed.create(() => a(), "B");
        return { isCyclic, a, b, guard };
    }

    it("a cycle without a fixed point reports SignalCycleError to an .obs subscriber", () => {
        const { isCyclic, b } = createCycle(false);
        const log = record(b.obs);

        const thrown = caught(() => isCyclic.set(true));

        if (thrown !== undefined) expect(thrown).toBeInstanceOf(SignalCycleError);
        expect(log.errors).toHaveLength(1);
        expect(log.errors[0]).toBeInstanceOf(SignalCycleError);
        expect(() => b.peek()).toThrow(SignalCycleError);
    });

    it("a cycle without a fixed point throws SignalCycleError from the write that closes it (effect)", () => {
        const { isCyclic, b } = createCycle(false);
        const effect = Signal.effect(() => {
            b();
        });

        expect(caught(() => isCyclic.set(true))).toBeInstanceOf(SignalCycleError);
        effect.unsubscribe();
    });

    it("a cycle with a fixed point reports SignalCycleError too, as on the cold path", () => {
        const { isCyclic, b } = createCycle(true);
        const log = record(b.obs);

        const thrown = caught(() => isCyclic.set(true));

        if (thrown !== undefined) expect(thrown).toBeInstanceOf(SignalCycleError);
        expect(log.errors).toHaveLength(1);
        expect(log.errors[0]).toBeInstanceOf(SignalCycleError);
        expect(() => b.peek()).toThrow(SignalCycleError);
    });

    it("the cold path already reports the same cycle", () => {
        const { isCyclic, b } = createCycle(true);

        isCyclic.set(true);

        expect(() => b.peek()).toThrow(SignalCycleError);
    });

    it("both nodes of a closed cycle cool down once the last external observer leaves", () => {
        const { isCyclic, b, guard } = createCycle(true);
        const log = record(b.obs);
        caught(() => isCyclic.set(true));
        log.unsubscribe();
        const runsBefore = guard.runs();

        caught(() => isCyclic.set(false));
        caught(() => isCyclic.set(true));

        expect(guard.runs()).toBe(runsBefore);
    });
});

describe("defect: a hot computed returns a stale value", () => {
    describe("new dependency", () => {
        function createChain() {
            const src = Signal.state(1);
            const d1 = Computed.create(() => src() + 1, "D1");
            const d2 = Computed.create(() => d1() + 1, "D2");
            const d3 = Computed.create(() => d2() + 1, "D3");
            const hold = d3.obs.subscribe();
            return { src, d3, hold };
        }

        it("an effect that starts reading a deeper hot node changed by the same write sees only the fresh value", () => {
            const { src, d3 } = createChain();
            const flag = Computed.create(() => src() > 5, "FLAG");
            const log = effectLog(() => (flag() ? d3() : src()));

            src.set(10);

            expect(log.values).toEqual([1, 13]);
        });

        it("a computed that starts reading a deeper hot node changed by the same write emits only the fresh value", () => {
            const { src, d3 } = createChain();
            const flag = Computed.create(() => src() > 5, "FLAG");
            const x = Computed.create(() => (flag() ? d3() : src()), "X");
            const log = record(x.obs);

            src.set(10);

            expect(log.values).toEqual([1, 13]);
        });

        it("the same with the flag and the source as two states written in one batch", () => {
            const { src, d3 } = createChain();
            const flag = Signal.state(false);
            const log = effectLog(() => (flag() ? d3() : src()));

            Batcher.run(() => {
                src.set(10);
                flag.set(true);
            });

            expect(log.values).toEqual([1, 13]);
        });

        it("a switch of dependency and a source change in different batches is already fresh", () => {
            const { src, d3 } = createChain();
            const flag = Signal.state(false);
            const log = effectLog(() => (flag() ? d3() : src()));

            flag.set(true);
            src.set(10);

            expect(log.values).toEqual([1, 4, 13]);
        });
    });

    describe("stale rank", () => {
        function createGraph() {
            const flag = Signal.state(false);
            const src = Signal.state(1);
            const d1 = Computed.create(() => src() + 1, "D1");
            const d2 = Computed.create(() => d1() + 1, "D2");
            const d3 = Computed.create(() => d2() + 1, "D3");
            const hold = d3.obs.subscribe();
            // Same value on both branches: the switch does not change d.
            const d = Computed.create(() => (flag() ? d3() - 3 : src()), "D");
            return { flag, src, d, hold };
        }

        it("a dependent of a node whose depth grew without a value change stays consistent (computed)", () => {
            const { flag, src, d } = createGraph();
            const y = Computed.create(() => `${d()}|${src()}`, "Y");
            const log = record(y.obs);

            flag.set(true);
            src.set(10);

            expect(log.values).toEqual(["1|1", "10|10"]);
        });

        it("a dependent of a node whose depth grew without a value change stays consistent (effect)", () => {
            const { flag, src, d } = createGraph();
            const log = effectLog(() => `${d()}|${src()}`);

            flag.set(true);
            src.set(10);

            expect(log.values).toEqual(["1|1", "10|10"]);
        });
    });

    describe("read inside a batch", () => {
        it("a hot computed read inside a batch after a write to its source is fresh", () => {
            const src = Signal.state(1);
            const hot = Computed.create(() => src() * 2);
            const hold = hot.obs.subscribe();
            const cold = Computed.create(() => src() * 2);
            let reads: number[] = [];

            Batcher.run(() => {
                src.set(5);
                reads = [hot.peek(), hot(), cold.peek()];
            });

            expect(reads).toEqual([10, 10, 10]);
            hold.unsubscribe();
        });

        it("a cold computed that reads a hot one inside a batch is fresh", () => {
            const src = Signal.state(1);
            const hot = Computed.create(() => src() * 2);
            const hold = hot.obs.subscribe();
            const coldOverHot = Computed.create(() => hot() + 1);
            let read = 0;

            Batcher.run(() => {
                src.set(5);
                read = coldOverHot.peek();
            });

            expect(read).toBe(11);
            hold.unsubscribe();
        });

        it("an effect that writes a state and then reads a hot computed of it is fresh on every run", () => {
            const trigger = Signal.state(0);
            const src = Signal.state(1);
            const hot = Computed.create(() => src() * 2);
            const hold = hot.obs.subscribe();
            const seen: number[] = [];
            const effect = Signal.effect(() => {
                src.set(trigger());
                seen.push(hot.peek());
            });

            trigger.set(5);
            trigger.set(7);

            expect(seen).toEqual([0, 10, 14]);
            effect.unsubscribe();
            hold.unsubscribe();
        });

        it("the first run of such an effect, outside any batch, is already fresh", () => {
            const src = Signal.state(1);
            const hot = Computed.create(() => src() * 2);
            const hold = hot.obs.subscribe();
            const seen: number[] = [];
            const effect = Signal.effect(() => {
                src.set(3);
                seen.push(hot.peek());
            });

            expect(seen).toEqual([6]);
            effect.unsubscribe();
            hold.unsubscribe();
        });
    });
});

describe("defect: a cycle through effects is not detected", () => {
    // One effect whose write comes back through a computed: the changed
    // computed re-runs it (as in the old engine and preact), so the flush hits
    // its iteration limit and throws SignalCycleError. Hanging is the defect.
    it("one effect writing its own dependency through a computed does not hang", () => {
        const s = Signal.state(0);
        const c = Computed.create(() => s() % 2);
        const hold = c.obs.subscribe();
        const guard = hangGuard("effect");
        const effect = Signal.effect(() => {
            guard();
            c();
            s.set(s.peek() + 1);
        });

        const thrown = caught(() => s.set(10));

        expect(thrown).toBeInstanceOf(SignalCycleError);
        effect.unsubscribe();
        hold.unsubscribe();
    });

    it("two effects writing each other's state without any computed throw SignalCycleError", () => {
        const a = Signal.state(0);
        const b = Signal.state(0);
        const guard = hangGuard("effects");
        let on = false;
        const e1 = Signal.effect(() => {
            guard();
            b.set(a() + 1);
        });
        const e2 = Signal.effect(() => {
            guard();
            const v = b();
            if (on) a.set(v + 1);
        });
        on = true;

        const thrown = caught(() => a.set(100));

        expect(thrown).toBeInstanceOf(SignalCycleError);
        e1.unsubscribe();
        e2.unsubscribe();
    });

    it("an effect loop created inside Batcher.run throws SignalCycleError from the batch", () => {
        const a = Signal.state(0);
        const b = Signal.state(0);
        const guard = hangGuard("effects");
        const effects: { unsubscribe(): void }[] = [];

        const thrown = caught(() =>
            Batcher.run(() => {
                effects.push(
                    Signal.effect(() => {
                        guard();
                        b.set(a() + 1);
                    }),
                    Signal.effect(() => {
                        guard();
                        a.set(b() + 1);
                    }),
                );
            }),
        );

        expect(thrown).toBeInstanceOf(SignalCycleError);
        effects.forEach((effect) => effect.unsubscribe());
    });

    it("a converging loop through two effects settles without an error", () => {
        const a = Signal.state(0);
        const b = Signal.state(0);
        const e1 = Signal.effect(() => {
            b.set(Math.min(a() + 1, 5));
        });
        const e2 = Signal.effect(() => {
            a.set(Math.min(b() + 1, 5));
        });

        a.set(1);

        expect([a.peek(), b.peek()]).toEqual([5, 5]);
        e1.unsubscribe();
        e2.unsubscribe();
    });

    it("an effect's write to its direct dependency during its own run is ignored", () => {
        const s = Signal.state(0);
        const runs = vi.fn();
        const effect = Signal.effect(() => {
            runs();
            s.set(s() + 1);
        });

        s.set(10);

        expect(runs).toHaveBeenCalledTimes(2);
        expect(s.peek()).toBe(11);
        effect.unsubscribe();
    });
});
