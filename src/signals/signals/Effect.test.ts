import { Subject } from "rxjs";

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

        it("stays alive when effectFn throws during re-run and re-runs on the next change", () => {
            let shouldThrow = false;
            const count = Signal.state(0);
            const seen: number[] = [];
            const fn = vi.fn(() => {
                const value = count();
                if (shouldThrow) throw new Error("re-run-error");
                seen.push(value);
            });

            const eff = Signal.effect(fn);
            expect(fn).toHaveBeenCalledTimes(1);

            shouldThrow = true;
            expect(() => count.set(1)).toThrow("re-run-error");
            expect(eff.closed).toBe(false);

            shouldThrow = false;
            expect(() => count.set(2)).not.toThrow();
            expect(seen).toEqual([0, 2]);

            eff.unsubscribe();
            fn.mockClear();
            count.set(3);
            expect(fn).not.toHaveBeenCalled();
        });

        it("keeps the dependencies read before the throw and releases the ones not read again", () => {
            const { src, counter } = createCountingSource();
            const trigger = Signal.state(0);
            const other = Signal.state(0);
            let shouldThrow = false;
            const fn = vi.fn(() => {
                trigger();
                if (shouldThrow) throw new Error("re-run-error");
                src();
                other();
            });

            const eff = Signal.effect(fn);
            expect(counter.active).toBe(1);

            shouldThrow = true;
            expect(() => trigger.set(1)).toThrow("re-run-error");

            // src and other were not read in the failing run: released
            expect(counter.active).toBe(0);
            fn.mockClear();
            other.set(1);
            expect(fn).not.toHaveBeenCalled();

            // trigger was read before the throw: still tracked
            shouldThrow = false;
            trigger.set(2);
            expect(fn).toHaveBeenCalledTimes(1);
            expect(counter.active).toBe(1);

            eff.unsubscribe();
            expect(counter.active).toBe(0);
        });

        it("a re-run error does not stop the other effects of the batch; the write rethrows it", () => {
            const count = Signal.state(0);
            const before: number[] = [];
            const after: number[] = [];
            const doubled = Signal.compute(() => count() * 2);

            const effBefore = Signal.effect(() => {
                before.push(count());
            });
            const failing = Signal.effect(() => {
                if (count() === 1) throw new Error("re-run-error");
            });
            // Higher rang: runs after the failing effect in the flush
            const effAfter = Signal.effect(() => {
                after.push(doubled());
            });

            expect(() => count.set(1)).toThrow("re-run-error");
            expect(before).toEqual([0, 1]);
            expect(after).toEqual([0, 2]);

            effBefore.unsubscribe();
            failing.unsubscribe();
            effAfter.unsubscribe();
        });

        it("handles a failing computed with try/catch and sees its recovery", () => {
            const source = Signal.state(1);
            const c = Signal.compute(() => {
                if (source() < 0) throw new Error("negative");
                return source();
            });
            const log: string[] = [];

            const eff = Signal.effect(() => {
                try {
                    log.push(`value:${c()}`);
                } catch (error) {
                    log.push(`error:${(error as Error).message}`);
                }
            });

            expect(() => source.set(-1)).not.toThrow();
            source.set(2);

            expect(log).toEqual(["value:1", "error:negative", "value:2"]);

            eff.unsubscribe();
        });

        it("re-runs when a dependency stream errors instead of reporting it as unhandled", () => {
            const errors$ = new Subject<unknown>();
            const src = SourceSignal.create<number>((subscriber) => {
                subscriber.next(1);
                const sub = errors$.subscribe((error) => subscriber.error(error));
                return () => sub.unsubscribe();
            });
            const fn = vi.fn(() => {
                src();
            });

            const eff = Signal.effect(fn);
            expect(fn).toHaveBeenCalledTimes(1);

            errors$.next(new Error("stream-error"));
            expect(fn).toHaveBeenCalledTimes(2);

            // The dead subscription was dropped; the re-run tracked the signal afresh
            errors$.next(new Error("stream-error"));
            expect(fn).toHaveBeenCalledTimes(3);

            eff.unsubscribe();
            expect(errors$.observed).toBe(false);
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

        it("a throwing teardown is called once; the effect keeps running and the write rethrows", () => {
            const count = Signal.state(0);
            const seen: number[] = [];
            const teardown = vi.fn(() => {
                throw new Error("teardown-error");
            });

            const eff = Signal.effect(() => {
                seen.push(count());
                return teardown;
            });

            expect(() => count.set(1)).toThrow("teardown-error");
            expect(teardown).toHaveBeenCalledTimes(1);
            expect(seen).toEqual([0, 1]);
            expect(eff.closed).toBe(false);

            expect(() => count.set(2)).toThrow("teardown-error");
            // One call per registered teardown: run 0's and run 1's
            expect(teardown).toHaveBeenCalledTimes(2);
            expect(seen).toEqual([0, 1, 2]);

            expect(() => eff.unsubscribe()).toThrow("teardown-error");
            expect(teardown).toHaveBeenCalledTimes(3);
        });

        it("unsubscribe() with a throwing teardown releases the dependencies, then rethrows", () => {
            const { src, counter } = createCountingSource();
            const teardown = vi.fn(() => {
                throw new Error("teardown-error");
            });

            const eff = Signal.effect(() => {
                src();
                return teardown;
            });
            expect(counter.active).toBe(1);

            expect(() => eff.unsubscribe()).toThrow("teardown-error");
            expect(eff.closed).toBe(true);
            expect(counter.active).toBe(0);

            expect(() => eff.unsubscribe()).not.toThrow();
            expect(teardown).toHaveBeenCalledTimes(1);
        });

        it("a teardown that unsubscribes its own effect stops the run and leaves no subscriptions", () => {
            const { src, counter } = createCountingSource();
            const trigger = Signal.state(1);
            const c = Signal.compute(() => src() * 2);
            const body = vi.fn();

            const eff: Effect = Signal.effect(() => {
                body();
                trigger();
                c();
                return () => {
                    if (trigger.peek() === 2) eff.unsubscribe();
                };
            });
            expect(counter.active).toBe(1);

            trigger.set(2);

            expect(eff.closed).toBe(true);
            expect(body).toHaveBeenCalledTimes(1);
            expect(counter.active).toBe(0);
        });

        it("a body that unsubscribes its own effect and then reads a signal leaves no subscriptions", () => {
            const { src, counter } = createCountingSource();
            const trigger = Signal.state(0);
            const teardown = vi.fn();

            const eff: Effect = Signal.effect(() => {
                if (trigger() === 1) {
                    eff.unsubscribe();
                    src();
                }
                return teardown;
            });

            trigger.set(1);

            expect(eff.closed).toBe(true);
            expect(counter.active).toBe(0);
            // The teardown of run 0 ran before run 1; the one run 1 returned
            // after closing is called at the end of that run, not lost
            expect(teardown).toHaveBeenCalledTimes(2);
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

        it("a computed that throws on start fails the read once and synchronously", () => {
            const computeFn = vi.fn((): number => {
                throw new Error("compute-error");
            });
            const c = Signal.compute(computeFn);

            expect(() =>
                Signal.effect(() => {
                    c();
                }),
            ).toThrow("compute-error");
            expect(computeFn).toHaveBeenCalledOnce();
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

    describe("subscription reuse across runs", () => {
        it("runs once per batch when subscriptions come from different runs", () => {
            const a = Signal.state(0);
            const b = Signal.state(0);
            const toggle = Signal.state(true);
            const runs = vi.fn();

            const eff = Signal.effect(() => {
                runs();
                toggle();
                a();
                if (!toggle()) b();
            });

            // Run 2: subscriptions to toggle and a are reused from run 1,
            // subscription to b is created fresh in run 2
            toggle.set(false);
            runs.mockClear();

            Batcher.run(() => {
                a.set(1);
                b.set(1);
            });

            expect(runs).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });

        it("runs after its computed dependency and sees a consistent snapshot", () => {
            const s = Signal.state(1);
            const c = Signal.compute(() => s() * 10);
            const toggle = Signal.state(true);
            const seen: Array<[number, number]> = [];

            const eff = Signal.effect(() => {
                if (toggle()) {
                    s();
                } else {
                    seen.push([s(), c()]);
                }
            });

            // Run 2: subscription to s is reused from run 1 (rang of that run),
            // subscription to c is created fresh with the current rang
            toggle.set(false);
            expect(seen).toEqual([[1, 10]]);

            s.set(2);

            // A single consistent snapshot — no [2, 10] glitch before it
            expect(seen).toEqual([
                [1, 10],
                [2, 20],
            ]);

            eff.unsubscribe();
            c.dispose();
        });

        it("write to own dependency during run is suppressed for reused subscriptions too", () => {
            const count = Signal.state(0);
            const runs = vi.fn();

            const eff = Signal.effect(() => {
                runs();
                if (count() === 1) {
                    count.set(2);
                }
            });

            expect(runs).toHaveBeenCalledTimes(1);

            // Run 2 reuses the subscription to count from run 1 and writes to count:
            // the emission must be suppressed exactly like for a fresh subscription
            count.set(1);
            expect(runs).toHaveBeenCalledTimes(2);
            expect(count.peek()).toBe(2);

            // The subscription still reacts to external changes
            count.set(5);
            expect(runs).toHaveBeenCalledTimes(3);

            eff.unsubscribe();
        });

        it("re-runs when its write changed a computed it read earlier in the run", () => {
            const trigger = Signal.state(0);
            const x = Signal.state(0);
            const c = Signal.compute(() => x() * 10);
            const seen: number[] = [];

            const eff = Signal.effect(() => {
                trigger();
                seen.push(c());
                if (trigger() === 1 && !x.peek()) x.set(1);
            });

            trigger.set(1);

            expect(seen).toEqual([0, 0, 10]);
            eff.unsubscribe();
        });

        it("is not re-run when its write leaves a computed it read unchanged", () => {
            const trigger = Signal.state(0);
            const x = Signal.state(0);
            const positive = Signal.compute(() => x() > 0);
            const runs = vi.fn();

            const eff = Signal.effect(() => {
                runs();
                trigger();
                positive();
                if (trigger() > 0 && x.peek() < 2) x.set(x.peek() + 1);
            });
            runs.mockClear();

            // The first write flips `positive`: one more run, whose write does not.
            trigger.set(1);
            expect(runs).toHaveBeenCalledTimes(2);
            eff.unsubscribe();
        });
    });
});
