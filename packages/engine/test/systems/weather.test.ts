import { describe, expect, it } from 'vitest';
import type { GameState, Modifier } from '../../src';
import { createRng, seedRng } from '../../src/core/rng';
import { advanceWeather, nationalYield, regionalYield } from '../../src/sectors/agri/weather';
import { commoditiesSystem } from '../../src/systems/commodities';
import { validationSystem } from '../../src/systems/validation';
import { weatherSystem } from '../../src/systems/weather';
import { newGame, resolveAll } from '../helpers';

const drought = (regionId: string, value = 0.6): Modifier => ({
  id: 'mod_x',
  sourceId: 'ev_drought',
  target: { kind: 'region', id: regionId },
  key: 'agri.yield',
  op: 'mul',
  value,
  remaining: 2,
  decay: 0,
});

describe('weather', () => {
  it('draws a bounded, seeded weather for every region each quarter', () => {
    const state = newGame(3);
    const a = resolveAll(state, [], { systems: [weatherSystem] }).state;
    const b = resolveAll(state, [], { systems: [weatherSystem] }).state;
    const { min, max } = state.config.sectors.agri?.weather ?? { min: 0, max: 0 };
    const weathers = Object.values(a.regions).map((r) => r.weather);
    expect(new Set(weathers).size).toBe(weathers.length); // regional shocks
    for (const w of weathers) {
      expect(w).toBeGreaterThanOrEqual(min);
      expect(w).toBeLessThanOrEqual(max);
    }
    expect(Object.values(b.regions).map((r) => r.weather)).toEqual(weathers);
  });

  it('follows ln w = ρ·ln w_prev + σ·ε around a normal year', () => {
    const state = newGame(5);
    const cfg = state.config.sectors.agri?.weather;
    if (!cfg) throw new Error('no agri');
    const rng = createRng(seedRng(11));
    const logs: number[] = [];
    for (let i = 0; i < 4000; i++) {
      advanceWeather(state, cfg, rng);
      logs.push(Math.log(state.regions.reg_nord?.weather ?? 1));
    }
    const mean = logs.reduce((s, x) => s + x, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((s, x) => s + (x - mean) ** 2, 0) / logs.length);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeCloseTo(cfg.volatility / Math.sqrt(1 - cfg.persistence ** 2), 1);
  });

  it('a drought cuts the yield of its region and lifts the national crop prices', () => {
    const base = newGame(7);
    const dry: GameState = structuredClone(base);
    dry.modifiers.push(drought('reg_nord'));
    expect(regionalYield(dry, 'reg_nord')).toBeCloseTo(0.6, 12);
    expect(regionalYield(dry, 'reg_sud')).toBe(1);
    expect(nationalYield(dry)).toBeLessThan(nationalYield(base));

    const systems = [validationSystem, commoditiesSystem];
    const before = resolveAll(base, [], { systems }).state.commodities;
    const after = resolveAll(dry, [], { systems }).state.commodities;
    expect(after.com_cereals?.spotPrice).toBeGreaterThan(before.com_cereals?.spotPrice ?? 0);
    expect(after.com_oilseeds?.spotPrice).toBeGreaterThan(before.com_oilseeds?.spotPrice ?? 0);
    expect(after.com_steel?.spotPrice).toBe(before.com_steel?.spotPrice); // not a crop
  });
});
