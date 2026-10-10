import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CompanyDecisions, GameState, IntraGroupTransfer } from '../../src';
import { defaultConfig } from '../../src/config/default';
import {
  controlledCompanyIds,
  fixedAssetValue,
  isOperating,
  trainees,
} from '../../src/core/companies';
import { groupLoansGranted } from '../../src/core/group';
import { laborPoolKey } from '../../src/core/keys';
import { sum } from '../../src/core/math';
import { sectorModule } from '../../src/sectors';
import { farmlandLeft } from '../../src/sectors/agri/farm';
import { plantConfig, sectorProductLine, techConfigOf } from '../../src/sectors/config';
import { unemployed } from '../../src/systems/labor/pools';
import { holdings, holdingsCarrying } from '../../src/systems/stockmarket';
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
  hires: fc.array(fc.nat(300), { minLength: occupations.length, maxLength: occupations.length }),
  fires: fc.array(fc.nat(120), { minLength: occupations.length, maxLength: occupations.length }),
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
  listing: fc.double({ min: 0, max: 2e6, noNaN: true }),
  borrow: fc.double({ min: 0, max: 3e7, noNaN: true }),
  repay: fc.double({ min: 0, max: 2e7, noNaN: true }),
  capex: fc.array(
    fc.record({
      kind: fc.constantFrom(
        'build_site',
        'buy_farm',
        'add_line',
        'modernize_line',
        'sell_line',
        'sell_site',
      ),
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
  rnd: fc.array(
    fc.record({
      type: fc.constantFrom<'process' | 'product'>('process', 'product'),
      budget: fc.double({ min: 0, max: 3e6, noNaN: true }),
      developers: fc.option(fc.nat(200)),
      staleId: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  equity: fc.record({
    dividend: fc.double({ min: 0, max: 5e6, noNaN: true }),
    issue: fc.nat(600_000),
    buyback: fc.nat(300_000),
    ipo: fc.boolean(),
  }),
  deal: fc.option(
    fc.record({
      kind: fc.constantFrom<'due_diligence' | 'tender_offer' | 'private_purchase'>(
        'due_diligence',
        'tender_offer',
        'private_purchase',
      ),
      pick: fc.nat(30),
      premium: fc.double({ min: -0.2, max: 1.5, noNaN: true }),
      stockShare: fc.double({ min: 0, max: 1, noNaN: true }),
      debt: fc.double({ min: 0, max: 5e7, noNaN: true }),
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
  const line = sectorProductLine(state.config, company);
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
  const module = sectorModule(company.sector);
  const planned = module?.plannedOutput(state, company, undefined) ?? 0;
  const perUnit = module?.materialsPerUnit(state, company, line) ?? {};
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
  d.listing[line.id] = spec.listing; // refused outside agrifood
  d.finance = {
    borrow: spec.borrow,
    repay: spec.repay,
    dividend: spec.equity.dividend,
    issueShares: spec.equity.issue,
    buyback: spec.equity.buyback,
    ipo: spec.equity.ipo,
  };
  if (spec.deal) {
    const targets = [
      ...state.mna.listings.map((l) => l.id),
      ...Object.keys(state.companies).sort(),
    ];
    const targetId = targets[spec.deal.pick % targets.length] ?? '';
    const ref = state.stock.quotes[targetId]?.referencePrice ?? 1;
    d.mna.push(
      spec.deal.kind === 'due_diligence'
        ? { kind: 'due_diligence', targetId }
        : {
            kind: spec.deal.kind,
            targetId,
            pricePerShare: ref * (1 + spec.deal.premium),
            stockShare: spec.deal.stockShare,
            debt: spec.deal.debt,
          },
    );
  }
  const regions = Object.keys(state.regions).sort();
  const sites = Object.keys(company.sites).sort();
  for (const o of spec.capex) {
    const siteId = sites[o.pick % Math.max(1, sites.length)] ?? 'site_x';
    const lineIds = Object.keys(company.sites[siteId]?.lines ?? {}).sort();
    const lineId = lineIds[o.pick % Math.max(1, lineIds.length)] ?? 'line_x';
    if (o.kind === 'build_site' || o.kind === 'buy_farm') {
      d.capex.push({ kind: o.kind, regionId: regions[o.pick % regions.length] ?? '' });
    } else if (o.kind === 'add_line' || o.kind === 'sell_site')
      d.capex.push({ kind: o.kind, siteId });
    else d.capex.push({ kind: o.kind, siteId, lineId });
  }
  for (const r of spec.rnd) {
    const project = company.rnd.find((p) => p.type === r.type);
    const entry: CompanyDecisions['rnd'][number] = { type: r.type, budget: r.budget };
    if (r.developers !== null) entry.developers = r.developers; // refused outside tech
    if (r.staleId) entry.projectId = project?.id ?? 'rnd_999';
    d.rnd.push(entry);
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
    d.rnd.push({ type: 'process', budget: Number.NaN });
    d.rnd.push({ type: 'product', budget: 0, developers: -3 });
  }
  return d;
}

// ---- invariants ------------------------------------------------------------------

function checkInvariants(before: GameState, after: GameState): void {
  assertJsonSafe(after); // no NaN, no Infinity, plain JSON
  const turn = before.meta.turn;

  for (const c of Object.values(after.companies)) {
    const { balance: b, cashFlow, quarter } = c.books.current;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets + b.groupLoans;
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
      // Intra-group loans granted = what the borrowers owe the company.
      expect(b.groupLoans).toBeCloseTo(groupLoansGranted(after, c.id), 3);
      expect(b.financialAssets).toBeCloseTo(sum(Object.values(c.stakeValues)), 3);
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
    for (const line of Object.values(c.productLines)) {
      if (line.distribution === undefined) continue;
      expect(line.distribution).toBeGreaterThanOrEqual(0);
      expect(line.distribution).toBeLessThanOrEqual(1);
    }
    // R&D: levels within bounds, at most one project per type, progress below completion.
    const tech = techConfigOf(after.config, c.sector);
    expect(c.processLevel).toBeGreaterThanOrEqual(0);
    expect(new Set(c.rnd.map((p) => p.type)).size).toBe(c.rnd.length);
    for (const p of c.rnd) {
      expect(p.progress).toBeGreaterThanOrEqual(0);
      expect(p.progress).toBeLessThan(1);
    }
    if (tech) {
      // Tech: the platform level is capped; releases never go beyond frontier + maxLead.
      expect(c.processLevel).toBeLessThanOrEqual(tech.rnd.maxLevel);
      for (const line of Object.values(c.productLines)) {
        const frontier = after.productMarkets[line.marketId]?.techFrontier ?? 0;
        expect(line.techLevel ?? 0).toBeGreaterThanOrEqual(0);
        expect(line.techLevel ?? 0).toBeLessThanOrEqual(frontier + tech.frontier.maxLead + 1e-9);
        expect(line.users ?? 0).toBeGreaterThanOrEqual(0);
        if (line.churn !== undefined) {
          expect(line.churn).toBeGreaterThanOrEqual(tech.subscription.minChurn);
          expect(line.churn).toBeLessThanOrEqual(tech.subscription.maxChurn);
        }
      }
      for (const p of c.rnd) expect(p.effort).toBeGreaterThan(0);
      expect(c.inventory).toEqual({});
      // Hires never take a region beyond the seats of its offices.
      const seats: Record<string, number> = {};
      for (const site of Object.values(c.sites)) {
        seats[site.regionId] = (seats[site.regionId] ?? 0) + (site.seats ?? 0);
      }
      for (const staff of Object.values(c.workforce)) {
        if (staff.lastQuarter.hired > 0) {
          const region = sum(
            Object.values(c.workforce)
              .filter((w) => w.regionId === staff.regionId)
              .map((w) => w.headcount),
          );
          expect(region).toBeLessThanOrEqual(seats[staff.regionId] ?? 0);
        }
      }
    } else if (c.sector !== 'holding') {
      const plant = plantConfig(after.config, c.sector);
      const maxLevel = plant.rnd.maxLevel;
      expect(c.processLevel).toBeLessThanOrEqual(maxLevel);
      for (const line of Object.values(c.productLines)) {
        expect(line.techLevel ?? 0).toBeGreaterThanOrEqual(0);
        expect(line.techLevel ?? 0).toBeLessThanOrEqual(maxLevel);
      }
      for (const p of c.rnd) {
        // Uncertain progress: a project overruns at most to cost / (1 − noise).
        const noise = plant.rnd.progressNoise;
        expect(p.spent).toBeLessThanOrEqual((p.cost / (1 - noise)) * (1 + 1e-9));
      }
    }
    if (quarter === turn) {
      const spent = sum(c.rnd.map((p) => p.spent));
      const before0 = sum(before.companies[c.id]?.rnd.map((p) => p.spent) ?? []);
      expect(c.books.current.pnl.rnd).toBeGreaterThanOrEqual(0);
      // Without completions, what the projects absorbed is what the books expensed.
      if (
        !after.log.some(
          (e) => e.kind === 'rnd_completed' && e.companyId === c.id && e.turn === turn,
        )
      ) {
        expect(spent - before0).toBeCloseTo(c.books.current.pnl.rnd, 3);
      }
    }
    expect(c.brand).toBeGreaterThanOrEqual(0);
    expect(c.brand).toBeLessThanOrEqual(100);
    if (c.status === 'bankrupt') {
      expect(c.workforce).toEqual({});
      for (const line of Object.values(c.productLines)) expect(line.users ?? 0).toBe(0);
    }
    if (quarter === turn) {
      // Fixed assets = Σ book values; financial assets: minority stakes at fair value,
      // stakes in the group at cost (impaired below the recoverable value).
      expect(b.fixedAssets).toBeCloseTo(fixedAssetValue(c), 3);
      expect(b.financialAssets).toBeCloseTo(holdingsCarrying(after, c), 3);
      for (const [targetId, h] of Object.entries(holdings(after, c))) {
        expect(h.carrying).toBeGreaterThanOrEqual(0);
        if (!h.inGroup) expect(h.carrying).toBeCloseTo(h.fairValue, 6);
        else expect(c.participations[targetId]?.shares).toBe(h.shares);
      }
      expect(c.books.current.shares).toBe(c.sharesOutstanding);
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

  // Intra-group loans: between companies, lent by an operating company to an operating one.
  for (const c of Object.values(after.companies)) {
    for (const loan of c.loans) {
      if (loan.kind !== 'group') continue;
      const lender = after.companies[loan.lenderId ?? ''];
      expect(lender).toBeDefined();
      expect(lender?.id).not.toBe(c.id);
      expect(isOperating(c) && lender !== undefined && isOperating(lender)).toBe(true);
    }
    // Consolidated accounts: assets = debt + equity + minorities; group share of the result.
    const cons = c.books.consolidated?.at(-1);
    if (!cons) continue;
    expect(cons.quarter).toBe(turn);
    const b = cons.balance;
    const assets = b.cash + b.inventory + b.fixedAssets + b.financialAssets + b.groupLoans;
    expect(Math.abs(assets - b.debt - b.equity - b.minorityInterests)).toBeLessThanOrEqual(
      1e-6 * Math.max(1, Math.abs(assets)),
    );
    expect(b.groupLoans).toBeGreaterThanOrEqual(-1e-6);
    const groupIncome = sum(Object.values(cons.members).map((m) => m.share * m.netIncome));
    expect(cons.pnl.netIncome - cons.minorityNetIncome).toBeCloseTo(groupIncome, 3);
    expect(cons.cashFlow.operating + cons.cashFlow.investing + cons.cashFlow.financing).toBeCloseTo(
      cons.cashFlow.netChange,
      3,
    );
    const members = Object.keys(cons.members);
    expect(members[0]).toBe(c.id);
    for (const m of Object.values(cons.members)) {
      expect(m.share).toBeGreaterThan(0);
      expect(m.share).toBeLessThanOrEqual(1 + 1e-9);
    }
  }

  // Farmland: owned hectares within the land of each region.
  const farm = after.config.sectors.agri?.farm;
  if (farm) {
    for (const regionId of Object.keys(after.regions)) {
      const owned = sum(
        Object.values(after.companies)
          .filter(isOperating)
          .flatMap((c) => Object.values(c.sites))
          .filter((s) => s.kind === 'farm' && s.regionId === regionId)
          .map((s) => s.hectares ?? 0),
      );
      expect(owned).toBeLessThanOrEqual(farm.landByRegion[regionId] ?? 0);
      expect(farmlandLeft(after, regionId)).toBeGreaterThanOrEqual(0);
    }
  }
  for (const region of Object.values(after.regions)) {
    expect(region.weather).toBeGreaterThan(0);
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
        fc.array(fc.array(specArb, { minLength: 10, maxLength: 10 }), {
          minLength: 6,
          maxLength: 6,
        }),
        (seed, eventful, turns) => {
          const overrides = {
            mna: { listings: { arrivalProbability: 1 } },
            ...(eventful
              ? {
                  events: {
                    definitions: defaultConfig.events.definitions.map((d) => ({
                      ...d,
                      probability: 0.4,
                    })),
                  },
                }
              : {}),
          };
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
  }, 60_000);

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

  it('hold through takeovers, public offerings and equity transactions', () => {
    let state = newGame(31, { mna: { listings: { arrivalProbability: 1 } } }, { mode: 'sandbox' });
    const id = Object.values(state.actors).find((a) => a.kind === 'player')?.rootCompanyId ?? '';
    for (let t = 0; t < 14; t++) {
      // A rich player, so that every kind of deal goes through.
      const b = state.companies[id]?.books.current.balance;
      if (b) {
        b.cash += 50_000_000;
        b.equity += 50_000_000;
      }
      const d = emptyDecisions(id);
      const listing = state.mna.listings[0];
      const rival = Object.keys(state.companies)
        .sort()
        .find((c) => c !== id && !controlledCompanyIds(state, state.meta.playerActorId).has(c));
      const ref = state.stock.quotes[rival ?? '']?.referencePrice ?? 1;
      if (t === 1 && listing) d.mna.push({ kind: 'due_diligence', targetId: listing.id });
      if (t === 2 && listing) d.mna.push({ kind: 'private_purchase', targetId: listing.id });
      if (t === 3 && rival) {
        d.mna.push({ kind: 'tender_offer', targetId: rival, pricePerShare: 1.6 * ref, debt: 1e7 });
      }
      if (t === 5 && rival) {
        d.mna.push({ kind: 'private_purchase', targetId: rival, pricePerShare: 2 * ref });
      }
      if (t === 4) d.finance.issueShares = 100_000;
      if (t === 6) d.finance.buyback = 50_000;
      if (t >= 7) d.finance.dividend = 500_000;
      const subs = [...controlledCompanyIds(state, state.meta.playerActorId)].filter(
        (c) => c !== id,
      );
      const decisions = [d, ...subs.map((c) => ({ ...emptyDecisions(c), finance: { ipo: true } }))];
      const next = resolveTurn(state, decisions).state;
      checkInvariants(state, next);
      state = next;
    }
    expect(state.log.some((e) => e.kind === 'takeover')).toBe(true);
    expect(state.log.some((e) => e.kind === 'ipo')).toBe(true);
  });

  it('hold through any intra-group transfers (holding, loans, dividends, pools, stakes)', () => {
    const transferArb = fc.record({
      kind: fc.constantFrom('dividend', 'loan', 'cash_pool', 'stake'),
      from: fc.nat(),
      to: fc.nat(),
      target: fc.nat(),
      amount: fc.double({ min: 0, max: 8e6, noNaN: true }),
      part: fc.double({ min: 0, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(fc.array(transferArb, { maxLength: 6 }), { minLength: 7, maxLength: 7 }),
        (seed, turns) => {
          let state = newGame(
            seed,
            { mna: { listings: { arrivalProbability: 1 } } },
            {
              mode: 'sandbox',
            },
          );
          const actorId = state.meta.playerActorId;
          turns.forEach((transfers, t) => {
            const rootId = state.actors[actorId]?.rootCompanyId ?? '';
            const b = state.companies[rootId]?.books.current.balance;
            if (b && t === 0) {
              b.cash += 60_000_000;
              b.equity += 60_000_000;
            }
            const group = [...controlledCompanyIds(state, actorId)].sort();
            const pick = (n: number) => group[n % group.length] ?? rootId;
            const decisions = new Map<string, CompanyDecisions>();
            const of = (id: string) => {
              if (!decisions.has(id)) decisions.set(id, emptyDecisions(id));
              return decisions.get(id) as CompanyDecisions;
            };
            const root = of(rootId);
            const listing = state.mna.listings[0];
            if (t <= 1 && listing)
              root.mna.push({ kind: 'private_purchase', targetId: listing.id });
            if (t === 2) root.createHolding = true;
            // Minorities: a subsidiary goes public when it can.
            for (const id of group) if (id !== rootId && t >= 4) of(id).finance.ipo = true;
            root.intraGroup = transfers.map((x): IntraGroupTransfer => {
              const fromId = pick(x.from);
              const toId = pick(x.to);
              if (x.kind === 'stake') {
                const held = Object.keys(state.stock.registry).filter(
                  (target) => (state.stock.registry[target]?.[fromId] ?? 0) > 0,
                );
                const targetId = held[x.target % Math.max(1, held.length)] ?? pick(x.target);
                const shares = state.stock.registry[targetId]?.[fromId] ?? 0;
                return {
                  kind: 'stake',
                  fromId,
                  toId,
                  targetId,
                  shares: Math.ceil(x.part * shares),
                };
              }
              return { kind: x.kind, fromId, toId, amount: x.amount };
            });
            const next = resolveTurn(state, [...decisions.values()]).state;
            checkInvariants(state, next);
            state = next;
          });
          expect(state.companies[state.actors[actorId]?.rootCompanyId ?? '']?.sector).toBe(
            'holding',
          );
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);

  it('hold over a long game of passive companies (distress and bankruptcies)', () => {
    let state = newGame(77, undefined, { mode: 'sandbox' });
    const passive = Object.keys(state.companies).map((id) => emptyDecisions(id));
    for (let t = 0; t < 30; t++) {
      // Submitted (empty) decisions keep the AI planners out.
      const next = resolveAll(state, passive).state;
      checkInvariants(state, next);
      state = next;
    }
    // Nobody buys materials: every plant ends up bankrupt, and the books still balance.
    // (Subscriptions keep billing without decisions: tech companies fade more slowly.)
    const plants = Object.values(state.companies).filter((c) => c.sector !== 'tech');
    expect(plants.every((c) => c.status === 'bankrupt')).toBe(true);
  });
});
