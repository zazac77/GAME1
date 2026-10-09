import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AiMemory, Company, GameState, Observation } from '../../src';
import { observe } from '../../src/ai/observation';
import { planDecisions } from '../../src/ai/planner';
import { createRng } from '../../src/core/rng';
import { newGame, playTurns } from '../helpers';

const COMPETITOR_KEYS = [
  'actorName',
  'brand',
  'companyId',
  'creditRating',
  'hqRegionId',
  'jobOffers',
  'listed',
  'name',
  'products',
  'published',
  'sector',
  'sites',
  'status',
];

/** Changes everything a rival keeps private: books not yet published, staff, stocks, debt, plans. */
function scramble(state: GameState, observerCompanyId: string): GameState {
  const s = structuredClone(state);
  for (const c of Object.values(s.companies) as Company[]) {
    if (c.id === observerCompanyId) continue;
    c.books.current.balance.cash *= 3;
    const last = c.books.history.at(-1);
    if (last) last.pnl.revenue *= 2; // the last closed quarter is not published yet
    c.books.taxLossCarryforward += 1e6;
    for (const staff of Object.values(c.workforce)) {
      staff.wage *= 1.5;
      staff.lastQuarter.quits += 7;
    }
    for (const lot of Object.values(c.inventory)) lot.qty *= 2;
    for (const loan of c.loans) loan.principal *= 2;
    c.contracts.push({
      id: 'ctr_x',
      commodityId: 'com_steel',
      qtyPerQuarter: 99,
      price: 1,
      startsAt: 0,
      endsAt: 99,
    });
    c.cumulativeOutput *= 3;
    c.employerBrand = 1;
    if (c.lastDecisions) c.lastDecisions.marketing = { x: 1e9 };
  }
  for (const [actorId, memory] of Object.entries(s.aiMemory)) {
    if (s.actors[actorId]?.rootCompanyId !== observerCompanyId) memory.demandForecast = 1;
  }
  return s;
}

const byPool = (a: { regionId: string; occupationId: string }, b: typeof a) =>
  `${a.regionId}:${a.occupationId}`.localeCompare(`${b.regionId}:${b.occupationId}`);

describe('anti-cheat', () => {
  it('the planner only takes an Observation (types)', () => {
    expectTypeOf(planDecisions).parameter(0).toEqualTypeOf<Observation>();
    expectTypeOf(planDecisions).parameter(1).toEqualTypeOf<AiMemory>();
  });

  it('competitors are seen through public fields only', () => {
    const state = playTurns(newGame(21), 5);
    for (const actor of Object.values(state.actors)) {
      const obs = observe(state, actor.id);
      expect(Object.keys(obs).sort()).not.toContain('companies');
      expect(Object.keys(obs)).not.toContain('aiMemory');
      expect(Object.keys(obs)).not.toContain('meta');
      for (const c of obs.competitors) {
        expect(Object.keys(c).sort()).toEqual(COMPETITOR_KEYS);
        const lag = state.config.stockMarket.publicationLagQuarters;
        for (const s of c.published)
          expect(s.quarter).toBeLessThanOrEqual(state.meta.turn - 1 - lag);
        for (const p of c.products) {
          // Subscription products also announce their users and show their tech level.
          const tech = c.sector === 'tech' ? ['techLevel', 'users'] : [];
          expect(Object.keys(p).sort()).toEqual(
            ['lineId', 'marketId', 'marketShare', 'price', 'quality', 'stockout', ...tech].sort(),
          );
        }
      }
      // Job ads are public: the wage offered with the hires asked for, nothing else.
      for (const c of obs.competitors) {
        const company = state.companies[c.companyId] as Company;
        const ads = Object.values(company.workforce)
          .filter((x) => x.lastQuarter.requested > 0 && x.lastQuarter.offered > 0)
          .map((x) => ({
            regionId: x.regionId,
            occupationId: x.occupationId,
            wage: x.lastQuarter.offered,
          }));
        expect([...c.jobOffers].sort(byPool)).toEqual(ads.sort(byPool));
      }
      // Demand addressed to each rival line stays private.
      const own = new Set(Object.keys(obs.self.company.productLines));
      for (const m of Object.values(obs.productMarkets)) {
        for (const lineId of Object.keys(m.lastResult.allocated))
          expect(own.has(lineId)).toBe(true);
      }
    }
  });

  it("rivals' private data changes neither the observation nor the decisions", () => {
    const state = playTurns(newGame(21), 5);
    for (const actor of Object.values(state.actors).filter((a) => a.kind === 'ai')) {
      const hidden = scramble(state, actor.rootCompanyId);
      const a = observe(state, actor.id);
      const b = observe(hidden, actor.id);
      expect(b).toEqual(a);
      // Not vacuous: the same changes on the observer's own company are seen.
      expect(observe(scramble(state, 'nobody'), actor.id)).not.toEqual(a);
      const memory = state.aiMemory[actor.id] as AiMemory;
      const rng = () => createRng({ a: 1, b: 2, c: 3, d: 4 });
      expect(planDecisions(b, memory, rng())).toEqual(planDecisions(a, memory, rng()));
    }
  });

  it('the observation is a copy: a planner cannot touch the state', () => {
    const state = newGame(21);
    const actor = Object.values(state.actors).find((a) => a.kind === 'ai');
    const obs = observe(state, actor?.id ?? '');
    obs.self.company.books.current.balance.cash = -1;
    obs.macro.policyRate = 9;
    expect(state.companies[obs.companyId]?.books.current.balance.cash).toBeGreaterThan(0);
    expect(state.macro.policyRate).toBeLessThan(1);
  });
});
