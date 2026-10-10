import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/default';
import { resolveConfig } from '../../src/config/merge';
import { createTurnContext } from '../../src/core/context';
import { ageModifiers, applyModifiers } from '../../src/core/modifiers';
import type { Modifier } from '../../src';
import { eventsSystem } from '../../src/systems/events';
import type { GameState } from '../../src';
import type { SystemId } from '../../src/core/system';
import { newGame, resolveAll, steadyAll, must } from '../helpers';

const modifier = (over: Partial<Modifier>): Modifier => ({
  id: 'mod_x',
  sourceId: 'src',
  target: { kind: 'global' },
  key: 'commodity.price',
  op: 'mul',
  value: 1.5,
  remaining: 2,
  decay: 0,
  ...over,
});

/** Every event certain to fire, the others silenced. */
const onlyEvent = (id: string) => ({
  events: {
    definitions: defaultConfig.events.definitions.map((d) => ({
      ...d,
      probability: d.id === id ? 1 : 0,
    })),
  },
});

const runEvents = (state: ReturnType<typeof newGame>) => {
  const ctx = createTurnContext(state, []);
  eventsSystem.run(ctx);
  return ctx;
};

describe('modifiers', () => {
  it('combines adds then muls, global or on the matching target only', () => {
    const mods = [
      modifier({ op: 'add', value: 10 }),
      modifier({ target: { kind: 'commodity', id: 'com_steel' }, value: 2 }),
      modifier({ target: { kind: 'commodity', id: 'com_energy' }, value: 100 }),
      modifier({ key: 'market.demand', value: 0 }),
    ];
    expect(applyModifiers(mods, 'commodity.price', 5)).toBe(15);
    expect(
      applyModifiers(mods, 'commodity.price', 5, [{ kind: 'commodity', id: 'com_steel' }]),
    ).toBe(30);
    expect(applyModifiers([], 'commodity.price', 5)).toBe(5);
  });

  it('fades by their decay and expire after their duration', () => {
    const mods = [
      modifier({ op: 'add', value: 0.02, decay: 0.5, remaining: 2 }),
      modifier({ op: 'mul', value: 1.6, decay: 0.5, remaining: 3 }),
    ];
    const once = ageModifiers(mods);
    expect(once.map((m) => [m.remaining, m.value])).toEqual([
      [1, 0.01],
      [2, 1.3],
    ]);
    expect(ageModifiers(once).map((m) => m.value)).toEqual([1.15]);
    expect(ageModifiers(ageModifiers(once))).toEqual([]);
    expect(mods[0]?.value).toBe(0.02); // inputs untouched
  });
});

describe('events', () => {
  it('ships the MVP events, the sector events and the extended catalogue as data', () => {
    expect(defaultConfig.events.definitions.map((d) => d.id)).toEqual([
      'ev_strike',
      'ev_energy_crisis',
      'ev_component_shortage',
      'ev_rate_hike',
      'ev_recession',
      'ev_drought',
      'ev_disruptive_innovation',
      'ev_regulation',
      'ev_stock_crash',
      'ev_quality_scandal',
      'ev_logistics_disruption',
      'ev_import_tariff',
      'ev_talent_shortage',
      'ev_demand_boom',
    ]);
  });

  it('scales every probability by events.probabilityScale, capped at 1', () => {
    const fired = (scale: number) =>
      Array.from({ length: 40 }, (_, i) => {
        const s = newGame(i + 1, {
          events: {
            probabilityScale: scale,
            definitions: [{ ...defaultConfig.events.definitions[3], probability: 0.4 } as never],
          },
        });
        runEvents(s);
        return s.modifiers.length;
      }).reduce((a, b) => a + b, 0);
    expect(fired(0)).toBe(0);
    expect(fired(3)).toBe(40);
    expect(fired(1)).toBeGreaterThan(0);
    expect(fired(1)).toBeLessThan(40);
  });

  it('turns a drawn event into one modifier per effect and logs it', () => {
    const state = newGame(1, onlyEvent('ev_component_shortage'));
    const ctx = runEvents(state);
    expect(state.modifiers.map((m) => [m.key, m.target.id, m.remaining])).toEqual([
      ['commodity.price', 'com_electronics', 2],
      ['commodity.supply', 'com_electronics', 2],
    ]);
    expect(ctx.events).toEqual([
      expect.objectContaining({
        kind: 'event',
        data: expect.objectContaining({
          eventId: 'ev_component_shortage',
          targetId: 'com_electronics',
        }),
      }),
    ]);
  });

  it('draws regional targets among the regions', () => {
    const state = newGame(3, onlyEvent('ev_strike'));
    runEvents(state);
    const target = state.modifiers[0]?.target;
    expect(target?.kind).toBe('region');
    expect(Object.keys(state.regions)).toContain(target?.id);
  });

  it('does not stack an event on itself, then lets it expire', () => {
    const state = newGame(1, onlyEvent('ev_rate_hike'));
    runEvents(state);
    expect(state.modifiers).toHaveLength(1);
    state.meta.turn += 1;
    runEvents(state);
    expect(state.modifiers).toHaveLength(1);
    expect(state.modifiers[0]?.value).toBeCloseTo(0.015 * 0.75, 12);
    // stop drawing, let it run out
    state.config = resolveConfig({ events: { definitions: [] } });
    for (let i = 0; i < 3; i++) runEvents(state);
    expect(state.modifiers).toEqual([]);
  });

  it('respects season and regime conditions', () => {
    const summer = newGame(1, onlyEvent('ev_energy_crisis'));
    summer.meta.turn = 1; // T2: not a winter quarter
    runEvents(summer);
    expect(summer.modifiers).toEqual([]);
    const recession = newGame(1, onlyEvent('ev_recession'));
    recession.macro.regime = 'recession';
    runEvents(recession);
    expect(recession.modifiers).toEqual([]);
  });

  it('rejects unknown modifier keys and unknown targets in the config', () => {
    const def = defaultConfig.events.definitions[0];
    if (!def) throw new Error('no event');
    expect(() =>
      resolveConfig({
        events: {
          definitions: [{ ...def, effects: [{ key: 'nope' as never, op: 'add', value: 1 }] }],
        },
      }),
    ).toThrow(/key/);
    expect(() =>
      resolveConfig({ events: { definitions: [{ ...def, targetIds: ['reg_atlantide'] }] } }),
    ).toThrow(/unknown reg_atlantide/);
  });
});

describe('extended catalogue (lot 3.4)', () => {
  const quarter = (state: GameState, until: SystemId) =>
    resolveAll(state, steadyAll(state), { until });

  it('a regulation makes the sellers of its market pay a share of their revenue', () => {
    const base = newGame(4, onlyEvent('ev_regulation'));
    const calm = newGame(4, onlyEvent('none'));
    const hit = quarter(base, 'products');
    const mod = hit.state.modifiers.find((m) => m.sourceId === 'ev_regulation');
    expect(mod?.target.kind).toBe('market');
    const marketId = mod?.target.id ?? '';
    const seller = Object.values(hit.state.companies).find((c) =>
      Object.values(c.productLines).some((l) => l.marketId === marketId),
    );
    if (!seller) throw new Error('no seller');
    const ref = quarter(calm, 'products');
    const ledger = hit.ctx.ledger(seller.id);
    const extra = ledger.other - ref.ctx.ledger(seller.id).other;
    expect(extra).toBeCloseTo(0.02 * ledger.revenue, 0);
    expect(extra).toBeGreaterThan(0);
  });

  it('a quality scandal costs the target its brand points', () => {
    const hit = quarter(newGame(5, onlyEvent('ev_quality_scandal')), 'products');
    const calm = quarter(newGame(5, onlyEvent('none')), 'products');
    const mod = hit.state.modifiers.find((m) => m.sourceId === 'ev_quality_scandal');
    expect(mod?.target.kind).toBe('company');
    const id = mod?.target.id ?? '';
    expect(must(calm.state.companies[id]).brand - must(hit.state.companies[id]).brand).toBeCloseTo(
      10,
      6,
    );
  });

  it('a stock market crash pulls every price down at once', () => {
    const hit = quarter(newGame(6, onlyEvent('ev_stock_crash')), 'stockmarket');
    const calm = quarter(newGame(6, onlyEvent('none')), 'stockmarket');
    expect(hit.state.stock.index.value / calm.state.stock.index.value).toBeLessThan(0.85);
    for (const [id, q] of Object.entries(hit.state.stock.quotes)) {
      if (hit.state.companies[id]?.listed) {
        expect(q.price).toBeLessThan(must(calm.state.stock.quotes[id]).price);
      }
    }
  });

  it('a logistics disruption rations the deliveries of a material', () => {
    const state = newGame(7, onlyEvent('ev_logistics_disruption'));
    runEvents(state);
    const [m] = state.modifiers;
    expect(m).toMatchObject({ key: 'commodity.supply', op: 'mul', value: 0.75 });
    expect(['com_steel', 'com_polymers', 'com_electronics', 'com_packaging']).toContain(
      m?.target.id,
    );
  });
});
