import { Batcher } from "../base";

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

        it("deprecated complete() is equivalent to unsubscribe()", () => {
            const count = Signal.state(0);
            const fn = vi.fn(() => {
                count();
            });

            const eff = new Effect(fn);
            fn.mockClear();

            eff.complete();
            expect(eff.closed).toBe(true);

            count.set(1);
            expect(fn).not.toHaveBeenCalled();
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
});
