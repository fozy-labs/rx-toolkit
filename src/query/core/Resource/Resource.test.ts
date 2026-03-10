import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createResource } from '@/query/api/createResource';
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

describe('Resource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initiate', () => {
    it('transitions to loading state when initiated', () => {
      const { resource } = createControllableResource();
      const cache = resource.initiate({ id: 1 });

      expect(cache.value.isLoading).toBe(true);
      expect(cache.value.isInitiated).toBe(true);
      expect(cache.value.isDone).toBe(false);
      expect(cache.value.isSuccess).toBe(false);
      expect(cache.value.isError).toBe(false);
    });

    it('transitions to success state when queryFn resolves', async () => {
      const { resource, queryFn, calls } = createControllableResource();
      const cache = resource.initiate({ id: 1 });

      expect(queryFn).toHaveBeenCalledOnce();

      calls[0].resolve({ name: 'item-1' });
      await flushMicrotasks();

      expect(cache.value.isLoading).toBe(false);
      expect(cache.value.isDone).toBe(true);
      expect(cache.value.isSuccess).toBe(true);
      expect(cache.value.data).toEqual({ name: 'item-1' });
      expect(cache.value.isError).toBe(false);
      expect(cache.value.error).toBeNull();
    });

    it('transitions to error state when queryFn rejects', async () => {
      const { resource, calls } = createControllableResource();
      const cache = resource.initiate({ id: 1 });

      const error = new Error('fetch failed');
      calls[0].reject(error);
      await flushMicrotasks();

      expect(cache.value.isLoading).toBe(false);
      expect(cache.value.isDone).toBe(true);
      expect(cache.value.isError).toBe(true);
      expect(cache.value.error).toBe(error);
      expect(cache.value.isSuccess).toBe(false);
    });

    it('calls queryFn with args and abortSignal', () => {
      const { resource, queryFn } = createControllableResource();
      resource.initiate({ id: 42 });

      expect(queryFn).toHaveBeenCalledWith(
        { id: 42 },
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
      );
    });

    it('aborts previous query when re-initiated with same args', async () => {
      const { resource, calls } = createControllableResource();

      const cache = resource.initiate({ id: 1 });
      const signal1 = cache.value.abortController!.signal;

      // Re-initiate with same args
      resource.initiate({ id: 1 });

      expect(signal1.aborted).toBe(true);

      // Resolve the first query — should be ignored since aborted
      calls[0].resolve({ name: 'stale' });
      await flushMicrotasks();

      // First resolve ignored; cache is still in loading state from second initiate
      expect(cache.value.isLoading).toBe(true);
      expect(cache.value.isSuccess).toBe(false);

      // Resolve the second query
      calls[1].resolve({ name: 'fresh' });
      await flushMicrotasks();

      expect(cache.value.isSuccess).toBe(true);
      expect(cache.value.data).toEqual({ name: 'fresh' });
    });

    it('reuses existing cache for same args', () => {
      const { resource } = createControllableResource();

      const cache1 = resource.initiate({ id: 1 });
      const cache2 = resource.initiate({ id: 1 });

      expect(cache1).toBe(cache2);
    });

    it('creates separate caches for different args', () => {
      const { resource } = createControllableResource();

      const cache1 = resource.initiate({ id: 1 });
      const cache2 = resource.initiate({ id: 2 });

      expect(cache1).not.toBe(cache2);
    });
  });

  describe('createWithData', () => {
    it('creates cache with pre-populated success state', () => {
      const { resource } = createControllableResource();
      const cache = resource.createWithData({ id: 1 }, { name: 'pre-loaded' });

      expect(cache.value.isDone).toBe(true);
      expect(cache.value.isSuccess).toBe(true);
      expect(cache.value.data).toEqual({ name: 'pre-loaded' });
      expect(cache.value.isLoading).toBe(false);
      expect(cache.value.isError).toBe(false);
      expect(cache.value.isInitiated).toBe(false);
    });

    it('does not overwrite existing initiated cache', async () => {
      const { resource, calls } = createControllableResource();

      resource.initiate({ id: 1 });
      calls[0].resolve({ name: 'fetched' });
      await flushMicrotasks();

      const cache = resource.createWithData({ id: 1 }, { name: 'should-not-overwrite' });

      expect(cache.value.data).toEqual({ name: 'fetched' });
      expect(cache.value.isInitiated).toBe(true);
    });
  });

  describe('createRef', () => {
    it('creates a ResourceRef for given args', () => {
      const { resource } = createControllableResource();
      const ref = resource.createRef({ id: 1 });
      expect(ref).toBeDefined();
      expect(ref.has).toBe(false);
    });
  });

  describe('createAgent', () => {
    it('creates a ResourceAgent with state$', () => {
      const { resource } = createControllableResource();
      const agent = resource.createAgent();
      expect(agent).toBeDefined();
      expect(agent.state$).toBeDefined();
    });
  });

  describe('select', () => {
    it('applies select transform to resolved data', async () => {
      const calls: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];

      const resource = createResource<{ id: number }, { name: string; age: number }, string>({
        queryFn: vi.fn(() =>
          new Promise((resolve, reject) => {
            calls.push({ resolve, reject });
          }),
        ),
        select: (result) => result.name,
        cacheLifetime: false,
        devtoolsName: false,
      });

      const cache = resource.initiate({ id: 1 });

      calls[0].resolve({ name: 'Alice', age: 30 });
      await flushMicrotasks();

      expect(cache.value.data).toBe('Alice');
      expect(cache.value.isSuccess).toBe(true);
    });
  });

  describe('state transitions', () => {
    it('no cache before initiate', () => {
      const { resource } = createControllableResource();
      expect(resource.getQueryCache({ id: 1 })).toBeUndefined();
    });

    it('sets isReloading when re-initiating after success', async () => {
      const { resource, calls } = createControllableResource();

      resource.initiate({ id: 1 });
      calls[0].resolve({ name: 'first' });
      await flushMicrotasks();

      const cache = resource.initiate({ id: 1 });
      // isDone was true → isLoading = !isDone = false, isReloading = isDone = true
      expect(cache.value.isReloading).toBe(true);
      expect(cache.value.isLoading).toBe(false);
    });
  });

  describe('compareArgs', () => {
    it('uses default shallow comparison', () => {
      const { resource } = createControllableResource();
      expect(resource.compareArgs({ id: 1 }, { id: 1 })).toBe(true);
      expect(resource.compareArgs({ id: 1 }, { id: 2 })).toBe(false);
    });

    it('uses custom compareArgsFn when provided', () => {
      const resource = createResource<{ id: number; extra?: string }, { name: string }>({
        queryFn: vi.fn(async () => ({ name: 'test' })),
        compareArgsFn: (a, b) => a.id === b.id,
        cacheLifetime: false,
        devtoolsName: false,
      });

      expect(resource.compareArgs({ id: 1, extra: 'a' }, { id: 1, extra: 'b' })).toBe(true);
      expect(resource.compareArgs({ id: 1 }, { id: 2 })).toBe(false);
    });
  });
});
