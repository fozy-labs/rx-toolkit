import { renderHook, act } from '@testing-library/react';
import { useResourceAgent } from './useResourceAgent';
import { createResource } from '@/query/api/createResource';
import { SKIP } from '@/query/SKIP_TOKEN';
import { flushMicrotasks } from '@/__tests__/helpers/async-helpers';

function createControllableResource() {
    const calls: Array<{ resolve: (v: { name: string }) => void; reject: (e: any) => void }> = [];

    const queryFn = vi.fn((_args: { id: number }, _tools?: any) =>
        new Promise<{ name: string }>((resolve, reject) => {
            calls.push({ resolve, reject });
        }),
    );

    const resource = createResource<{ id: number }, { name: string }>({
        queryFn,
        cacheLifetime: false,
        devtoolsName: false,
    });

    return { resource, queryFn, calls };
}

describe('useResourceAgent', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders without throwing errors', () => {
        const { resource } = createControllableResource();

        const { result } = renderHook(() => useResourceAgent(resource, { id: 1 }));

        expect(result.current).toBeDefined();
        expect(result.current.isLoading).toBe(true);
        expect(result.current.isInitiated).toBe(true);
    });

    it('SKIP token prevents queryFn from being called', () => {
        const { resource, queryFn } = createControllableResource();

        const { result } = renderHook(() => useResourceAgent(resource, SKIP));

        expect(queryFn).not.toHaveBeenCalled();
        expect(result.current.isInitiated).toBe(false);
        expect(result.current.isLoading).toBe(false);
    });

    it('changing args triggers re-initiate', async () => {
        const { resource, queryFn, calls } = createControllableResource();

        let args: { id: number } = { id: 1 };
        const { result, rerender } = renderHook(() => useResourceAgent(resource, args));

        expect(queryFn).toHaveBeenCalledTimes(1);

        // Resolve first call
        await act(async () => {
            calls[0].resolve({ name: 'item-1' });
            await flushMicrotasks();
        });

        expect(result.current.data).toEqual({ name: 'item-1' });

        // Change args
        args = { id: 2 };
        rerender();

        expect(queryFn).toHaveBeenCalledTimes(2);
    });
});
