import { describe, it, expect } from 'vitest';
import { SKIP } from '@/query/SKIP_TOKEN';

describe('SKIP_TOKEN', () => {
  it('SKIP is a symbol', () => {
    expect(typeof SKIP).toBe('symbol');
  });

  it('SKIP is unique — not equal to another Symbol with same description', () => {
    const other = Symbol('SKIP');
    expect(SKIP).not.toBe(other);
  });

  it('SKIP has description "SKIP"', () => {
    expect(SKIP.description).toBe('SKIP');
  });

  it('SKIP is always the same reference', () => {
    const ref1 = SKIP;
    const ref2 = SKIP;
    expect(ref1).toBe(ref2);
  });
});
