import { describe, it, expect, vi } from 'vitest';
import { Computed } from "./Computed";
import { Signal } from "./Signal";

describe('Computed', () => {

    describe('lazy evaluation', () => {
        it('computeFn is NOT called on creation', () => {
            const fn = vi.fn(() => 42);
            Computed.create(fn);
            expect(fn).not.toHaveBeenCalled();
        });

        it('first observation triggers computation', () => {
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

    describe('caching', () => {
        it('repeated reads do not re-invoke fn', () => {
            const count = Signal.state(1);
            const fn = vi.fn(() => count() * 2);
            const doubled = Computed.create(fn);

            const values: number[] = [];
            const eff = Signal.effect(() => { values.push(doubled()); });
            expect(fn).toHaveBeenCalledTimes(1);
            expect(values).toEqual([2]);

            // peek() reads from active internal state — fn not called again
            expect(doubled.peek()).toBe(2);
            expect(fn).toHaveBeenCalledTimes(1);

            eff.unsubscribe();
        });

        it('recomputes when dependency changes', () => {
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

        it('multiple dependencies — invalidation on any', () => {
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

    describe('observable subscription', () => {
        it('subscribing to obs emits computed value and updates', () => {
            const count = Signal.state(1);
            const doubled = Computed.create(() => count() * 2);

            const values: number[] = [];
            const sub = doubled.obs.subscribe((v: number | symbol) => values.push(v as number));

            expect(values).toEqual([2]);

            count.set(3);
            expect(values).toEqual([2, 6]);

            sub.unsubscribe();
        });

        it('cleanup: unsubscribing stops reactive tracking', () => {
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

    describe('diamond problem (glitch-free)', () => {
        it('D sees consistent B and C when A changes', () => {
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

    describe('error handling', () => {
        it('error in computeFn propagates to obs subscriber', () => {
            const c = Computed.create(() => {
                throw new Error('compute-error');
            });

            let caughtError: any;
            c.obs.subscribe({
                next: () => {},
                error: (e: any) => { caughtError = e; },
            });

            expect(caughtError).toBeDefined();
            expect(caughtError.message).toContain('compute-error');
        });

        it('after error, new subscription retries computation', () => {
            let shouldThrow = true;
            const c = Computed.create(() => {
                if (shouldThrow) throw new Error('fail');
                return 42;
            });

            let error1: any;
            c.obs.subscribe({
                next: () => {},
                error: (e: any) => { error1 = e; },
            });
            expect(error1).toBeDefined();

            shouldThrow = false;
            const values: (number | symbol)[] = [];
            const sub = c.obs.subscribe((v: number | symbol) => values.push(v));
            expect(values).toEqual([42]);
            sub.unsubscribe();
        });
    });
});
