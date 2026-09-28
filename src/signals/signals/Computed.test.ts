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

        it("an unrelated read of the same computed after the error works", () => {
            const source = Signal.state(1);
            const a = Computed.create(() => source() * 2, "A");
            const bad: DisposableSignal<number> = Computed.create(() => a() + bad(), "Bad");

            expect(() => bad.peek()).toThrow("Bad → Bad");
            expect(a.peek()).toBe(2);
        });
    });
});
