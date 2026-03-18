import { SharedOptions } from './SharedOptions';
import { shallowEqual } from '@/common/utils';

describe('SharedOptions', () => {
  describe('default values', () => {
    it('DEVTOOLS defaults to null', () => {
      expect(SharedOptions.DEVTOOLS).toBe(null);
    });

    it('onQueryError defaults to null', () => {
      expect(SharedOptions.onQueryError).toBe(null);
    });

    it('getScopeName defaults to null', () => {
      expect(SharedOptions.getScopeName).toBe(null);
    });

    it('defaultCompareArgs defaults to shallowEqual', () => {
      expect(SharedOptions.defaultCompareArgs).toBe(shallowEqual);
    });
  });

  describe('setting values', () => {
    it('DEVTOOLS can be set and preserves value', () => {
      const mockDevtools = { state: () => () => {} } as any;
      SharedOptions.DEVTOOLS = mockDevtools;
      expect(SharedOptions.DEVTOOLS).toBe(mockDevtools);
    });

    it('onQueryError can be set', () => {
      const handler = () => {};
      SharedOptions.onQueryError = handler;
      expect(SharedOptions.onQueryError).toBe(handler);
    });
  });

  describe('reset()', () => {
    it('restores all defaults', () => {
      SharedOptions.DEVTOOLS = { state: () => () => {} } as any;
      SharedOptions.onQueryError = () => {};
      SharedOptions.getScopeName = () => 'scope';
      SharedOptions.defaultCompareArgs = () => false;

      SharedOptions.reset();

      expect(SharedOptions.DEVTOOLS).toBe(null);
      expect(SharedOptions.onQueryError).toBe(null);
      expect(SharedOptions.getScopeName).toBe(null);
      expect(SharedOptions.defaultCompareArgs).toBe(shallowEqual);
    });

    it('provides isolation between tests (values are defaults from setup)', () => {
      // The setup.ts calls SharedOptions.reset() before each test,
      // so values should always be defaults at the start of a test
      expect(SharedOptions.DEVTOOLS).toBe(null);
      expect(SharedOptions.defaultCompareArgs).toBe(shallowEqual);
    });
  });
});
