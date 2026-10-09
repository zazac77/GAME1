import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompanyDecisions, GameState } from '../../src';
import { productsSystem } from '../../src/systems/products';
import { marketShares, segmentShares, type Offer } from '../../src/systems/products/logit';
import { emptyDecisions, validationSystem } from '../../src/systems/validation';
import { mainProductLine } from '../../src/sectors/industry';
import { newGame, playerCompanyId, resolveAll } from '../helpers';

const SYSTEMS = [validationSystem, productsSystem];
const run = (state: GameState, decisions: CompanyDecisions[] = []) =>
  resolveAll(state, decisions, { systems: SYSTEMS });

const segments = newGame(1).productMarkets.mkt_appliances?.segments ?? [];
const [priceSegment, qualitySegment] = segments;
const offer = (o: Partial<Offer> = {}): Offer => ({
  price: 320,
  quality: 50,
  brand: 50,
  marketing: 0,
  ...o,
});

const offerArb = fc.record({
  price: fc.double({ min: 10, max: 3000, noNaN: true }),
  quality: fc.double({ min: 0, max: 100, noNaN: true }),
  brand: fc.double({ min: 0, max: 100, noNaN: true }),
  marketing: fc.double({ min: 0, max: 1e7, noNaN: true }),
});

describe('products: logit', () => {
  it('shares are positive and sum to less than 1 (outside option)', () => {
    fc.assert(
      fc.property(fc.array(offerArb, { minLength: 1, maxLength: 7 }), (offers) => {
        const shares = marketShares(segments, offers, 320, 10000);
        const total = shares.reduce((s, x) => s + x, 0);
        expect(shares.every((s) => s >= 0 && Number.isFinite(s))).toBe(true);
        expect(total).toBeLessThan(1);
        expect(total).toBeGreaterThan(0);
      }),
    );
  });

  it('a higher price lowers its own share and raises the others', () => {
    fc.assert(
      fc.property(
        fc.array(offerArb, { minLength: 2, maxLength: 5 }),
        fc.double({ min: 1.01, max: 3, noNaN: true }),
        (offers, bump) => {
          const base = marketShares(segments, offers, 320, 10000);
          const dearer = offers.map((o, i) => (i === 0 ? { ...o, price: o.price * bump } : o));
          const after = marketShares(segments, dearer, 320, 10000);
          expect(after[0]).toBeLessThan(base[0] ?? 0);
          expect(after[1]).toBeGreaterThanOrEqual(base[1] ?? 0);
        },
      ),
    );
  });

  it('price-sensitive buyers favour the cheap offer, quality buyers the good one', () => {
    if (!priceSegment || !qualitySegment) throw new Error('segments');
    const offers = [offer({ price: 280, quality: 40 }), offer({ price: 370, quality: 75 })];
    const p = segmentShares(priceSegment, offers, 320, 10000);
    const q = segmentShares(qualitySegment, offers, 320, 10000);
    expect(p[0]).toBeGreaterThan(p[1] ?? 0);
    expect(q[1]).toBeGreaterThan(q[0] ?? 0);
  });

  it('stays finite for extreme utilities', () => {
    if (!priceSegment) throw new Error('segments');
    const s = segmentShares(priceSegment, [offer({ price: 1e-6 }), offer({ price: 1e9 })], 320, 1);
    expect(s.every(Number.isFinite)).toBe(true);
    expect(s[0]).toBeCloseTo(1, 6);
  });
});

describe('products: market', () => {
  const setup = () => {
    const state = newGame(2);
    for (const c of Object.values(state.companies)) {
      const line = mainProductLine(state, c);
      if (line) c.inventory[line.id] = { qty: 30000, avgCost: 120 };
    }
    return state;
  };

  it('sells within the stock and books revenue and cost of goods sold', () => {
    const state = setup();
    const { state: next, ctx } = run(state);
    const market = next.productMarkets.mkt_appliances;
    if (!market) throw new Error('no market');
    expect(market.lastResult.volume).toBeGreaterThan(0);
    expect(market.lastResult.volume).toBeLessThanOrEqual(market.lastResult.demand + 1e-6);
    const shares = Object.values(market.lastResult.shares);
    expect(shares.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 9);
    for (const c of Object.values(next.companies)) {
      const line = mainProductLine(next, c);
      if (!line) continue;
      const sold = 30000 - (c.inventory[line.id]?.qty ?? 0);
      expect(sold).toBeGreaterThanOrEqual(0);
      expect(ctx.ledger(c.id).revenue).toBeCloseTo(sold * line.price, 4);
      expect(ctx.ledger(c.id).cogs).toBeCloseTo(sold * 120, 4);
    }
  });

  it('a lower price wins volume; demand falls when the market gets dearer', () => {
    const state = setup();
    const id = playerCompanyId(state);
    const line = mainProductLine(state, state.companies[id] as never);
    if (!line) throw new Error('no line');
    const cheap = emptyDecisions(id);
    cheap.pricing[line.id] = { price: line.price * 0.85 };
    const base = run(structuredClone(state)).state.productMarkets.mkt_appliances?.lastResult;
    const after = run(structuredClone(state), [cheap]).state.productMarkets.mkt_appliances
      ?.lastResult;
    expect(after?.shares[line.id]).toBeGreaterThan(base?.shares[line.id] ?? 1);

    const dear = structuredClone(state);
    for (const c of Object.values(dear.companies)) {
      for (const l of Object.values(c.productLines)) l.price *= 1.3;
    }
    expect(run(dear).state.productMarkets.mkt_appliances?.lastResult.demand).toBeLessThan(
      base?.demand ?? 0,
    );
  });

  it('customers of a seller out of stock partly turn to the others', () => {
    const state = setup();
    const id = playerCompanyId(state);
    const line = mainProductLine(state, state.companies[id] as never);
    if (!line) throw new Error('no line');
    const base = run(structuredClone(state));
    const empty = structuredClone(state);
    const lot = empty.companies[id]?.inventory[line.id];
    if (lot) lot.qty = 0;
    const out = run(empty);
    const others = (r: typeof base) =>
      Object.keys(state.companies)
        .filter((c) => c !== id && state.companies[c]?.sector === 'industry')
        .reduce((s, c) => s + r.ctx.ledger(c).unitsSold, 0);
    expect(out.ctx.ledger(id).unitsSold).toBe(0);
    expect(others(out)).toBeGreaterThan(others(base));
    // …but not all of them (spillover loss).
    expect(others(out)).toBeLessThan(
      base.state.productMarkets.mkt_appliances?.lastResult.volume ?? 0,
    );
  });

  it('marketing builds brand, which decays without it', () => {
    const state = setup();
    const id = playerCompanyId(state);
    const line = mainProductLine(state, state.companies[id] as never);
    if (!line) throw new Error('no line');
    const brand = state.companies[id]?.brand ?? 0;
    const d = emptyDecisions(id);
    d.marketing[line.id] = 2_000_000;
    const { state: loud, ctx } = run(structuredClone(state), [d]);
    expect(ctx.ledger(id).marketing).toBe(2_000_000);
    expect(loud.companies[id]?.brand).toBeGreaterThan(brand);
    expect(run(structuredClone(state)).state.companies[id]?.brand).toBeLessThan(brand);
  });

  it('a demand modifier scales the market', () => {
    const state = setup();
    const base =
      run(structuredClone(state)).state.productMarkets.mkt_appliances?.lastResult.demand ?? 0;
    state.modifiers.push({
      id: 'mod_r',
      sourceId: 'ev_recession',
      target: { kind: 'global' },
      key: 'market.demand',
      op: 'mul',
      value: 0.95,
      remaining: 1,
      decay: 0,
    });
    expect(run(state).state.productMarkets.mkt_appliances?.lastResult.demand).toBeCloseTo(
      base * 0.95,
      4,
    );
  });
});
