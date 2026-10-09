import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/default';
import { resolveConfig } from '../../src/config/merge';
import { createTurnContext } from '../../src/core/context';
import { ageModifiers, applyModifiers } from '../../src/core/modifiers';
import type { Modifier } from '../../src';
import { eventsSystem } from '../../src/systems/events';
import { newGame } from '../helpers';

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
  it('ships the 5 MVP events as data', () => {
    expect(defaultConfig.events.definitions.map((d) => d.id)).toEqual([
      'ev_strike',
      'ev_energy_crisis',
      'ev_component_shortage',
      'ev_rate_hike',
      'ev_recession',
    ]);
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
