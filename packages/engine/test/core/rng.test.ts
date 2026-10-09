import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng, seedRng } from '../../src/core/rng';

const draw = (seed: number, n: number) => {
  const rng = createRng(seedRng(seed));
  return Array.from({ length: n }, () => rng.next());
};

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    expect(draw(123, 50)).toEqual(draw(123, 50));
  });

  it('differs between seeds', () => {
    expect(draw(1, 10)).not.toEqual(draw(2, 10));
  });

  it('stays in [0, 1) and keeps a uint32 state', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const state = seedRng(seed);
        const rng = createRng(state);
        for (let i = 0; i < 100; i++) {
          const x = rng.next();
          if (!(x >= 0 && x < 1)) return false;
        }
        return Object.values(state).every((w) => Number.isInteger(w) && w >= 0 && w <= 0xffffffff);
      }),
    );
  });

  it('resumes identically from a serialized state', () => {
    const state = seedRng(7);
    const rng = createRng(state);
    for (let i = 0; i < 25; i++) rng.next();
    const restored = createRng(JSON.parse(JSON.stringify(state)));
    const expected = Array.from({ length: 20 }, () => rng.next());
    expect(Array.from({ length: 20 }, () => restored.next())).toEqual(expected);
  });

  it('mutates the state object it is bound to', () => {
    const state = seedRng(9);
    const before = { ...state };
    createRng(state).next();
    expect(state).not.toEqual(before);
  });

  it('has sane distributions', () => {
    const rng = createRng(seedRng(2024));
    const n = 20000;
    let mean = 0;
    let normMean = 0;
    let normSq = 0;
    for (let i = 0; i < n; i++) {
      mean += rng.next() / n;
      const z = rng.normal();
      normMean += z / n;
      normSq += (z * z) / n;
    }
    expect(mean).toBeCloseTo(0.5, 1);
    expect(normMean).toBeCloseTo(0, 1);
    expect(Math.sqrt(normSq)).toBeCloseTo(1, 1);
  });

  it('int, pick and shuffle respect their bounds', () => {
    const rng = createRng(seedRng(5));
    for (let i = 0; i < 1000; i++) {
      const k = rng.int(-2, 3);
      expect(Number.isInteger(k) && k >= -2 && k <= 3).toBe(true);
    }
    const items = ['a', 'b', 'c', 'd'];
    expect(items).toContain(rng.pick(items));
    const shuffled = rng.shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd']);
    expect(() => rng.pick([])).toThrow();
    expect(() => rng.int(3, 1)).toThrow();
  });

  it('rejects invalid seeds', () => {
    expect(() => seedRng(-1)).toThrow();
    expect(() => seedRng(1.5)).toThrow();
    expect(() => seedRng(2 ** 32)).toThrow();
  });
});
