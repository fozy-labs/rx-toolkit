import { IndirectMap } from '@/query/lib/IndirectMap';

describe('IndirectMap', () => {
  describe('primitive keys', () => {
    it('set/get works with string keys', () => {
      const map = new IndirectMap<string, number>();
      map.set('a', 1);
      expect(map.get('a')).toBe(1);
    });

    it('set/get works with number keys', () => {
      const map = new IndirectMap<number, string>();
      map.set(42, 'answer');
      expect(map.get(42)).toBe('answer');
    });

    it('returns undefined for missing primitive key', () => {
      const map = new IndirectMap<string, number>();
      expect(map.get('missing')).toBeUndefined();
    });
  });

  describe('object keys (shallow equal lookup)', () => {
    it('retrieves value using a shallow-equal object key', () => {
      const map = new IndirectMap<{ id: number }, string>();
      map.set({ id: 1 }, 'first');
      expect(map.get({ id: 1 })).toBe('first');
    });

    it('different object keys return different values', () => {
      const map = new IndirectMap<{ id: number }, string>();
      map.set({ id: 1 }, 'first');
      map.set({ id: 2 }, 'second');
      expect(map.get({ id: 1 })).toBe('first');
      expect(map.get({ id: 2 })).toBe('second');
    });

    it('overwrites value when setting with shallow-equal key', () => {
      const map = new IndirectMap<{ id: number }, string>();
      map.set({ id: 1 }, 'old');
      map.set({ id: 1 }, 'new');
      expect(map.get({ id: 1 })).toBe('new');
    });

    it('uses cache for repeated lookups', () => {
      const map = new IndirectMap<{ id: number }, string>();
      map.set({ id: 1 }, 'value');
      // First lookup populates cache
      expect(map.get({ id: 1 })).toBe('value');
      // Second lookup uses cache
      expect(map.get({ id: 1 })).toBe('value');
    });
  });

  describe('delete', () => {
    it('removes entry by exact key reference', () => {
      const key = { id: 1 };
      const map = new IndirectMap<{ id: number }, string>();
      map.set(key, 'value');
      map.delete(key);
      expect(map.get(key)).toBeUndefined();
    });

    it('removes entry by shallow-equal key', () => {
      const map = new IndirectMap<{ id: number }, string>();
      map.set({ id: 1 }, 'value');
      map.delete({ id: 1 });
      expect(map.get({ id: 1 })).toBeUndefined();
    });

    it('removes primitive key', () => {
      const map = new IndirectMap<string, number>();
      map.set('key', 42);
      map.delete('key');
      expect(map.get('key')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('returns true when key exists (primitive)', () => {
      const map = new IndirectMap<string, number>();
      map.set('key', 1);
      expect(map.has('key')).toBe(true);
    });

    it('returns false when key does not exist', () => {
      const map = new IndirectMap<string, number>();
      expect(map.has('missing')).toBe(false);
    });

    it('returns true for shallow-equal object key', () => {
      const map = new IndirectMap<{ id: number }, string>();
      map.set({ id: 1 }, 'val');
      expect(map.has({ id: 1 })).toBe(true);
    });

    it('returns false for non-matching object key', () => {
      const map = new IndirectMap<{ id: number }, string>();
      map.set({ id: 1 }, 'val');
      expect(map.has({ id: 2 })).toBe(false);
    });
  });

  describe('values', () => {
    it('returns all values', () => {
      const map = new IndirectMap<string, number>();
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      expect([...map.values()]).toEqual([1, 2, 3]);
    });

    it('returns empty iterator for empty map', () => {
      const map = new IndirectMap<string, number>();
      expect([...map.values()]).toEqual([]);
    });
  });

  describe('custom compare function', () => {
    it('uses custom compare to match keys', () => {
      // Compare only by `name` field, ignoring `age`
      const compare = (a: { name: string }, b: { name: string }) => a.name === b.name;
      const map = new IndirectMap<{ name: string; age?: number }, string>(compare);

      map.set({ name: 'Alice', age: 30 }, 'first');
      expect(map.get({ name: 'Alice', age: 99 })).toBe('first');
    });

    it('custom compare distinguishes non-matching keys', () => {
      const compare = (a: { name: string }, b: { name: string }) => a.name === b.name;
      const map = new IndirectMap<{ name: string }, string>(compare);

      map.set({ name: 'Alice' }, 'a');
      map.set({ name: 'Bob' }, 'b');
      expect(map.get({ name: 'Alice' })).toBe('a');
      expect(map.get({ name: 'Bob' })).toBe('b');
    });
  });

  describe('edge cases', () => {
    it('handles null key as primitive', () => {
      const map = new IndirectMap<null | string, number>();
      map.set(null, 7);
      expect(map.get(null)).toBe(7);
    });

    it('handles undefined key as primitive', () => {
      const map = new IndirectMap<undefined | string, number>();
      map.set(undefined, 99);
      expect(map.get(undefined)).toBe(99);
    });

    it('get returns undefined for null key when not present', () => {
      const map = new IndirectMap<null | string, number>();
      expect(map.get(null)).toBeUndefined();
    });
  });
});
