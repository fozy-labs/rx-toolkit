import { describe, it, expect, vi } from 'vitest';
import { Devtools } from './Devtools';
import { SharedOptions } from '@/common/options/SharedOptions';
import { Indexer } from './Indexer';

describe('Devtools', () => {
    describe('createState()', () => {
        it('returns null when SharedOptions.DEVTOOLS is null', () => {
            SharedOptions.DEVTOOLS = null;
            const result = Devtools.createState(0);
            expect(result).toBeNull();
        });

        it('creates and returns DevtoolsStateLike when devtools is set', () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState(42, { name: 'test' });

            expect(devtoolsState).toBeTypeOf('function');
            expect(mockCreateState).toHaveBeenCalledOnce();

            // Calling the returned function should forward to the mock
            devtoolsState!(100);
            expect(mockStateFn).toHaveBeenCalledWith(100);
        });

        it('returns null when options.isDisabled is true', () => {
            const mockCreateState = vi.fn(() => vi.fn());
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const result = Devtools.createState(0, { isDisabled: true });
            expect(result).toBeNull();
        });

        it('accepts string options as name', () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState('hello', 'mySignal');
            expect(devtoolsState).toBeTypeOf('function');
            expect(mockCreateState).toHaveBeenCalledOnce();

            // Key should include 'mySignal'
            const key = mockCreateState.mock.calls[0]![0] as unknown as string;
            expect(key).toContain('mySignal');
        });

        it('handles _skipValues — skips initial value matching skipValues', () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState<number | null>(null, { _skipValues: [null] });

            // createState should not have been called since initial value is skipped
            expect(mockCreateState).not.toHaveBeenCalled();
            // But we still get a function (lazy init)
            expect(devtoolsState).toBeTypeOf('function');

            // Calling with a non-skip value should lazily create
            devtoolsState!(42 as number | null);
            expect(mockCreateState).toHaveBeenCalledOnce();
        });

        it('handles _skipValues — skips update matching skipValues', () => {
            const mockStateFn = vi.fn();
            const mockCreateState = vi.fn(() => mockStateFn);
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            const devtoolsState = Devtools.createState<number | null>(1, { _skipValues: [null] });
            expect(mockCreateState).toHaveBeenCalledOnce();

            // Calling with a skip value should not forward
            devtoolsState!(null as number | null);
            expect(mockStateFn).not.toHaveBeenCalled();
        });
    });

    describe('hasDevtools', () => {
        it('returns false when DEVTOOLS is null', () => {
            SharedOptions.DEVTOOLS = null;
            expect(Devtools.hasDevtools).toBe(false);
        });

        it('returns true when DEVTOOLS.state is set', () => {
            SharedOptions.DEVTOOLS = { state: vi.fn() };
            expect(Devtools.hasDevtools).toBe(true);
        });
    });

    describe('key generation', () => {
        it('generates unique keys via Indexer', () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            Devtools.createState(1, { name: 'a' });
            Devtools.createState(2, { name: 'b' });

            expect(keys).toHaveLength(2);
            expect(keys[0]).not.toBe(keys[1]);
        });

        it('replaces {scope} placeholder with scope name', () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };
            SharedOptions.getScopeName = () => 'myScope';

            Devtools.createState(1, { name: 'pre-{scope}-post' });

            expect(keys[0]).toContain('myScope');
        });

        it('replaces {base} placeholder with base option', () => {
            const keys: string[] = [];
            const mockCreateState = vi.fn((key: string) => {
                keys.push(key);
                return vi.fn();
            });
            SharedOptions.DEVTOOLS = { state: mockCreateState };

            Devtools.createState(1, { name: '{base}/signal', base: 'State' });

            expect(keys[0]).toContain('State');
        });
    });
});
