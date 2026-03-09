import { describe, it, expect } from 'vitest';
import { shallowEqual } from './shallowEqual';

describe('shallowEqual', () => {
  describe('primitives', () => {
    it('equal numbers', () => {
      expect(shallowEqual(1, 1)).toBe(true);
    });

    it('unequal numbers', () => {
      expect(shallowEqual(1, 2)).toBe(false);
    });

    it('equal strings', () => {
      expect(shallowEqual('a', 'a')).toBe(true);
    });

    it('unequal strings', () => {
      expect(shallowEqual('a', 'b')).toBe(false);
    });

    it('equal booleans', () => {
      expect(shallowEqual(true, true)).toBe(true);
    });

    it('null equals null', () => {
      expect(shallowEqual(null, null)).toBe(true);
    });

    it('undefined equals undefined', () => {
      expect(shallowEqual(undefined, undefined)).toBe(true);
    });
  });

  describe('flat objects', () => {
    it('same keys and values', () => {
      expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
    });

    it('different values', () => {
      expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('different keys', () => {
      expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false);
    });

    it('different key counts', () => {
      expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });
  });

  describe('reference equality', () => {
    it('same object reference returns true', () => {
      const obj = { a: 1 };
      expect(shallowEqual(obj, obj)).toBe(true);
    });

    it('same array reference returns true', () => {
      const arr = [1, 2, 3];
      expect(shallowEqual(arr, arr)).toBe(true);
    });
  });

  describe('null/undefined vs object', () => {
    it('null vs object', () => {
      expect(shallowEqual(null, { a: 1 })).toBe(false);
    });

    it('object vs null', () => {
      expect(shallowEqual({ a: 1 }, null)).toBe(false);
    });

    it('undefined vs object', () => {
      expect(shallowEqual(undefined, { a: 1 })).toBe(false);
    });

    it('object vs undefined', () => {
      expect(shallowEqual({ a: 1 }, undefined)).toBe(false);
    });
  });

  describe('arrays', () => {
    it('equal arrays (compared by index keys)', () => {
      expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it('different length arrays', () => {
      expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    });

    it('nested objects are compared by reference (shallow)', () => {
      const inner = { x: 1 };
      expect(shallowEqual([inner], [inner])).toBe(true);
      expect(shallowEqual([{ x: 1 }], [{ x: 1 }])).toBe(false);
    });
  });

  describe('shallow vs deep', () => {
    it('nested objects with same structure are not equal', () => {
      expect(shallowEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(false);
    });

    it('nested arrays with same values are not equal', () => {
      expect(shallowEqual({ a: [1] }, { a: [1] })).toBe(false);
    });
  });
});
