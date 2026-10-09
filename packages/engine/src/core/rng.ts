import type { RngState } from '../model/state';

const UINT32 = 4294967296;

/** Expands a 32-bit seed into an sfc32 state (splitmix32), then warms it up. */
export function seedRng(seed: number): RngState {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32) {
    throw new Error(`Seed must be an integer in [0, 2^32): ${seed}`);
  }
  let s = seed >>> 0;
  const splitmix32 = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  const state: RngState = { a: splitmix32(), b: splitmix32(), c: splitmix32(), d: splitmix32() };
  const rng = createRng(state);
  for (let i = 0; i < 12; i++) rng.next();
  return state;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number;
  /** Gaussian (Box-Muller, no cached spare so the state stays a plain object). */
  normal(mean?: number, sd?: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Returns a shuffled copy (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

/**
 * sfc32 generator. It mutates `state` in place, so passing `draft.meta.rng`
 * keeps the saved state up to date without any extra step.
 */
export function createRng(state: RngState): Rng {
  const next = (): number => {
    const t = (((state.a + state.b) | 0) + state.d) | 0;
    state.d = (state.d + 1) >>> 0;
    state.a = (state.b ^ (state.b >>> 9)) >>> 0;
    state.b = (state.c + (state.c << 3)) >>> 0;
    const c = (state.c << 21) | (state.c >>> 11);
    state.c = (c + t) >>> 0;
    return (t >>> 0) / UINT32;
  };

  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new Error(`Invalid integer range [${min}, ${max}]`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    normal: (mean = 0, sd = 1) => {
      const u1 = 1 - next(); // (0, 1]: avoids ln(0)
      const u2 = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    },
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('Cannot pick from an empty list');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle: (items) => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j] as (typeof out)[number], out[i] as (typeof out)[number]];
      }
      return out;
    },
  };
  return rng;
}
