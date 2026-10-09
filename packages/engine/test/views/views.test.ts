import { describe, expect, it } from 'vitest';
import {
  defaultDecisions,
  getPlayerView,
  previewDecisions,
  resolveTurn,
  type Company,
  type GameState,
} from '../../src';
import { hashState } from '../../src/core/hash';
import { laborPoolKey } from '../../src/core/keys';
import { companyAlerts } from '../../src/views/alerts';
import { assertJsonSafe, newGame, playTurns, playerCompanyId, steadyDecisions } from '../helpers';

const player = (s: GameState) => s.companies[playerCompanyId(s)] as Company;

describe('getPlayerView', () => {
  it('shows the own company in full, the rivals partially, and filters journal and history', () => {
    const state = playTurns(newGame(13), 4);
    const id = playerCompanyId(state);
    const rival = Object.keys(state.companies).find((c) => c !== id) ?? '';
    state.log.push({ turn: 3, kind: 'overdraft', severity: 'warning', companyId: rival });
    state.log.push({ turn: 3, kind: 'company_distressed', severity: 'critical', companyId: rival });
    const view = getPlayerView(state);
    assertJsonSafe(view);
    expect(view.self.company).toEqual(state.companies[id]);
    expect(view.competitors.map((c) => c.companyId)).not.toContain(id);
    expect(view.log.some((e) => e.kind === 'overdraft' && e.companyId === rival)).toBe(false);
    expect(view.log.some((e) => e.kind === 'company_distressed')).toBe(true);
    expect(Object.keys(view.history.series).some((k) => k.startsWith(`company.${rival}.`))).toBe(
      false,
    );
    expect(view.history.series[`company.${id}.cash`]).toBeDefined();
    expect(view.history.series['macro.inflation']).toBeDefined();
    const held = state.stock.registry[id]?.[state.meta.playerActorId] ?? 0;
    expect(view.score).toBeCloseTo(held * (state.stock.quotes[id]?.price ?? 0), 6);
    expect(view.actor.id).toBe(state.meta.playerActorId);
  });

  it('quotes the one-shot decisions at the prices validation charges', () => {
    const state = playTurns(newGame(13), 2);
    const id = playerCompanyId(state);
    const company = player(state);
    const costs = getPlayerView(state).costs;
    const cfg = state.config.sectors.industry;
    const site = Object.values(company.sites)[0];
    const line = Object.values(site?.lines ?? {})[0];
    expect(costs?.addLine).toBeCloseTo(cfg.line.buildCost * state.macro.priceLevel, 6);
    expect(costs?.buildSite.reg_nord).toBeCloseTo(
      cfg.factory.buildCost * (state.regions.reg_nord?.landCostIndex ?? 0) * state.macro.priceLevel,
      6,
    );
    expect(costs?.saleValue[line?.id ?? '']).toBeCloseTo(
      (line?.bookValue ?? 0) * (1 - cfg.assetResaleDiscount),
      6,
    );
    // An R&D budget at the quoted maximum goes through validation untouched.
    const quote = costs?.rnd.product;
    expect(quote?.level).toBe(0);
    const d = {
      ...steadyDecisions(state, id),
      rnd: [{ type: 'product' as const, budget: quote?.maxBudget ?? 0 }],
    };
    const preview = previewDecisions(state, [d]);
    expect(preview.issues.filter((i) => i.path.startsWith('rnd'))).toEqual([]);
    expect(preview.companies[id]?.costs.rnd).toBeCloseTo(quote?.maxBudget ?? 0, 6);
    // Material needs follow the production target.
    const needs = preview.companies[id]?.materialNeeds ?? {};
    expect(Object.keys(needs).sort()).toEqual(Object.keys(cfg.recipe).sort());
    expect(needs.com_electronics).toBeGreaterThan(0);
  });
});

describe('defaultDecisions', () => {
  it('before the first quarter: keep prices and wages, buy the materials of full output', () => {
    const state = newGame(13);
    const company = player(state);
    const d = defaultDecisions(state, company.id);
    const line = Object.values(company.productLines)[0];
    expect(d.pricing[line?.id ?? '']?.price).toBe(line?.price);
    expect(d.hr).toHaveLength(Object.keys(company.workforce).length);
    for (const h of d.hr) {
      expect(h.wageOffer).toBe(company.workforce[laborPoolKey(h.regionId, h.occupationId)]?.wage);
    }
    expect(d.capex).toEqual([]);
    // The opening stock covers the first quarter; once depleted, materials are bought.
    for (const lot of Object.values(company.inventory)) lot.qty = 0;
    const steel = defaultDecisions(state, company.id).purchasing.spot.find(
      (o) => o.commodityId === 'com_steel',
    );
    const recipe = state.config.sectors.industry.recipe.com_steel ?? 0;
    expect(steel?.qty).toBeGreaterThan(0.5 * 25000 * recipe);
  });

  it('then repeats the last quarter without its one-shot parts', () => {
    const state = newGame(13);
    const id = playerCompanyId(state);
    const d0 = steadyDecisions(state, id);
    d0.finance = { borrow: 1000 };
    d0.capex = [{ kind: 'add_line', siteId: Object.keys(player(state).sites)[0] ?? '' }];
    const next = resolveTurn(state, [d0]).state;
    const d1 = defaultDecisions(next, id);
    const last = player(next).lastDecisions;
    expect(d1.pricing).toEqual(last?.pricing);
    expect(d1.marketing).toEqual(last?.marketing);
    expect(d1.production).toEqual(last?.production);
    expect(d1.capex).toEqual([]);
    expect(d1.finance).toEqual({});
    expect(d1.hr.every((h) => h.hire === 0 && h.fire === 0 && !h.train)).toBe(true);
    expect(d1.hr.map((h) => h.wageOffer)).toEqual(last?.hr.map((h) => h.wageOffer));
  });
});

describe('previewDecisions', () => {
  it('is deterministic and leaves the state alone', () => {
    const state = playTurns(newGame(13), 3);
    const d = steadyDecisions(state, playerCompanyId(state));
    const before = hashState(state);
    const a = previewDecisions(state, [d]);
    expect(previewDecisions(state, [d])).toEqual(a);
    expect(hashState(state)).toBe(before);
    assertJsonSafe(a);
  });

  it('accounts for investments, loans and the validation issues', () => {
    const state = playTurns(newGame(13), 3);
    const id = playerCompanyId(state);
    const d = steadyDecisions(state, id);
    const base = previewDecisions(state, [d]).companies[id];
    const siteId = Object.keys(player(state).sites)[0] ?? '';
    const invest = previewDecisions(state, [{ ...d, capex: [{ kind: 'add_line', siteId }] }]);
    const cost = state.config.sectors.industry.line.buildCost * state.macro.priceLevel;
    expect(invest.companies[id]?.capex).toBeCloseTo(cost, 6);
    expect(invest.companies[id]?.expectedCashEnd).toBeCloseTo(
      (base?.expectedCashEnd ?? 0) - cost,
      0,
    );
    const bad = previewDecisions(state, [{ ...d, marketing: { pl_x: 1 } }]);
    expect(bad.issues.map((i) => i.code)).toContain('unknown_id');
  });

  it('estimates the quarter close to what happens', () => {
    let state = playTurns(newGame(13), 4);
    let revenueGap = 0;
    let cashGap = 0;
    for (let t = 0; t < 4; t++) {
      const id = playerCompanyId(state);
      const d = steadyDecisions(state, id);
      const p = previewDecisions(state, [d]).companies[id];
      const next = resolveTurn(state, [d]).state;
      const books = player(next).books.current;
      revenueGap = Math.max(
        revenueGap,
        Math.abs((p?.expectedRevenue ?? 0) / books.pnl.revenue - 1),
      );
      cashGap = Math.max(
        cashGap,
        Math.abs((p?.expectedCashEnd ?? 0) - books.balance.cash) / books.pnl.revenue,
      );
      expect(p?.plannedOutput).toBeGreaterThan(0);
      state = next;
    }
    expect(revenueGap).toBeLessThan(0.25);
    expect(cashGap).toBeLessThan(0.25);
  });
});

describe('alerts', () => {
  it('flag low materials, wages under the market, overdraft and distress', () => {
    const state = newGame(13);
    const company = player(state);
    for (const lot of Object.values(company.inventory)) lot.qty = 0;
    const staff = Object.values(company.workforce)[0];
    if (staff) staff.wage *= 0.8;
    company.loans.push({
      id: 'loan_x',
      kind: 'overdraft',
      principal: 1e6,
      spread: 0.08,
      maturity: 1,
    });
    company.status = 'distressed';
    const kinds = companyAlerts(state, company.id).map((a) => a.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['material_low', 'wage_below_market', 'overdraft', 'distress']),
    );
    expect(companyAlerts(newGame(13), company.id).map((a) => a.kind)).not.toContain('material_low');
  });
});

describe('turn report', () => {
  it('compares planned and actual for the player and keeps only their issues', () => {
    const state = playTurns(newGame(13), 2);
    const id = playerCompanyId(state);
    const d = steadyDecisions(state, id);
    d.marketing.pl_x = 5; // an issue of the player
    const { report, state: next } = resolveTurn(state, [d]);
    const s = report.summary;
    expect(s?.companyId).toBe(id);
    expect(s?.quarter).toBe(state.meta.turn);
    expect(s?.unitsProduced).toBeGreaterThan(0);
    expect(s?.plannedOutput).toBeGreaterThanOrEqual(s?.unitsProduced ?? 0);
    expect(s?.unitsSold).toBeCloseTo(
      s ? s.marketShare * (next.productMarkets.mkt_appliances?.lastResult.volume ?? 0) : 0,
      6,
    );
    expect(s?.revenue).toBe(player(next).books.current.pnl.revenue);
    expect(s?.sharePrice).toBe(next.stock.quotes[id]?.price);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.every((i) => i.companyId === id)).toBe(true);
    expect(report.alerts).toEqual(companyAlerts(next, id));
    assertJsonSafe(report);
  });

  it('reports the events drawn with their effects and whether they concern the player', () => {
    const always = newGame(13).config.events.definitions.map((e) => ({ ...e, probability: 1 }));
    const state = newGame(13, { events: { definitions: always } });
    const { report } = resolveTurn(state, [steadyDecisions(state, playerCompanyId(state))]);
    const events = report.summary?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(e.effects.length).toBeGreaterThan(0);
    expect(events.find((e) => e.target.kind === 'global')?.concernsPlayer).toBe(true);
    expect(events.find((e) => e.target.id === 'com_energy')?.concernsPlayer).toBe(true);
  });
});
