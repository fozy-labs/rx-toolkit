import { createResource } from '@/query/api/createResource';
import type { ResourceRefInstance, ResourceTransaction } from '@/query/types';

type TestDef = { Args: { id: number }; Result: { name: string }; Selected: never; Data: { name: string } };

function createTestResource() {
  const queryFn = vi.fn(async (args: { id: number }) => ({ name: `item-${args.id}` }));

  const resource = createResource<{ id: number }, { name: string }>({
    queryFn,
    cacheLifetime: false,
  });

  return { resource, queryFn };
}

describe('ResourceRef', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('has', () => {
    it('returns false when no cache entry exists', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      expect(ref.has).toBe(false);
    });

    it('returns true after data is created via ref.create()', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'test' });
      expect(ref.has).toBe(true);
    });
  });

  describe('create', () => {
    it('creates a cache entry with provided data', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'hello' });
      expect(ref.has).toBe(true);
    });
  });

  describe('patch', () => {
    it('returns null when no cache entry exists', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 99 });
      const tx = ref.patch((data) => { data.name = 'changed'; });
      expect(tx).toBeNull();
    });

    it('modifies state optimistically when cache entry exists and isDone', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'original' });

      const tx = ref.patch((data) => { data.name = 'patched'; });
      expect(tx).not.toBeNull();
      expect(tx!.status).toBe('pending');
    });

    it('returns a transaction with commit and abort methods', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'original' });

      const tx = ref.patch((data) => { data.name = 'changed'; });
      expect(tx).not.toBeNull();
      expect(typeof tx!.commit).toBe('function');
      expect(typeof tx!.abort).toBe('function');
      expect(tx!.patches.length).toBeGreaterThan(0);
      expect(tx!.inversePatches.length).toBeGreaterThan(0);
    });
  });

  describe('commit', () => {
    it('sets transaction status to committed', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'original' });

      const tx = ref.patch((data) => { data.name = 'committed-value'; })!;
      expect(tx.status).toBe('pending');

      tx.commit();
      expect(tx.status).toBe('committed');
    });

    it('commit is idempotent — second call does nothing', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'data' });

      const tx = ref.patch((data) => { data.name = 'changed'; })!;
      tx.commit();
      tx.commit(); // should not throw
      expect(tx.status).toBe('committed');
    });
  });

  describe('abort', () => {
    it('sets transaction status to aborted', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'original' });

      const tx = ref.patch((data) => { data.name = 'will-abort'; })!;
      expect(tx.status).toBe('pending');

      tx.abort();
      expect(tx.status).toBe('aborted');
    });

    it('abort after commit does nothing', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'data' });

      const tx = ref.patch((data) => { data.name = 'changed'; })!;
      tx.commit();
      tx.abort(); // should not change status
      expect(tx.status).toBe('committed');
    });

    it('commit after abort does nothing', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'data' });

      const tx = ref.patch((data) => { data.name = 'changed'; })!;
      tx.abort();
      tx.commit(); // should not change status
      expect(tx.status).toBe('aborted');
    });
  });

  describe('multiple patches', () => {
    it('multiple patches create independent transactions', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'original' });

      const tx1 = ref.patch((data) => { data.name = 'first'; })!;
      const tx2 = ref.patch((data) => { data.name = 'second'; })!;

      expect(tx1).not.toBe(tx2);
      expect(tx1.status).toBe('pending');
      expect(tx2.status).toBe('pending');
    });

    it('committing first and aborting second works independently', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'original' });

      const tx1 = ref.patch((data) => { data.name = 'first'; })!;
      const tx2 = ref.patch((data) => { data.name = 'second'; })!;

      tx1.commit();
      tx2.abort();

      expect(tx1.status).toBe('committed');
      expect(tx2.status).toBe('aborted');
    });
  });

  describe('lock / unlockOne', () => {
    it('lock returns an object with unlock method', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      const lockHandle = ref.lock();
      expect(typeof lockHandle.unlock).toBe('function');
      lockHandle.unlock();
    });

    it('lock is idempotent on unlock — second unlock does nothing', () => {
      const { resource } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      const lockHandle = ref.lock();
      lockHandle.unlock();
      expect(() => lockHandle.unlock()).not.toThrow();
    });
  });

  describe('invalidate', () => {
    it('invalidate triggers a new query', () => {
      const { resource, queryFn } = createTestResource();
      const ref = resource.createRef({ id: 1 });
      ref.create({ name: 'data' });

      ref.invalidate();
      expect(queryFn).toHaveBeenCalledWith({ id: 1 }, expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
    });
  });
});
