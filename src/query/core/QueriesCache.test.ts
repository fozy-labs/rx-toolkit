import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueriesCache } from '@/query/core/QueriesCache';

describe('QueriesCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createQueryCache creates a new cache entry', () => {
    const cache = new QueriesCache<string, number>();
    const entry = cache.createQueryCache('key', 42);
    expect(entry.value).toBe(42);
    entry.complete();
  });

  it('getQueryCache returns undefined for missing key', () => {
    const cache = new QueriesCache<string, number>();
    expect(cache.getQueryCache('missing')).toBeUndefined();
  });

  it('getQueryCache returns existing cache entry', () => {
    const cache = new QueriesCache<string, number>();
    const entry = cache.createQueryCache('key', 10);
    const found = cache.getQueryCache('key');
    expect(found).toBe(entry);
    entry.complete();
  });

  it('same args returns same cache (shallow-equal object keys)', () => {
    const cache = new QueriesCache<{ id: number }, string>();
    const entry = cache.createQueryCache({ id: 1 }, 'first');
    const found = cache.getQueryCache({ id: 1 });
    expect(found).toBe(entry);
    entry.complete();
  });

  it('different args create different entries', () => {
    const cache = new QueriesCache<string, number>();
    const entry1 = cache.createQueryCache('a', 1);
    const entry2 = cache.createQueryCache('b', 2);
    expect(entry1).not.toBe(entry2);
    expect(entry1.value).toBe(1);
    expect(entry2.value).toBe(2);
    entry1.complete();
    entry2.complete();
  });

  it('values() returns all cache entries', () => {
    const cache = new QueriesCache<string, number>();
    const entry1 = cache.createQueryCache('a', 1);
    const entry2 = cache.createQueryCache('b', 2);
    const entries = Array.from(cache.values());
    expect(entries).toHaveLength(2);
    expect(entries).toContain(entry1);
    expect(entries).toContain(entry2);
    entry1.complete();
    entry2.complete();
  });

  it('cache entry is removed from map when completed (cleaned)', () => {
    const cache = new QueriesCache<string, number>();
    const entry = cache.createQueryCache('key', 42);
    entry.complete();
    expect(cache.getQueryCache('key')).toBeUndefined();
  });

  it('custom compare function is used for key equality', () => {
    const compareFn = (a: { id: number }, b: { id: number }) => a.id === b.id;
    const cache = new QueriesCache<{ id: number }, string>(60_000, compareFn);
    const entry = cache.createQueryCache({ id: 1 }, 'value');
    expect(cache.getQueryCache({ id: 1 })).toBe(entry);
    entry.complete();
  });
});
