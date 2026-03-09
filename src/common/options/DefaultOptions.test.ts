import { describe, it, expect } from 'vitest';
import { DefaultOptions } from './DefaultOptions';
import { SharedOptions } from './SharedOptions';

describe('DefaultOptions', () => {
  describe('update()', () => {
    it('updates DEVTOOLS on SharedOptions', () => {
      const mockDevtools = { state: () => () => {} } as any;
      DefaultOptions.update({ DEVTOOLS: mockDevtools });
      expect(SharedOptions.DEVTOOLS).toBe(mockDevtools);
    });

    it('sets DEVTOOLS to null', () => {
      SharedOptions.DEVTOOLS = { state: () => () => {} } as any;
      DefaultOptions.update({ DEVTOOLS: null });
      expect(SharedOptions.DEVTOOLS).toBe(null);
    });

    it('updates onQueryError on SharedOptions', () => {
      const handler = (err: unknown) => {};
      DefaultOptions.update({ onQueryError: handler });
      expect(SharedOptions.onQueryError).toBe(handler);
    });

    it('updates getScopeName on SharedOptions', () => {
      const fn = () => 'my-scope';
      DefaultOptions.update({ getScopeName: fn });
      expect(SharedOptions.getScopeName).toBe(fn);
    });

    it('updates multiple fields at once', () => {
      const mockDevtools = { state: () => () => {} } as any;
      const handler = (err: unknown) => {};
      DefaultOptions.update({ DEVTOOLS: mockDevtools, onQueryError: handler });
      expect(SharedOptions.DEVTOOLS).toBe(mockDevtools);
      expect(SharedOptions.onQueryError).toBe(handler);
    });

    it('does not overwrite fields not included in the partial', () => {
      const handler = (err: unknown) => {};
      SharedOptions.onQueryError = handler;
      DefaultOptions.update({ DEVTOOLS: null });
      expect(SharedOptions.onQueryError).toBe(handler);
    });
  });
});
