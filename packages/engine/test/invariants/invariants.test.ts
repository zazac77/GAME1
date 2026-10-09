import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompanyDecisions, GameState } from '../../src';
import { defaultConfig } from '../../src/config/default';
import { fixedAssetValue, isOperating, trainees } from '../../src/core/companies';
import { laborPoolKey } from '../../src/core/keys';
import { sum } from '../../src/core/math';
import { industryModule, mainProductLine } from '../../src/sectors/industry';
import { unemployed } from '../../src/systems/labor/pools';
import { emptyDecisions } from '../../src/systems/validation';
import { resolveTurn } from '../../src';
import { assertJsonSafe, newGame, resolveAll } from '../helpers';

// ---- random decisions, expressed relative to the state they apply to --------

const occupations = Object.keys(defaultConfig.labor.occupations);
const commodities = Object.keys(defaultConfig.commodities.markets);

const specArb = fc.record({
  priceFactor: fc.double({ min: 0.05, max: 8, noNaN: true }),
  qualityTarget: fc.double({ min: -20, max: 130, noNaN: true }),
  production: fc.option(fc.double({ min: 0, max: 60000, noNaN: true })),
  hires: fc.array(fc.nat(300), { minLength: 5, maxLength: 5 }),
  fires: fc.array(fc.nat(120), { minLength: 5, maxLength: 5 }),
  wageFactor: fc.double({ min: 0.2, max: 4, noNaN: true }),
  train: fc.nat(40),
  spotFactor: fc.double({ min: 0, max: 3, noNaN: true }),
  limitFactor: fc.option(fc.double({ min: 0.3, max: 2, noNaN: true })),
  contract: fc.option(
    fc.record({
      commodity: fc.nat(commodities.length - 1),
      qtyFactor: fc.double({ min: 0, max: 1.5, noNaN: true }),
      quarters: fc.integer({ min: 0, max: 10 }),
    }),
  ),
  marketing: fc.double({ min: 0, max: 3e6, noNaN: true }),
  borrow: fc.double({ min: 0, max: 3e7, noNaN: true }),
  repay: fc.double({ min: 0, max: 2e7, noNaN: true }),
  capex: fc.array(
    fc.record({
      kind: fc.constantFrom('build_site', 'add_line', 'modernize_line', 'sell_line', 'sell_site'),
      pick: fc.nat(20),
    }),
    { maxLength: 3 },
  ),
  stock: fc.option(
    fc.record({
      target: fc.nat(3),
      side: fc.constantFrom<'buy' | 'sell'>('buy', 'sell'),
      shares: fc.nat(300_000),
      limitFactor: fc.option(fc.double({ min: 0.5, max: 2, noNaN: true })),
    }),
  ),
  garbage: fc.boolean(),
});
type Spec = fc.Arbitrary<typeof specArb extends fc.Arbitrary<infer T> ? T : never>;
type DecisionSpec = Spec extends fc.Arbitrary<infer T> ? T : never;

function decisionsFrom(state: GameState, companyId: string, spec: DecisionSpec): CompanyDecisions {
  const d = emptyDecisions(companyId);
  const company = state.companies[companyId];
  if (!company || !isOperating(company)) return d;
  const line = mainProductLine(state, company);
  if (!line) return d;
  const ref = (state.productMarkets[line.marketId]?.refPrice ?? 1) * state.macro.priceLevel;
  d.pricing[line.id] = { price: ref * spec.priceFactor, qualityTarget: spec.qualityTarget };
  const site = Object.keys(company.sites)[0];
  if (site && spec.production !== null) d.production[site] = { targetOutput: spec.production };
  occupations.forEach((occupationId, i) => {
    const pool = state.labor[laborPoolKey(company.hqRegionId, occupationId)];
    d.hr.push({
      regionId: company.hqRegionId,
      occupationId,
      hire: spec.hires[i] ?? 0,
      fire: spec.fires[i] ?? 0,
      wageOffer: (pool?.marketWage ?? 1) * spec.wageFactor,
      ...(i === 0 && spec.train > 0
        ? { train: { toOccupationId: 'occ_technician', count: spec.train } }
        : {}),
    });
  });
  const planned = industryModule.plannedOutput(state, company, undefined);
  const perUnit = industryModule.materialsPerUnit(state, company, line);
  for (const commodityId of commodities) {
    const market = state.commodities[commodityId];
    const qty = planned * (perUnit[commodityId] ?? 0) * spec.spotFactor;
    const order: CompanyDecisions['purchasing']['spot'][number] = { commodityId, qty };
    if (spec.limitFactor !== null) order.limitPrice = (market?.spotPrice ?? 1) * spec.limitFactor;
    d.purchasing.spot.push(order);
  }
  if (spec.contract) {
    const commodityId = commodities[spec.contract.commodity] ?? 'com_steel';
    d.purchasing.newContracts.push({
      commodityId,
      qtyPerQuarter: planned * (perUnit[commodityId] ?? 0) * spec.contract.qtyFactor,
      quarters: spec.contract.quarters,
    });
  }
  d.marketing[line.id] = spec.marketing;
  d.finance = { borrow: spec.borrow, repay: spec.repay };
  const regions = Object.keys(state.regions).sort();
  const sites = Object.keys(company.sites).sort();
  for (const o of spec.capex) {
    const siteId = sites[o.pick % Math.max(1, sites.length)] ?? 'site_x';
    const lineIds = Object.keys(company.sites[siteId]?.lines ?? {}).sort();
    const lineId = lineIds[o.pick % Math.max(1, lineIds.length)] ?? 'line_x';
    if (o.kind === 'build_site') {
      d.capex.push({ kind: 'build_site', regionId: regions[o.pick % regions.length] ?? '' });
    } else if (o.kind === 'add_line' || o.kind === 'sell_site')
      d.capex.push({ kind: o.kind, siteId });
    else d.capex.push({ kind: o.kind, siteId, lineId });
  }
  if (spec.stock) {
    const others = Object.keys(state.companies).sort();
    const targetId = others[spec.stock.target % others.length] ?? '';
    const order: CompanyDecisions['stockOrders'][number] = {
      targetId,
      side: spec.stock.side,
      shares: spec.stock.shares,
    };
    const price = state.stock.quotes[targetId]?.price ?? 1;
    if (spec.stock.limitFactor !== null) order.limitPrice = price * spec.stock.limitFactor;
    d.stockOrders.push(order);
  }
  if (spec.garbage) {
    // Validation must survive anything a buggy UI or planner could send.
    d.pricing[line.id] = { price: Number.NaN };
    d.hr.push({
      regionId: 'reg_nord',
      occupationId: 'occ_x',
      hire: -1,
      fire: Infinity,
      wageOffer: 0,
    });
    d.purchasing.spot.push({ commodityId: 'com_steel', qty: -5 });
    d.marketing[line.id] = Number.POSITIVE_INFINITY;
    d.finance.borrow = Number.NaN;
  }
  return d;
}

// ---- invariants ------------------------------------------------------------------

function checkInvariants(before: GameState, after: GameState): void {
  assertJsonSafe(after); // no NaN, no Infinity, plain JSON
  const turn = before.meta.turn;

  for (const c of Object.values(after.companies)) {
    const { balance: b, cashFlow, quarter } = c.books.current;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets;
    const liabilities = b.debt + b.equity + b.minorityInterests;
    // actif = passif
    expect(Math.abs(assets - liabilities)).toBeLessThanOrEqual(
      1e-6 * Math.max(1, Math.abs(assets)),
    );
    expect(b.cash).toBeGreaterThanOrEqual(0); // the overdraft covers any shortfall
    expect(b.debt).toBeGreaterThanOrEqual(0);
    if (quarter === turn) {
      const opening = before.companies[c.id]?.books.current.balance.cash ?? 0;
      expect(b.cash - opening).toBeCloseTo(cashFlow.netChange, 3);
      expect(b.debt).toBeCloseTo(sum(c.loans.map((l) => l.principal)), 3);
    }
    for (const loan of c.loans) expect(loan.principal).toBeGreaterThan(0);
    // stocks ≥ 0
    for (const lot of Object.values(c.inventory)) {
      expect(lot.qty).toBeGreaterThanOrEqual(0);
      expect(lot.avgCost).toBeGreaterThanOrEqual(0);
    }
    for (const staff of Object.values(c.workforce)) {
      expect(Number.isInteger(staff.headcount)).toBe(true);
      expect(staff.headcount).toBeGreaterThanOrEqual(0);
      expect(staff.rampingUp).toBeGreaterThanOrEqual(0);
      expect(staff.rampingUp + trainees(staff)).toBeLessThanOrEqual(staff.headcount);
      expect(staff.wage).toBeGreaterThan(0);
      for (const batch of staff.inTraining) expect(batch.count).toBeGreaterThan(0);
    }
    for (const line of Object.values(c.productLines)) {
      expect(line.quality).toBeGreaterThanOrEqual(0);
      expect(line.quality).toBeLessThanOrEqual(100);
      expect(line.price).toBeGreaterThan(0);
    }
    expect(c.brand).toBeGreaterThanOrEqual(0);
    expect(c.brand).toBeLessThanOrEqual(100);
    if (c.status === 'bankrupt') expect(c.workforce).toEqual({});
    if (quarter === turn) {
      // Fixed assets = Σ book values; financial assets at fair value.
      expect(b.fixedAssets).toBeCloseTo(fixedAssetValue(c), 3);
      const fairValue = sum(
        Object.entries(after.stock.registry).map(
          ([t, register]) => (register[c.id] ?? 0) * (after.stock.quotes[t]?.price ?? 0),
        ),
      );
      expect(b.financialAssets).toBeCloseTo(fairValue, 3);
      expect(c.books.history.at(-1)).toEqual(c.books.current);
    }
    for (const site of Object.values(c.sites)) {
      expect(site.buildingBookValue).toBeGreaterThanOrEqual(0);
      // Projects due are commissioned (a bankrupt company's assets are frozen).
      const live = isOperating(c);
      if (live && site.status === 'under_construction')
        expect(site.completesAt).toBeGreaterThan(turn);
      for (const l of Object.values(site.lines)) {
        expect(l.bookValue).toBeGreaterThanOrEqual(0);
        if (live && l.status !== 'operational') expect(l.completesAt).toBeGreaterThan(turn);
      }
    }
  }

  // Shares outstanding = Σ registry; no negative holding.
  for (const [companyId, register] of Object.entries(after.stock.registry)) {
    for (const n of Object.values(register)) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
    expect(sum(Object.values(register))).toBe(after.companies[companyId]?.sharesOutstanding);
  }
  for (const q of Object.values(after.stock.quotes)) {
    expect(q.price).toBeGreaterThanOrEqual(after.config.stockMarket.minPrice);
  }
  expect(after.stock.index.value).toBeGreaterThan(0);

  // Conservation of labor: unemployed = laborForce − outside − Σ headcount ≥ 0.
  for (const [key, pool] of Object.entries(after.labor)) {
    expect(unemployed(after, key as `${string}:${string}`)).toBeGreaterThanOrEqual(-1e-6);
    expect(pool.outsideEmployment).toBeGreaterThanOrEqual(0);
    expect(pool.marketWage).toBeGreaterThan(0);
  }
  for (const m of Object.values(after.commodities)) {
    expect(m.spotPrice).toBeGreaterThan(0);
    expect(m.worldPrice).toBeGreaterThan(0);
  }
  for (const m of Object.values(after.productMarkets)) {
    expect(m.lastResult.volume).toBeLessThanOrEqual(m.lastResult.demand + 1e-6);
    const total = sum(Object.values(m.lastResult.shares));
    if (m.lastResult.volume > 0) expect(total).toBeCloseTo(1, 9);
  }
}

describe('invariants (property-based)', () => {
  it('hold for any seed and any decisions, events included', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.boolean(),
        fc.array(fc.array(specArb, { minLength: 4, maxLength: 4 }), { minLength: 6, maxLength: 6 }),
        (seed, eventful, turns) => {
          const overrides = eventful
            ? {
                events: {
                  definitions: defaultConfig.events.definitions.map((d) => ({
                    ...d,
                    probability: 0.4,
                  })),
                },
              }
            : undefined;
          let state = newGame(seed, overrides, { mode: 'sandbox' });
          const ids = Object.keys(state.companies).sort();
          for (const specs of turns) {
            const decisions = ids.map((id, i) =>
              decisionsFrom(state, id, specs[i] as DecisionSpec),
            );
            const next = resolveAll(state, decisions).state;
            checkInvariants(state, next);
            state = next;
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  it('hold over games played by the AI planners (investments and disposals included)', () => {
    for (const seed of [2, 99]) {
      let state = newGame(seed, undefined, { mode: 'sandbox', playerProfileId: 'low_cost' });
      for (let t = 0; t < 30; t++) {
        const next = resolveTurn(state, []).state;
        checkInvariants(state, next);
        state = next;
      }
      expect(state.log.some((e) => e.kind === 'capex_started')).toBe(true);
    }
  });

  it('hold over a long game of passive companies (distress and bankruptcies)', () => {
    let state = newGame(77, undefined, { mode: 'sandbox' });
    const passive = Object.keys(state.companies).map((id) => emptyDecisions(id));
    for (let t = 0; t < 30; t++) {
      // Submitted (empty) decisions keep the AI planners out.
      const next = resolveAll(state, passive).state;
      checkInvariants(state, next);
      state = next;
    }
    // Nobody buys materials: everyone ends up bankrupt, and the books still balance.
    expect(Object.values(state.companies).every((c) => c.status === 'bankrupt')).toBe(true);
  });
});
