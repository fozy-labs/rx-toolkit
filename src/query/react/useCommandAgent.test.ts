import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommandAgent } from './useCommandAgent';
import { createCommand } from '@/query/api/createCommand';
import { flushMicrotasks } from '@/__tests__/helpers/async-helpers';

function createControllableCommand() {
    const calls: Array<{ resolve: (v: { result: string }) => void; reject: (e: any) => void }> = [];

    const queryFn = vi.fn((_args: { id: number }) =>
        new Promise<{ result: string }>((resolve, reject) => {
            calls.push({ resolve, reject });
        }),
    );

    const command = createCommand<{ id: number }, { result: string }>({
        queryFn,
        cacheLifetime: false,
        devtoolsName: false,
    });

    return { command, queryFn, calls };
}

describe('useCommandAgent', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders without throwing', () => {
        const { command } = createControllableCommand();

        const { result } = renderHook(() => useCommandAgent(command));

        const [trigger, state] = result.current;
        expect(typeof trigger).toBe('function');
        expect(state).toBeDefined();
        expect(state.isLoading).toBe(false);
        expect(state.isDone).toBe(false);
    });

    it('trigger function calls the queryFn', async () => {
        const { command, queryFn, calls } = createControllableCommand();

        const { result } = renderHook(() => useCommandAgent(command));

        let triggerPromise: Promise<any>;

        await act(async () => {
            triggerPromise = result.current[0]({ id: 42 });
            await flushMicrotasks();
        });

        expect(queryFn).toHaveBeenCalledWith({ id: 42 });
        expect(queryFn).toHaveBeenCalledOnce();

        // Resolve and verify state updates
        await act(async () => {
            calls[0].resolve({ result: 'done' });
            await flushMicrotasks();
        });

        await act(async () => {
            await triggerPromise!;
            await flushMicrotasks();
        });

        expect(result.current[1].isSuccess).toBe(true);
        expect(result.current[1].data).toEqual({ result: 'done' });
    });
});
