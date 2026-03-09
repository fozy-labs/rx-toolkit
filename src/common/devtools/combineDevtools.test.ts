import { describe, it, expect, vi } from 'vitest';
import { combineDevtools } from './combineDevtools';
import type { DevtoolsLike } from './types';

function createMockDevtools(): DevtoolsLike & { updater: ReturnType<typeof vi.fn> } {
  const updater = vi.fn();
  return {
    updater,
    state: vi.fn((_name: string, _initState: any) => updater),
  };
}

describe('combineDevtools', () => {
  it('single devtools adapter — state() returns an updater', () => {
    const mock = createMockDevtools();
    const combined = combineDevtools(mock);

    const updater = combined.state('test', { count: 0 });
    expect(mock.state).toHaveBeenCalledWith('test', { count: 0 });

    updater({ count: 1 });
    expect(mock.updater).toHaveBeenCalledWith({ count: 1 });
  });

  it('multiple devtools — all state() methods called with init', () => {
    const mock1 = createMockDevtools();
    const mock2 = createMockDevtools();
    const combined = combineDevtools(mock1, mock2);

    combined.state('multi', 'init');
    expect(mock1.state).toHaveBeenCalledWith('multi', 'init');
    expect(mock2.state).toHaveBeenCalledWith('multi', 'init');
  });

  it('multiple devtools — updater calls all sub-updaters', () => {
    const mock1 = createMockDevtools();
    const mock2 = createMockDevtools();
    const combined = combineDevtools(mock1, mock2);

    const updater = combined.state('test', 0);
    updater(42);

    expect(mock1.updater).toHaveBeenCalledWith(42);
    expect(mock2.updater).toHaveBeenCalledWith(42);
  });

  it('multiple state registrations are independent', () => {
    const mock = createMockDevtools();
    const combined = combineDevtools(mock);

    const updater1 = combined.state('a', 1);
    const updater2 = combined.state('b', 2);

    expect(mock.state).toHaveBeenCalledTimes(2);

    updater1(10);
    updater2(20);
    // Both calls go to the same mock.updater since createMockDevtools
    // returns the same fn — but state() was called twice with different names
    expect(mock.state).toHaveBeenNthCalledWith(1, 'a', 1);
    expect(mock.state).toHaveBeenNthCalledWith(2, 'b', 2);
  });
});
