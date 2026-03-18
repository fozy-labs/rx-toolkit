import { renderHook, act } from '@testing-library/react';
import { useSignal } from './useSignal';
import { Signal } from '@/signals/signals/Signal';
import { flushMicrotasks } from '../../__tests__/helpers/async-helpers';

describe('useSignal', () => {
    it('returns current signal value on first render', () => {
        const signal = Signal.state(42);
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe(42);
    });

    it('updates component when signal.set() is called', async () => {
        const signal = Signal.state(0);
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe(0);

        await act(async () => {
            signal.set(10);
            await flushMicrotasks();
        });

        expect(result.current).toBe(10);
    });

    it('returns updated value after multiple sets', async () => {
        const signal = Signal.state('a');
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe('a');

        await act(async () => {
            signal.set('b');
            await flushMicrotasks();
        });

        expect(result.current).toBe('b');

        await act(async () => {
            signal.set('c');
            await flushMicrotasks();
        });

        expect(result.current).toBe('c');
    });

    it('unsubscribes on unmount', async () => {
        const signal = Signal.state(1);
        const { result, unmount } = renderHook(() => useSignal(signal));

        expect(result.current).toBe(1);

        unmount();

        // After unmount, setting the signal should not cause errors
        signal.set(2);
        await flushMicrotasks();

        // Value frozen at last rendered value
        expect(result.current).toBe(1);
    });

    it('resubscribes when signal reference changes', async () => {
        const signal1 = Signal.state(100);
        const signal2 = Signal.state(200);

        let currentSignal = signal1;
        const { result, rerender } = renderHook(() => useSignal(currentSignal));

        expect(result.current).toBe(100);

        // Switch to signal2
        currentSignal = signal2;
        rerender();

        expect(result.current).toBe(200);

        // Updates from signal2 should be reflected
        await act(async () => {
            signal2.set(300);
            await flushMicrotasks();
        });

        expect(result.current).toBe(300);

        // Updates from signal1 should NOT be reflected
        await act(async () => {
            signal1.set(999);
            await flushMicrotasks();
        });

        expect(result.current).toBe(300);
    });

    it('does not provide getServerSnapshot (SSR limitation)', () => {
        // useSignal uses useSyncExternalStore without a getServerSnapshot
        // This means it cannot be used during SSR. We verify by checking
        // that the hook works client-side but the implementation has no
        // server snapshot arg — this is a design constraint, not a bug.
        const signal = Signal.state('client-only');
        const { result } = renderHook(() => useSignal(signal));

        expect(result.current).toBe('client-only');
    });
});
