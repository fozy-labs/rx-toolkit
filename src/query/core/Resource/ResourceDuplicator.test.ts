import { createResource } from '@/query/api/createResource';
import { createResourceDuplicator } from '@/query/api/createResourceDuplicator';
import { flushMicrotasks } from '@/__tests__/helpers/async-helpers';

type TestItem = { id: number; name: string };

function createTestDuplicatorSetup() {
  const calls: Array<{ resolve: (v: TestItem[]) => void; reject: (e: any) => void }> = [];

  const queryFn = vi.fn((_args: number[], _tools?: any) =>
    new Promise<TestItem[]>((resolve, reject) => {
      calls.push({ resolve, reject });
    }),
  );

  const resource = createResource<number[], TestItem[]>({
    queryFn,
    cacheLifetime: false,
    devtoolsName: false,
  });

  const duplicator = createResourceDuplicator({
    resource,
    getArgKey: (item: number) => item,
    getDataKey: (item: TestItem) => item.id,
    cacheLifetime: false,
  });

  return { resource, duplicator, queryFn, calls };
}

describe('ResourceDuplicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('serialize', () => {
    it('serializes args to pipe-separated keys', () => {
      const { duplicator } = createTestDuplicatorSetup();
      expect(duplicator.serialize([1, 2, 3])).toBe('1|2|3');
    });

    it('returns empty string for empty/falsy args', () => {
      const { duplicator } = createTestDuplicatorSetup();
      expect(duplicator.serialize(null as any)).toBe('');
    });
  });

  describe('compareArgs', () => {
    it('returns true for args with same serialization', () => {
      const { duplicator } = createTestDuplicatorSetup();
      expect(duplicator.compareArgs([1, 2], [1, 2])).toBe(true);
    });

    it('returns false for args with different serialization', () => {
      const { duplicator } = createTestDuplicatorSetup();
      expect(duplicator.compareArgs([1, 2], [2, 3])).toBe(false);
    });
  });

  describe('initiate', () => {
    it('triggers resource queryFn', () => {
      const { duplicator, queryFn } = createTestDuplicatorSetup();
      duplicator.initiate([1, 2]);

      expect(queryFn).toHaveBeenCalledWith(
        [1, 2],
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
      );
    });

    it('returns a cache instance', () => {
      const { duplicator } = createTestDuplicatorSetup();
      const cache = duplicator.initiate([1, 2]);
      expect(cache).toBeDefined();
      expect(cache.value).toBeDefined();
    });

    it('state is success after resource resolves', async () => {
      const { duplicator, calls } = createTestDuplicatorSetup();
      const cache = duplicator.initiate([1, 2]);

      calls[0].resolve([
        { id: 1, name: 'item-1' },
        { id: 2, name: 'item-2' },
      ]);
      await flushMicrotasks();

      expect(cache.value.isSuccess).toBe(true);
      expect(cache.value.isDone).toBe(true);
      expect(cache.value.data).toEqual([
        { id: 1, name: 'item-1' },
        { id: 2, name: 'item-2' },
      ]);
    });

    it('state is error when resource rejects', async () => {
      const { duplicator, calls } = createTestDuplicatorSetup();
      const cache = duplicator.initiate([1, 2]);

      const error = new Error('fetch failed');
      calls[0].reject(error);
      await flushMicrotasks();

      expect(cache.value.isError).toBe(true);
      expect(cache.value.isDone).toBe(true);
      expect(cache.value.error).toBe(error);
    });

    it('state is loading while resource is pending', () => {
      const { duplicator } = createTestDuplicatorSetup();
      const cache = duplicator.initiate([1, 2]);

      expect(cache.value.isLoading).toBe(true);
      expect(cache.value.isDone).toBe(false);
    });
  });

  describe('getQueryCache', () => {
    it('returns undefined before initiate', () => {
      const { duplicator } = createTestDuplicatorSetup();
      expect(duplicator.getQueryCache([1, 2])).toBeUndefined();
    });

    it('returns cache after initiate', () => {
      const { duplicator } = createTestDuplicatorSetup();
      duplicator.initiate([1, 2]);
      expect(duplicator.getQueryCache([1, 2])).toBeDefined();
    });
  });

  describe('createAgent', () => {
    it('creates an agent with state$', () => {
      const { duplicator } = createTestDuplicatorSetup();
      const agent = duplicator.createAgent();
      expect(agent).toBeDefined();
      expect(agent.state$).toBeDefined();
    });
  });
});
