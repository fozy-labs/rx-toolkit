import { ComputeCache } from './ComputeCache';
import { Signal } from '@/signals/signals/Signal';

describe('ComputeCache', () => {
    it('first call (cache miss) computes the value', () => {
        const cache = new ComputeCache<number>();
        const computeFn = vi.fn(() => 42);

        const result = cache.getOrCompute(computeFn);

        expect(result).toBe(42);
        expect(computeFn).toHaveBeenCalledOnce();
    });

    it('repeated call (cache hit) returns cached value without recomputing', () => {
        const cache = new ComputeCache<number>();
        const state = Signal.state(10);
        const computeFn = vi.fn(() => state() * 2);

        const first = cache.getOrCompute(computeFn);
        const second = cache.getOrCompute(computeFn);

        expect(first).toBe(20);
        expect(second).toBe(20);
        expect(computeFn).toHaveBeenCalledOnce();
    });

    it('recomputes when dependency changes', () => {
        const cache = new ComputeCache<number>();
        const state = Signal.state(5);
        const computeFn = vi.fn(() => state() + 1);

        expect(cache.getOrCompute(computeFn)).toBe(6);
        expect(computeFn).toHaveBeenCalledTimes(1);

        state.set(10);

        expect(cache.getOrCompute(computeFn)).toBe(11);
        expect(computeFn).toHaveBeenCalledTimes(2);
    });

    describe('isValid()', () => {
        it('returns false before any computation', () => {
            const cache = new ComputeCache<number>();
            expect(cache.isValid()).toBe(false);
        });

        it('returns true after computation with unchanged deps', () => {
            const cache = new ComputeCache<number>();
            const state = Signal.state(1);
            cache.getOrCompute(() => state());
            expect(cache.isValid()).toBe(true);
        });

        it('returns false after dependency changes', () => {
            const cache = new ComputeCache<number>();
            const state = Signal.state(1);
            cache.getOrCompute(() => state());
            state.set(2);
            expect(cache.isValid()).toBe(false);
        });

        it('returns false after clear()', () => {
            const cache = new ComputeCache<number>();
            cache.getOrCompute(() => 42);
            cache.clear();
            expect(cache.isValid()).toBe(false);
        });
    });

    it('handles error in computeFn gracefully', () => {
        const cache = new ComputeCache<number>();
        const badFn = () => { throw new Error('compute-error'); };

        expect(() => cache.getOrCompute(badFn)).toThrow('compute-error');

        // Cache should remain invalid after error
        expect(cache.isValid()).toBe(false);

        // Should be able to compute successfully after error
        const result = cache.getOrCompute(() => 99);
        expect(result).toBe(99);
    });
});
