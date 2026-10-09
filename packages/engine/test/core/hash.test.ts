import { describe, expect, it } from 'vitest';
import { hashState, stableStringify } from '../../src/core/hash';

describe('hash', () => {
  it('ignores key order', () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe(
      stableStringify({ a: { c: 'x', d: [1, 2] }, b: 1 }),
    );
    expect(hashState({ b: 1, a: 2 })).toBe(hashState({ a: 2, b: 1 }));
  });

  it('detects any change', () => {
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 1.0000001 }));
    expect(hashState([1, 2])).not.toBe(hashState([2, 1]));
  });

  it('produces 16 hex chars', () => {
    expect(hashState({})).toMatch(/^[0-9a-f]{16}$/);
  });
});
