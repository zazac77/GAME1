import { describe, expect, it } from 'vitest';
import type { CompanyDecisions, GameState, Modifier } from '../../src';
import { commoditiesSystem } from '../../src/systems/commodities';
import { emptyDecisions, validationSystem } from '../../src/systems/validation';
import { newGame, playerCompanyId, resolveAll } from '../helpers';

const SYSTEMS = [validationSystem, commoditiesSystem];
const run = (state: GameState, decisions: CompanyDecisions[] = []) =>
  resolveAll(state, decisions, { systems: SYSTEMS });

const setup = (overrides = {}) => {
  const state = newGame(4, { scenario: { initialJitter: 0 }, ...overrides });
  const id = playerCompanyId(state);
  // The other steel buyers: the industry companies.
  const others = Object.keys(state.companies).filter(
    (c) => c !== id && state.companies[c]?.sector === 'industry',
  );
  // Plenty of cash so that the budget never binds in these tests.
  for (const c of Object.values(state.companies)) c.books.current.balance.cash = 1e9;
  return { state, id, others };
};

const spot = (id: string, qty: number, limitPrice?: number): CompanyDecisions => {
  const d = emptyDecisions(id);
  const order: CompanyDecisions['purchasing']['spot'][number] = { commodityId: 'com_steel', qty };
  if (limitPrice !== undefined) order.limitPrice = limitPrice;
  d.purchasing.spot.push(order);
  return d;
};

const shortage: Modifier[] = [
  { key: 'commodity.supply', value: 0.7 },
  { key: 'commodity.price', value: 1.4 },
].map((m, i) => ({
  id: `mod_${i}`,
  sourceId: 'ev_component_shortage',
  target: { kind: 'commodity', id: 'com_steel' },
  key: m.key as Modifier['key'],
  op: 'mul',
  value: m.value,
  remaining: 2,
  decay: 0,
}));

describe('commodities', () => {
  it('the spot price rises with aggregate demand (P = Pw·(D/Dref)^η)', () => {
    const { state, id, others } = setup();
    const ref = state.commodities.com_steel?.refDemand ?? 0;
    const low = run(structuredClone(state), [spot(id, ref * 0.5)]).state.commodities.com_steel;
    const high = run(structuredClone(state), [
      spot(id, ref * 0.5),
      ...others.map((o) => spot(o, ref * 0.5)),
    ]).state.commodities.com_steel;
    const world = state.commodities.com_steel?.worldPrice ?? 0;
    expect(high?.spotPrice).toBeGreaterThan(low?.spotPrice ?? Infinity);
    expect(high?.lastSimDemand).toBeCloseTo(ref * 2, 6);
    expect(high?.spotPrice).toBeCloseTo(world * 2 ** 0.3, 6);
  });

  it('delivers spot purchases into stock at the clearing price plus the spot premium', () => {
    const { state, id } = setup();
    const before = state.companies[id]?.inventory.com_steel;
    const { state: next, ctx } = run(state, [spot(id, 500)]);
    const price = (next.commodities.com_steel?.spotPrice ?? 0) * 1.02;
    const lot = next.companies[id]?.inventory.com_steel;
    expect(lot?.qty).toBeCloseTo((before?.qty ?? 0) + 500, 6);
    expect(ctx.ledger(id).purchases).toBeCloseTo(500 * price, 4);
    const expectedAvg =
      ((before?.qty ?? 0) * (before?.avgCost ?? 0) + 500 * price) / (lot?.qty ?? 1);
    expect(lot?.avgCost).toBeCloseTo(expectedAvg, 6);
  });

  it('fills a limit order only while the price meets its limit', () => {
    const { state, id } = setup();
    const ref = state.commodities.com_steel?.refDemand ?? 0;
    const world = state.commodities.com_steel?.worldPrice ?? 0;
    const ample = run(structuredClone(state), [spot(id, ref, world * 10)]).ctx.ledger(id).purchases;
    const tight = run(structuredClone(state), [spot(id, ref * 2, world * 1.05)]);
    const none = run(structuredClone(state), [spot(id, ref, world * 0.01)]);
    expect(ample).toBeGreaterThan(0);
    // Cut by tranches until P ≤ limit.
    expect(tight.state.commodities.com_steel?.spotPrice).toBeLessThanOrEqual(world * 1.05);
    expect(tight.ctx.ledger(id).purchases).toBeGreaterThan(0);
    expect(tight.ctx.ledger(id).purchases).toBeLessThan(ref * 2 * world);
    expect(none.ctx.ledger(id).purchases).toBe(0);
  });

  it('signs contracts at the forward price and delivers them each quarter until they end', () => {
    const { state, id } = setup();
    const d = emptyDecisions(id);
    d.purchasing.newContracts.push({ commodityId: 'com_steel', qtyPerQuarter: 100, quarters: 2 });
    const world = state.commodities.com_steel?.worldPrice ?? 0;
    let s = run(state, [d]).state;
    const contract = s.companies[id]?.contracts[0];
    const ref = state.commodities.com_steel?.refDemand ?? 1;
    const discount = 0.05 * Math.min(1, 100 / (ref * 0.25));
    expect(contract?.price).toBeCloseTo(world * 1.03 * (1 - discount), 6);
    expect(contract).toMatchObject({ startsAt: 0, endsAt: 2, qtyPerQuarter: 100 });
    const qty = () => s.companies[id]?.inventory.com_steel?.qty ?? 0;
    const q1 = qty();
    s.meta.turn = 1;
    s = run(s).state;
    expect(qty()).toBeCloseTo(q1 + 100, 6);
    s.meta.turn = 2;
    s = run(s).state;
    expect(qty()).toBeCloseTo(q1 + 100, 6); // expired
  });

  it('a shortage raises prices and rations deliveries', () => {
    const { state, id } = setup();
    const calm = run(structuredClone(state), [spot(id, 1000)]);
    state.modifiers.push(...shortage);
    const short = run(state, [spot(id, 1000)]);
    const qty = (r: typeof calm) =>
      (r.state.companies[id]?.inventory.com_steel?.qty ?? 0) -
      (state.companies[id]?.inventory.com_steel?.qty ?? 0);
    expect(qty(short)).toBeCloseTo(700, 6);
    expect(qty(calm)).toBeCloseTo(1000, 6);
    expect(short.state.commodities.com_steel?.spotPrice).toBeCloseTo(
      (calm.state.commodities.com_steel?.spotPrice ?? 0) * 1.4,
      6,
    );
  });

  it('world prices revert to their (inflation-indexed) anchor', () => {
    const { state } = setup({
      commodities: { markets: { com_steel: { volatility: 0 } } },
    });
    const market = state.commodities.com_steel;
    if (!market) throw new Error('no steel');
    market.worldPrice = 1400; // twice the anchor
    let s = state;
    for (let t = 0; t < 12; t++) {
      s = run(s).state;
      s.meta.turn += 1;
    }
    const price = s.commodities.com_steel?.worldPrice ?? 0;
    expect(price).toBeLessThan(800);
    expect(price).toBeGreaterThan(690);
  });
});
