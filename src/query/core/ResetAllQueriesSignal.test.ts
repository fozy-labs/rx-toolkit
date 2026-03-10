import { describe, it, expect, vi } from 'vitest';
import { ResetAllQueriesSignal } from '@/query/core/ResetAllQueriesSignal';

describe('ResetAllQueriesSignal', () => {
  it('clean() triggers clean$ subscribers', () => {
    const handler = vi.fn();
    const sub = ResetAllQueriesSignal.clean$.subscribe(handler);

    ResetAllQueriesSignal.clean();

    expect(handler).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('multiple subscribers all get notified', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const sub1 = ResetAllQueriesSignal.clean$.subscribe(handler1);
    const sub2 = ResetAllQueriesSignal.clean$.subscribe(handler2);

    ResetAllQueriesSignal.clean();

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    sub1.unsubscribe();
    sub2.unsubscribe();
  });

  it('unsubscribed listener is not notified', () => {
    const handler = vi.fn();
    const sub = ResetAllQueriesSignal.clean$.subscribe(handler);
    sub.unsubscribe();

    ResetAllQueriesSignal.clean();

    expect(handler).not.toHaveBeenCalled();
  });

  it('can be triggered multiple times', () => {
    const handler = vi.fn();
    const sub = ResetAllQueriesSignal.clean$.subscribe(handler);

    ResetAllQueriesSignal.clean();
    ResetAllQueriesSignal.clean();
    ResetAllQueriesSignal.clean();

    expect(handler).toHaveBeenCalledTimes(3);
    sub.unsubscribe();
  });
});
