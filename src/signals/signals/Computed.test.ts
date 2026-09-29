import { retry, take } from "rxjs";

import { SharedOptions } from "@/common/options/SharedOptions";
import type { DisposableSignal } from "@/signals/types";

import { SignalCycleError } from "../base";

import { Computed } from "./Computed";
import { Signal } from "./Signal";

describe("Computed", () => {
    describe("lazy evaluation", () => {
        it("computeFn is NOT called on creation", () => {
            const fn = vi.fn(() => 42);
            Computed.create(fn);
            expect(fn).not.toHaveBeenCalled();
        });

        it("first observation triggers computation", () => {
            const fn = vi.fn(() => 42);
            const c = Computed.create(fn);

            expect(fn).not.toHaveBeenCalled();

            const values: (number | symbol)[] = [];
            const sub = c.obs.subscribe((v: number | symbol) => values.push(v));
            expect(fn).toHaveBeenCalledTimes(1);
            expect(values).toEqual([42]);
            sub.unsubscribe();
        });
    });

    describe("caching", () => {
        it("repeated reads do not re-invoke fn", () => {
            const count = Signal.state(1);
            const fn = vi.fn(() => count() * 2);
            const doubled = Computed.create(fn);

            const values: number[] = [];
            const eff = Signal.effect(() => {
                values.push(doubled());
            });
            expect(fn).toHaveBeenCalledTimes(1);
            expect(values).toEqual([2]);

            // peek() reads from active internal state — fn not called again
            expect(doubled.peek()).toBe(2);
            expect(fn).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });

        it("recomputes when dependency changes", () => {
            const count = Signal.state(1);
            const fn = vi.fn(() => count() * 2);
            const doubled = Computed.create(fn);

            const values: (number | symbol)[] = [];
            const sub = doubled.obs.subscribe((v: number | symbol) => values.push(v));
            expect(values).toEqual([2]);
            expect(fn).toHaveBeenCalledTimes(1);
            fn.mockClear();

            count.set(5);
            expect(values).toEqual([2, 10]);
            expect(fn).toHaveBeenCalledTimes(1);

            sub.unsubscribe();
        });

        it("multiple dependencies — invalidation on any", () => {
            const a = Signal.state(1);
            const b = Signal.state(10);
            const sum = Computed.create(() => a() + b());

            const values: (number | symbol)[] = [];
            const sub = sum.obs.subscribe((v: number | symbol) => values.push(v));
            expect(values).toEqual([11]);

            a.set(2);
            expect(values).toEqual([11, 12]);

            b.set(20);
            expect(values).toEqual([11, 12, 22]);

            sub.unsubscribe();
        });
    });

    describe("observable subscription", () => {
        it("subscribing to obs emits computed value and updates", () => {
            const count = Signal.state(1);
            const doubled = Computed.create(() => count() * 2);

            const values: number[] = [];
            const sub = doubled.obs.subscribe((v: number | symbol) => values.push(v as number));

            expect(values).toEqual([2]);

            count.set(3);
            expect(values).toEqual([2, 6]);

            sub.unsubscribe();
        });

        it("cleanup: unsubscribing stops reactive tracking", () => {
            const count = Signal.state(1);
            const fn = vi.fn(() => count() * 2);
            const doubled = Computed.create(fn);

            const sub = doubled.obs.subscribe(() => {});
            fn.mockClear();

            count.set(2);
            expect(fn).toHaveBeenCalled();
            fn.mockClear();

            sub.unsubscribe();

            count.set(3);
            // Internal Effect is cleaned up, fn should NOT be called
            expect(fn).not.toHaveBeenCalled();

            // Re-subscribing restarts computation
            const values: (number | symbol)[] = [];
            const sub2 = doubled.obs.subscribe((v: number | symbol) => values.push(v));
            expect(values).toEqual([6]);
            sub2.unsubscribe();
        });
    });

    describe("diamond problem (glitch-free)", () => {
        it("D sees consistent B and C when A changes", () => {
            const A = Signal.state(1);
            const B = Computed.create(() => A() * 2);
            const C = Computed.create(() => A() + 10);
            const D = Computed.create(() => B() + C());

            const values: number[] = [];
            const eff = Signal.effect(() => {
                values.push(D());
            });

            // Initial: B=2, C=11, D=13
            expect(values).toEqual([13]);

            A.set(2);
            // B=4, C=12, D=16 — D observes consistent state, fires once
            expect(values).toEqual([13, 16]);

            A.set(3);
            // B=6, C=13, D=19
            expect(values).toEqual([13, 16, 19]);

            eff.unsubscribe();
        });
    });

    describe("dispose", () => {
        afterEach(() => {
            SharedOptions.DEVTOOLS = null;
        });

        it("dispose() releases the internal state — devtools notified of completion immediately", () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const c = Computed.create(() => 42, { key: "computed-dispose" });

            // Materialize the internal devtools entry by observing a real value.
            const sub = c.obs.subscribe(() => {});
            sub.unsubscribe();
            expect(mockCreateState).toHaveBeenCalledTimes(1);

            // Before the fix, dispose() never disposed the internal `_state$`, so its
            // onDispose hook never fired and devtools learned of completion only at GC.
            c.dispose();
            expect(mockStateFn).toHaveBeenCalledWith("$COMPLETED", undefined);
        });
    });

    describe("Object.is dedupe (NaN / ±0)", () => {
        it("Computed(() => NaN) emits NaN once, not twice", () => {
            // The obs pipeline structurally emits the initial value twice (map's
            // _start() return + the reentrant state.set); distinctUntilChanged is
            // meant to collapse that. With === it can't (NaN === NaN is false),
            // so NaN leaks through twice.
            const c = Computed.create(() => NaN);

            const values: number[] = [];
            const sub = c.obs.subscribe((v: number | symbol) => values.push(v as number));

            expect(values).toHaveLength(1);
            expect(values[0]).toBeNaN();

            sub.unsubscribe();
        });

        it("recompute +0 -> -0 is not swallowed (Object.is distinguishes signed zero)", () => {
            const sign = Signal.state(1);
            // 0 * 1 === +0, 0 * -1 === -0
            const c = Computed.create(() => 0 * sign());

            const values: number[] = [];
            const sub = c.obs.subscribe((v: number | symbol) => values.push(v as number));

            expect(values).toHaveLength(1);
            expect(Object.is(values[0], +0)).toBe(true);

            sign.set(-1);

            // === treats +0 and -0 as equal and would swallow the change
            expect(values).toHaveLength(2);
            expect(Object.is(values[1], -0)).toBe(true);

            sub.unsubscribe();
        });
    });

    describe("error handling", () => {
        it("error in computeFn propagates to obs subscriber", () => {
            const c = Computed.create(() => {
                throw new Error("compute-error");
            });

            let caughtError: any;
            c.obs.subscribe({
                next: () => {},
                error: (e: any) => {
                    caughtError = e;
                },
            });

            expect(caughtError).toBeDefined();
            expect(caughtError.message).toContain("compute-error");
        });

        it("after error, new subscription retries computation", () => {
            let shouldThrow = true;
            const c = Computed.create(() => {
                if (shouldThrow) throw new Error("fail");
                return 42;
            });

            let error1: any;
            c.obs.subscribe({
                next: () => {},
                error: (e: any) => {
                    error1 = e;
                },
            });
            expect(error1).toBeDefined();

            shouldThrow = false;
            const values: (number | symbol)[] = [];
            const sub = c.obs.subscribe((v: number | symbol) => values.push(v));
            expect(values).toEqual([42]);
            sub.unsubscribe();
        });

        it("an obs subscriber that errors on start leaves nothing subscribed", () => {
            const source = Signal.state(1);
            const computeFn = vi.fn(() => {
                source();
                throw new Error("fail");
            });
            const c = Computed.create(computeFn);

            c.obs.subscribe({ error: () => {} });
            computeFn.mockClear();

            source.set(2);
            expect(computeFn).not.toHaveBeenCalled();
        });

        it("a subscriber that leaves on the first value leaves nothing subscribed", () => {
            const source = Signal.state(1);
            const computeFn = vi.fn(() => source() * 2);
            const c = Computed.create(computeFn);

            c.obs.pipe(take(1)).subscribe();
            computeFn.mockClear();

            source.set(2);
            expect(computeFn).not.toHaveBeenCalled();
        });
    });

    describe("error state while subscribed", () => {
        function createFailing() {
            const source = Signal.state(1);
            const error = new Error("negative");
            const computeFn = vi.fn(() => {
                if (source() < 0) throw error;
                return source() * 10;
            });
            const c = Computed.create(computeFn);
            return { source, error, computeFn, c };
        }

        it("keeps the error and rethrows it on every read without recomputing", () => {
            const { source, error, computeFn, c } = createFailing();
            const eff = Signal.effect(() => {
                try {
                    c();
                } catch {
                    // handled
                }
            });

            source.set(-1);
            computeFn.mockClear();

            for (let i = 0; i < 3; i++) {
                expect(() => c.peek()).toThrow(error);
                expect(() => c()).toThrow(error);
                expect(() => c.get()).toThrow(error);
            }
            expect(computeFn).not.toHaveBeenCalled();

            eff.unsubscribe();
        });

        it("recomputes and recovers when a dependency read before the throw changes", () => {
            const gate = Signal.state(true);
            const after = Signal.state(5);
            const computeFn = vi.fn(() => {
                if (gate()) throw new Error("gated");
                return after();
            });
            const c = Computed.create(computeFn);
            const values: number[] = [];
            const errors: unknown[] = [];

            const eff = Signal.effect(() => {
                try {
                    values.push(c());
                } catch (error) {
                    errors.push(error);
                }
            });
            expect(errors).toHaveLength(1);

            gate.set(false);
            expect(values).toEqual([5]);
            expect(c.peek()).toBe(5);

            after.set(6);
            expect(values).toEqual([5, 6]);

            eff.unsubscribe();
        });

        it("notifies dependent effects on entering and leaving the error state", () => {
            const { source, c } = createFailing();
            const log: string[] = [];

            const eff = Signal.effect(() => {
                try {
                    log.push(`value:${c()}`);
                } catch (error) {
                    log.push(`error:${(error as Error).message}`);
                }
            });

            source.set(-1);
            source.set(-2);
            source.set(3);

            // The same error thrown again is no new state: no extra run for -2
            expect(log).toEqual(["value:10", "error:negative", "value:30"]);

            eff.unsubscribe();
        });

        it("propagates the error through a dependent computed and recovers", () => {
            const { source, error, c } = createFailing();
            const plusOne = Computed.create(() => c() + 1);
            const log: unknown[] = [];

            const eff = Signal.effect(() => {
                try {
                    log.push(plusOne());
                } catch (e) {
                    log.push(e);
                }
            });

            source.set(-1);
            expect(() => plusOne.peek()).toThrow(error);
            source.set(2);

            expect(log).toEqual([11, error, 21]);

            eff.unsubscribe();
        });

        it("obs errors on entering the error state; a resubscription yields the current state", () => {
            const { source, error, c } = createFailing();
            // Keeps the computed subscribed independently of the obs subscribers
            const eff = Signal.effect(() => {
                try {
                    c();
                } catch {
                    // handled
                }
            });

            const values: number[] = [];
            const onError = vi.fn();
            c.obs.subscribe({ next: (v) => values.push(v), error: onError });

            source.set(-1);
            expect(values).toEqual([10]);
            expect(onError).toHaveBeenCalledExactlyOnceWith(error);

            const again = vi.fn();
            c.obs.subscribe({ error: again });
            expect(again).toHaveBeenCalledExactlyOnceWith(error);

            source.set(4);
            const recovered: number[] = [];
            const sub = c.obs.subscribe((v) => recovered.push(v));
            expect(recovered).toEqual([40]);

            sub.unsubscribe();
            eff.unsubscribe();
        });

        it("obs.pipe(retry()) keeps receiving values across a failure", async () => {
            const { source, c } = createFailing();
            const eff = Signal.effect(() => {
                try {
                    c();
                } catch {
                    // handled
                }
            });

            const values: number[] = [];
            const sub = c.obs.pipe(retry({ delay: () => Promise.resolve() })).subscribe((v) => values.push(v));

            source.set(-1);
            source.set(2);
            await Promise.resolve();

            expect(values).toEqual([10, 20]);

            sub.unsubscribe();
            eff.unsubscribe();
        });

        it("an obs subscriber's error does not stop the computed for its other dependents", () => {
            const { source, c } = createFailing();
            const onError = vi.fn();
            c.obs.subscribe({ error: onError });

            const log: string[] = [];
            const eff = Signal.effect(() => {
                try {
                    log.push(`value:${c()}`);
                } catch {
                    log.push("error");
                }
            });

            source.set(-1);
            expect(onError).toHaveBeenCalledOnce();
            source.set(1);
            source.set(2);

            expect(log).toEqual(["value:10", "error", "value:10", "value:20"]);

            eff.unsubscribe();
        });

        it.each([
            ["subscribed", true],
            ["unsubscribed", false],
        ])("an unsubscribed computed can catch a failing %s dependency", (_, keepSubscribed) => {
            const { source, c } = createFailing();
            source.set(-1);
            const keeper = keepSubscribed
                ? Signal.effect(() => {
                      try {
                          c();
                      } catch {
                          // handled
                      }
                  })
                : null;
            const safe = Computed.create(() => {
                try {
                    return c();
                } catch {
                    return -1;
                }
            });

            expect(safe.peek()).toBe(-1);
            expect(safe.peek()).toBe(-1);

            source.set(2);
            expect(safe.peek()).toBe(20);

            keeper?.unsubscribe();
        });

        it("an unsubscribed read of a catching computed is cached while its dependency keeps the same error", () => {
            const { source, c } = createFailing();
            source.set(-1);
            const keeper = Signal.effect(() => {
                try {
                    c();
                } catch {
                    // handled
                }
            });
            const safeFn = vi.fn(() => {
                try {
                    return c();
                } catch {
                    return -1;
                }
            });
            const safe = Computed.create(safeFn);

            safe.peek();
            safe.peek();
            expect(safeFn).toHaveBeenCalledTimes(1);

            keeper.unsubscribe();
        });

        it("starts in the error state when the first compute of a subscription throws", () => {
            const source = Signal.state(-1);
            const computeFn = vi.fn(() => {
                if (source() < 0) throw new Error("negative");
                return source();
            });
            const c = Computed.create(computeFn);
            const log: string[] = [];

            const eff = Signal.effect(() => {
                try {
                    log.push(`value:${c()}`);
                } catch {
                    log.push("error");
                }
            });

            expect(computeFn).toHaveBeenCalledOnce();
            expect(() => c.peek()).toThrow("negative");
            expect(computeFn).toHaveBeenCalledOnce();

            source.set(1);
            expect(log).toEqual(["error", "value:1"]);

            eff.unsubscribe();
        });
    });

    describe("cycles", () => {
        function createCycle() {
            const a: DisposableSignal<number> = Computed.create(() => b() + 1, "A");
            const b: DisposableSignal<number> = Computed.create(() => a() + 1, "B");
            return { a, b };
        }

        it("peek() throws SignalCycleError synchronously", () => {
            const { a } = createCycle();

            expect(() => a.peek()).toThrow(SignalCycleError);
            expect(() => a.peek()).toThrow("A → B → A");
        });

        it("repeated peek() after the error throws again instead of hanging", () => {
            const { a, b } = createCycle();

            for (let i = 0; i < 3; i++) {
                expect(() => a.peek()).toThrow(SignalCycleError);
                expect(() => b.peek()).toThrow(SignalCycleError);
            }
        });

        it("indirect cycle reports the whole chain", () => {
            const a: DisposableSignal<number> = Computed.create(() => b() + 1, "A");
            const b: DisposableSignal<number> = Computed.create(() => c() + 1, "B");
            const c: DisposableSignal<number> = Computed.create(() => a() + 1, "C");

            expect(() => a.peek()).toThrow("A → B → C → A");
            expect(() => c.peek()).toThrow("C → A → B → C");
        });

        it("anonymous computeds are named in the chain", () => {
            const a: DisposableSignal<number> = Computed.create(() => a() + 1);

            expect(() => a.peek()).toThrow("<anonymous> → <anonymous>");
        });

        it("a read inside an effect throws synchronously, with no unhandled error", () => {
            const { a } = createCycle();

            expect(() =>
                Signal.effect(() => {
                    a();
                }),
            ).toThrow(SignalCycleError);
        });

        it("an obs subscriber gets the error synchronously", () => {
            const { a } = createCycle();
            const onError = vi.fn();

            a.obs.subscribe({ error: onError });

            expect(onError).toHaveBeenCalledOnce();
            expect(onError.mock.calls[0][0]).toBeInstanceOf(SignalCycleError);
        });

        it("a cycle that appears later is reported, and the graph recovers once it is gone", () => {
            const isCyclic = Signal.state(false);
            const a: DisposableSignal<number> = Computed.create(() => (isCyclic() ? b() : 0) + 1, "A");
            const b: DisposableSignal<number> = Computed.create(() => a() + 1, "B");

            expect(b.peek()).toBe(2);
            isCyclic.set(true);
            expect(() => b.peek()).toThrow(SignalCycleError);
            isCyclic.set(false);
            expect(b.peek()).toBe(2);
        });

        // Known gap: a hot computed serves its stored value to a reader instead of recomputing,
        // so a cycle closed after subscription is never re-entered and re-runs without bound.
        it.fails("a cycle that appears in a subscribed graph is reported", () => {
            const isCyclic = Signal.state(false);
            // The engine does not stop the loop: this bound does (one error instance, so the
            // failure is no new state and the loop ends).
            const runaway = new Error("runaway");
            let runs = 0;
            const a: DisposableSignal<boolean> = Computed.create(() => {
                if (++runs > 1000) throw runaway;
                return isCyclic() ? !b() : true;
            }, "A");
            const b: DisposableSignal<boolean> = Computed.create(() => a(), "B");
            const subscription = b.obs.subscribe({ error: () => {} });

            expect(() => isCyclic.set(true)).toThrow(SignalCycleError);
            subscription.unsubscribe();
        });

        it("an unrelated read of the same computed after the error works", () => {
            const source = Signal.state(1);
            const a = Computed.create(() => source() * 2, "A");
            const bad: DisposableSignal<number> = Computed.create(() => a() + bad(), "Bad");

            expect(() => bad.peek()).toThrow("Bad → Bad");
            expect(a.peek()).toBe(2);
        });
    });

    describe("equals option", () => {
        type Parity = { parity: number };
        const byParity = (a: Parity, b: Parity) => a.parity === b.parity;

        function createParity() {
            const source = Signal.state(1);
            const computeFn = vi.fn(() => ({ parity: source() % 2 }));
            const c = Signal.compute(computeFn, { equals: byParity });
            return { source, computeFn, c };
        }

        it("an equal recompute keeps the previous reference for subscribers and peek()", () => {
            const { source, computeFn, c } = createParity();
            const values: Parity[] = [];
            const sub = c.obs.subscribe((v) => values.push(v));
            const first = c.peek();

            source.set(3);

            expect(computeFn).toHaveBeenCalledTimes(2);
            expect(values).toEqual([first]);
            expect(c.peek()).toBe(first);

            source.set(4);

            expect(values).toHaveLength(2);
            expect(c.peek()).toEqual({ parity: 0 });
            sub.unsubscribe();
        });

        it("dependents do not re-run on an equal recompute", () => {
            const { source, c } = createParity();
            const effectFn = vi.fn(() => {
                c();
            });
            const eff = Signal.effect(effectFn);

            source.set(3);
            source.set(5);

            expect(effectFn).toHaveBeenCalledTimes(1);
            eff.unsubscribe();
        });

        it("without subscribers, peek() and cold dependents see the previous reference", () => {
            const { source, c } = createParity();
            const dependentFn = vi.fn(() => c());
            const dependent = Signal.compute(dependentFn);
            const first = dependent.peek();

            source.set(3);

            expect(c.peek()).toBe(first);
            expect(dependent.peek()).toBe(first);
            expect(dependentFn).toHaveBeenCalledTimes(1);
        });

        it("keeps the reference across subscribe and unsubscribe", () => {
            const { source, c } = createParity();
            const cold = c.peek();

            const values: Parity[] = [];
            const sub = c.obs.subscribe((v) => values.push(v));
            expect(values).toEqual([cold]);

            source.set(3);
            sub.unsubscribe();
            expect(c.peek()).toBe(cold);

            source.set(5);
            const again = c.obs.subscribe((v) => values.push(v));
            expect(values).toEqual([cold, cold]);
            again.unsubscribe();
        });

        it("without equals, every recompute yields its own reference", () => {
            const source = Signal.state(1);
            const c = Signal.compute(() => ({ parity: source() % 2 }));
            const first = c.peek();

            source.set(3);

            expect(c.peek()).not.toBe(first);
        });

        it("a thrown error stays the state; the recovered value is compared with the last value", () => {
            const source = Signal.state(1);
            const error = new Error("negative");
            const equals = vi.fn(byParity);
            const c = Signal.compute(
                () => {
                    if (source() < 0) throw error;
                    return { parity: source() % 2 };
                },
                { equals },
            );
            const reads: Array<Parity | unknown> = [];
            const eff = Signal.effect(() => {
                try {
                    reads.push(c());
                } catch (caught) {
                    reads.push(caught);
                }
            });
            const first = reads[0];

            source.set(-1);
            expect(() => c.peek()).toThrow(error);
            expect(equals).not.toHaveBeenCalled();

            source.set(3);
            expect(reads).toEqual([first, error, first]);
            expect(reads[2]).toBe(first);
            eff.unsubscribe();
        });

        it("a throwing equals falls back to Object.is and logs once per throw", () => {
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
            const source = Signal.state(1);
            const failure = new Error("equals failed");
            const c = Signal.compute(() => ({ value: source() }), {
                equals: () => {
                    throw failure;
                },
            });
            const values: Array<{ value: number }> = [];
            const sub = c.obs.subscribe((v) => values.push(v));

            source.set(2);
            source.set(3);

            expect(values.map((v) => v.value)).toEqual([1, 2, 3]);
            expect(consoleError).toHaveBeenCalledTimes(2);
            expect(consoleError).toHaveBeenCalledWith(expect.any(String), failure);
            sub.unsubscribe();
            consoleError.mockRestore();
        });

        it("signals read inside equals are not dependencies", () => {
            const source = Signal.state(1);
            const unrelated = Signal.state(0);
            const computeFn = vi.fn(() => ({ parity: source() % 2 }));
            const c = Signal.compute(computeFn, {
                equals: (a, b) => {
                    unrelated();
                    return byParity(a, b);
                },
            });
            const sub = c.obs.subscribe();
            source.set(3);
            computeFn.mockClear();

            unrelated.set(1);

            expect(computeFn).not.toHaveBeenCalled();
            sub.unsubscribe();
        });
    });
});
