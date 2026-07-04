import { Batcher, SourceSignal } from "../base";

import { Effect } from "./Effect";
import { Signal } from "./Signal";

describe("Effect", () => {
    describe("auto-tracking", () => {
        it("effectFn executes immediately on creation", () => {
            const fn = vi.fn();
            const eff = Signal.effect(fn);

            expect(fn).toHaveBeenCalledTimes(1);
            eff.unsubscribe();
        });

        it("reading signal inside fn tracks dependency", () => {
            const count = Signal.state(0);
            const values: number[] = [];

            const eff = Signal.effect(() => {
                values.push(count());
            });

            expect(values).toEqual([0]);

            count.set(1);
            expect(values).toEqual([0, 1]);

            eff.unsubscribe();
        });

        it("dependency change triggers re-run", () => {
            const name = Signal.state("Alice");
            const fn = vi.fn(() => {
                name();
            });

            const eff = Signal.effect(fn);
            expect(fn).toHaveBeenCalledTimes(1);
            fn.mockClear();

            name.set("Bob");
            expect(fn).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });
    });

    describe("dynamic dependencies", () => {
        it("tracks different signals based on runtime condition", () => {
            const toggle = Signal.state(true);
            const a = Signal.state("A");
            const b = Signal.state("B");
            const values: string[] = [];

            const eff = Signal.effect(() => {
                values.push(toggle() ? a() : b());
            });

            expect(values).toEqual(["A"]);

            // A change triggers (tracked)
            a.set("A2");
            expect(values).toEqual(["A", "A2"]);

            // B change does NOT trigger (not tracked)
            b.set("B2");
            expect(values).toEqual(["A", "A2"]);

            // Switch branch — now tracks B, drops A
            toggle.set(false);
            expect(values).toEqual(["A", "A2", "B2"]);

            // A change does NOT trigger anymore
            a.set("A3");
            expect(values).toEqual(["A", "A2", "B2"]);

            // B change triggers
            b.set("B3");
            expect(values).toEqual(["A", "A2", "B2", "B3"]);

            eff.unsubscribe();
        });
    });

    describe("teardown", () => {
        it("returned function is called before re-run", () => {
            const count = Signal.state(0);
            const teardowns: number[] = [];

            const eff = Signal.effect(() => {
                const val = count();
                return () => {
                    teardowns.push(val);
                };
            });

            expect(teardowns).toEqual([]); // not called yet

            count.set(1);
            // Teardown from run #0 called before re-run
            expect(teardowns).toEqual([0]);

            count.set(2);
            expect(teardowns).toEqual([0, 1]);

            eff.unsubscribe();
        });

        it("each re-run calls previous cleanup (chain teardown)", () => {
            const count = Signal.state(0);
            const log: string[] = [];

            const eff = Signal.effect(() => {
                const v = count();
                log.push(`run:${v}`);
                return () => {
                    log.push(`teardown:${v}`);
                };
            });

            expect(log).toEqual(["run:0"]);

            count.set(1);
            expect(log).toEqual(["run:0", "teardown:0", "run:1"]);

            count.set(2);
            expect(log).toEqual(["run:0", "teardown:0", "run:1", "teardown:1", "run:2"]);

            eff.unsubscribe();
        });

        it("last teardown is called on unsubscribe()", () => {
            const count = Signal.state(0);
            const teardowns: number[] = [];

            const eff = Signal.effect(() => {
                const val = count();
                return () => {
                    teardowns.push(val);
                };
            });

            count.set(1);
            count.set(2);
            expect(teardowns).toEqual([0, 1]);

            eff.unsubscribe();
            // Final teardown from run #2
            expect(teardowns).toEqual([0, 1, 2]);
        });
    });

    describe("unsubscribe / lifecycle", () => {
        it("unsubscribe() stops further re-runs", () => {
            const count = Signal.state(0);
            const fn = vi.fn(() => {
                count();
            });

            const eff = Signal.effect(fn);
            expect(fn).toHaveBeenCalledTimes(1);
            fn.mockClear();

            eff.unsubscribe();
            expect(eff.closed).toBe(true);

            count.set(1);
            expect(fn).not.toHaveBeenCalled();
        });

        it("double unsubscribe() does not throw", () => {
            const eff = Signal.effect(() => {});
            eff.unsubscribe();
            expect(() => eff.unsubscribe()).not.toThrow();
        });
    });

    describe("batching", () => {
        it("multiple updates in Batcher.run() → effect re-runs once", () => {
            const a = Signal.state(1);
            const b = Signal.state(2);
            const values: number[] = [];

            const eff = Signal.effect(() => {
                values.push(a() + b());
            });

            expect(values).toEqual([3]);

            Batcher.run(() => {
                a.set(10);
                b.set(20);
            });

            expect(values).toEqual([3, 30]);

            eff.unsubscribe();
        });
    });

    describe("edge cases", () => {
        it("effect without dependencies runs once and never re-runs", () => {
            const fn = vi.fn();
            const eff = Signal.effect(fn);

            expect(fn).toHaveBeenCalledTimes(1);

            // Nothing can trigger re-run
            eff.unsubscribe();
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("error in effectFn on construction propagates", () => {
            expect(() => {
                Signal.effect(() => {
                    throw new Error("boom");
                });
            }).toThrow("boom");
        });

        it("error in effectFn during re-run propagates from set()", () => {
            let shouldThrow = false;
            const count = Signal.state(0);

            const eff = Signal.effect(() => {
                count();
                if (shouldThrow) throw new Error("re-run-error");
            });

            shouldThrow = true;
            expect(() => count.set(1)).toThrow("re-run-error");

            // Batcher is still functional after error (try/finally fix)
            expect(Batcher.run(() => "ok")).toBe("ok");
        });
    });

    describe("error recovery", () => {
        // Активные (не отписанные) подписки на источник — способ увидеть утечку снаружи
        const createCountingSource = () => {
            const counter = { active: 0 };
            const src = SourceSignal.create<number>((subscriber) => {
                counter.active += 1;
                subscriber.next(1);
                return () => {
                    counter.active -= 1;
                };
            });
            return { src, counter };
        };

        it("read outside tracked context is not captured after construction error", () => {
            const { src, counter } = createCountingSource();

            expect(() =>
                Signal.effect(() => {
                    throw new Error("boom");
                }),
            ).toThrow("boom");

            // Plain read with no tracked context — the dead effect's handler must not capture it
            src();
            expect(counter.active).toBe(0);
        });

        it("unsubscribes dependencies collected before construction error", () => {
            const { src, counter } = createCountingSource();

            expect(() =>
                Signal.effect(() => {
                    src();
                    throw new Error("boom");
                }),
            ).toThrow("boom");

            expect(counter.active).toBe(0);
        });

        it("signal change after construction error neither throws nor re-runs effectFn", () => {
            const count = Signal.state(0);
            const fn = vi.fn(() => {
                count();
                throw new Error("boom");
            });

            expect(() => Signal.effect(fn)).toThrow("boom");
            expect(fn).toHaveBeenCalledTimes(1);

            expect(() => count.set(1)).not.toThrow();
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it("disposes the effect when effectFn throws during re-run", () => {
            let shouldThrow = false;
            const count = Signal.state(0);
            const fn = vi.fn(() => {
                count();
                if (shouldThrow) throw new Error("re-run-error");
            });

            const eff = Signal.effect(fn);
            expect(fn).toHaveBeenCalledTimes(1);

            shouldThrow = true;
            expect(() => count.set(1)).toThrow("re-run-error");
            expect(eff.closed).toBe(true);

            // Dead effect never re-runs again
            shouldThrow = false;
            fn.mockClear();
            expect(() => count.set(2)).not.toThrow();
            expect(fn).not.toHaveBeenCalled();

            expect(() => eff.unsubscribe()).not.toThrow();
        });

        it("unsubscribes stale subscriptions of the previous run on re-run error", () => {
            const { src, counter } = createCountingSource();
            const trigger = Signal.state(0);
            let shouldThrow = false;

            Signal.effect(() => {
                trigger();
                if (shouldThrow) throw new Error("re-run-error");
                src();
            });

            expect(counter.active).toBe(1);

            shouldThrow = true;
            expect(() => trigger.set(1)).toThrow("re-run-error");

            // Both the re-tracked and the not-yet-re-tracked subscriptions are released
            expect(counter.active).toBe(0);
        });

        it("previous teardown is not called twice after re-run error", () => {
            const count = Signal.state(0);
            const teardown = vi.fn();
            let shouldThrow = false;

            const eff = Signal.effect(() => {
                count();
                if (shouldThrow) throw new Error("re-run-error");
                return teardown;
            });

            shouldThrow = true;
            expect(() => count.set(1)).toThrow("re-run-error");
            expect(teardown).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
            expect(teardown).toHaveBeenCalledTimes(1);
        });

        it("outer effect keeps tracking after a nested effect throws on construction", () => {
            const a = Signal.state(1);
            const values: number[] = [];

            const eff = Signal.effect(() => {
                try {
                    Signal.effect(() => {
                        throw new Error("inner-boom");
                    });
                } catch {
                    // Suppressed — the outer effect keeps running
                }
                values.push(a());
            });

            expect(values).toEqual([1]);

            // a() read after the catch must be tracked by the outer effect
            a.set(2);
            expect(values).toEqual([1, 2]);

            eff.unsubscribe();
        });

        it("re-run scheduled in a batch does not execute after unsubscribe", () => {
            const count = Signal.state(0);
            const fn = vi.fn(() => {
                count();
            });

            const eff = Signal.effect(fn);
            fn.mockClear();

            Batcher.run(() => {
                count.set(1);
                eff.unsubscribe();
            });

            expect(fn).not.toHaveBeenCalled();
        });
    });
});
