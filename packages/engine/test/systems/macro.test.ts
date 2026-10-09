import { describe, expect, it } from 'vitest';
import { createTurnContext } from '../../src/core/context';
import type { Modifier } from '../../src';
import { macroSystem } from '../../src/systems/macro';
import { newGame } from '../helpers';

const calm = {
  macro: {
    regimeTransition: { expansionToRecession: 0, recessionToExpansion: 0 },
    gdpGrowth: { volatility: 0 },
    inflation: { volatility: 0 },
  },
};

const step = (state: ReturnType<typeof newGame>) => {
  const ctx = createTurnContext(state, []);
  macroSystem.run(ctx);
  return ctx;
};

const globalModifier = (key: Modifier['key'], value: number): Modifier => ({
  id: 'mod_test',
  sourceId: 'test',
  target: { kind: 'global' },
  key,
  op: 'add',
  value,
  remaining: 1,
  decay: 0,
});

describe('macro', () => {
  it('converges to the regime mean and the inflation target without shocks', () => {
    const state = newGame(1, calm);
    state.macro.gdpGrowth = 0.05;
    state.macro.inflation = 0.05;
    for (let i = 0; i < 40; i++) step(state);
    expect(state.macro.regime).toBe('expansion');
    expect(state.macro.gdpGrowth).toBeCloseTo(state.config.macro.gdpGrowth.expansionMean, 4);
    expect(state.macro.inflation).toBeCloseTo(state.config.macro.inflation.target, 4);
  });

  it('raises the policy rate when inflation runs above target (Taylor rule)', () => {
    const hot = newGame(1, calm);
    const cool = newGame(1, calm);
    hot.macro.inflation = 0.06;
    cool.macro.inflation = 0.0;
    step(hot);
    step(cool);
    expect(hot.macro.policyRate).toBeGreaterThan(hot.config.macro.policyRate.initial);
    expect(cool.macro.policyRate).toBeLessThan(cool.config.macro.policyRate.initial);
  });

  it('never goes below the rate floor', () => {
    const state = newGame(1, calm);
    state.macro.inflation = -0.2;
    for (let i = 0; i < 20; i++) step(state);
    expect(state.macro.policyRate).toBeGreaterThanOrEqual(state.config.macro.policyRate.floor);
  });

  it('indexes the price level on inflation', () => {
    const state = newGame(1, calm);
    step(state);
    expect(state.macro.priceLevel).toBeCloseTo(1 + state.macro.inflation / 4, 10);
  });

  it('switches to recession when a modifier forces it, and demand then falls', () => {
    const state = newGame(1, calm);
    state.modifiers.push(globalModifier('macro.expansionToRecession', 1));
    const ctx = step(state);
    expect(state.macro.regime).toBe('recession');
    expect(ctx.events.map((e) => e.kind)).toContain('macro_regime');
    state.modifiers = [];
    for (let i = 0; i < 8; i++) step(state);
    expect(state.macro.gdpGrowth).toBeLessThan(0);
    expect(state.macro.demandIndex).toBeLessThan(1);
  });

  it('adds a rate shock on top of the smoothed base rate', () => {
    const shocked = newGame(1, calm);
    const plain = newGame(1, calm);
    shocked.modifiers.push(globalModifier('macro.policyRate', 0.015));
    step(shocked);
    step(plain);
    expect(shocked.macro.baseRate).toBeCloseTo(plain.macro.baseRate, 12);
    expect(shocked.macro.policyRate).toBeCloseTo(plain.macro.policyRate + 0.015, 12);
  });

  it('is driven by the seeded rng only', () => {
    const a = newGame(9);
    const b = newGame(9);
    for (let i = 0; i < 10; i++) {
      step(a);
      step(b);
    }
    expect(a.macro).toEqual(b.macro);
    expect(a.meta.rng).toEqual(b.meta.rng);
  });
});
