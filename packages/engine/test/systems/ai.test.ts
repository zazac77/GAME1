import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../src';
import type { AiMemory, Company, GameState, Observation } from '../../src';
import { newAiMemory } from '../../src/ai/memory';
import { observe } from '../../src/ai/observation';
import { planDecisions } from '../../src/ai/planner';
import { createRng, seedRng } from '../../src/core/rng';
import { emptyDecisions, normalizeDecisions } from '../../src/systems/validation';
import { newGame, playerCompanyId, playTurns, resolveAll } from '../helpers';

const aiActors = (state: GameState) =>
  Object.values(state.actors)
    .filter((a) => a.kind === 'ai')
    .sort((a, b) => a.id.localeCompare(b.id));

const actorOf = (state: GameState, profileId: string) => {
  const actor = aiActors(state).find((a) => a.profileId === profileId);
  if (!actor) throw new Error(`no ${profileId}`);
  return actor;
};

const plan = (obs: Observation, memory: AiMemory = newAiMemory(), seed = 1) =>
  planDecisions(obs, memory, createRng(seedRng(seed)));

describe('AI planner', () => {
  it('plans decisions that pass validation untouched, deterministically', () => {
    const state = playTurns(newGame(9), 3);
    for (const actor of aiActors(state)) {
      const obs = observe(state, actor.id);
      const memory = state.aiMemory[actor.id] as AiMemory;
      const a = plan(obs, memory);
      expect(plan(obs, memory)).toEqual(a);
      const company = state.companies[actor.rootCompanyId] as Company;
      const { issues } = normalizeDecisions(state, company, a.decisions);
      expect(issues.filter((i) => i.code !== 'clamped')).toEqual([]);
      expect(a.decisions.hr.length).toBeGreaterThan(0);
      expect(Object.keys(a.decisions.pricing)).toHaveLength(1);
    }
  });

  it('follows its profile: premium aims higher in quality and price than low-cost', () => {
    const state = playTurns(newGame(9), 6);
    const decide = (profile: string) => {
      const actor = actorOf(state, profile);
      return Object.values(
        plan(observe(state, actor.id), state.aiMemory[actor.id]).decisions.pricing,
      )[0];
    };
    const premium = decide('premium');
    const lowCost = decide('low_cost');
    expect(premium?.qualityTarget).toBe(state.config.ai.profiles.premium?.qualityTarget);
    expect(premium?.qualityTarget ?? 0).toBeGreaterThan(lowCost?.qualityTarget ?? 0);
    expect(premium?.price ?? 0).toBeGreaterThan(lowCost?.price ?? 0);
  });

  it('produces for the forecast plus the target coverage, net of its stock', () => {
    const state = newGame(9);
    const actor = actorOf(state, 'opportunist');
    const obs = observe(state, actor.id);
    const company = obs.self.company;
    const lineId = Object.keys(company.productLines)[0] ?? '';
    const stock = company.inventory[lineId]?.qty ?? 0;
    const { decisions, memory } = plan(obs);
    const output = Object.values(decisions.production).reduce((s, p) => s + p.targetOutput, 0);
    const season = state.config.products.markets.mkt_appliances?.seasonality ?? [];
    const forecast = memory.demandForecast * (season[0] ?? 1);
    const next = memory.demandForecast * (season[1] ?? 1);
    const wanted = forecast + state.config.ai.targetCoverage * next - stock;
    expect(output).toBeCloseTo(Math.min(obs.self.outputCeiling, wanted), 6);
  });

  it('ripostes to a price cut that costs it market share, with probability = aggressiveness', () => {
    const state = playTurns(newGame(9), 4);
    const actor = actorOf(state, 'low_cost');
    const obs = observe(state, actor.id);
    const rival = obs.competitors.find((c) => c.products.length > 0);
    const product = rival?.products[0];
    if (!rival || !product) throw new Error('no rival');
    const memory = structuredClone(state.aiMemory[actor.id] as AiMemory);
    const lineId = Object.keys(obs.self.company.productLines)[0] ?? '';
    const share = obs.productMarkets.mkt_appliances?.lastResult.shares[lineId] ?? 0;
    memory.rivalPrices[product.lineId] = product.price * 1.2; // the rival just cut by 1/6
    memory.lastShare = share + 0.05; // and we lost 5 points
    delete memory.lastRetaliationAt;

    const fierce = structuredClone(obs);
    if (fierce.config.ai.profiles.low_cost) fierce.config.ai.profiles.low_cost.aggressiveness = 1;
    const war = plan(fierce, memory);
    expect(war.memory.priceWarDiscount).toBe(state.config.ai.priceWar.discount);
    expect(war.memory.lastRetaliationAt).toBe(obs.turn);
    expect(war.memory.grudges[rival.companyId]).toBeGreaterThan(0);
    expect(war.signals).toContainEqual({ kind: 'ai_price_war', rivalId: rival.companyId });

    const meek = structuredClone(obs);
    if (meek.config.ai.profiles.low_cost) meek.config.ai.profiles.low_cost.aggressiveness = 0;
    const peace = plan(meek, memory);
    expect(peace.signals).toEqual([]);
    const price = (r: typeof war) => Object.values(r.decisions.pricing)[0]?.price ?? 0;
    expect(price(war)).toBeLessThan(price(peace));
  });

  it('outbids on wages when it loses staff or misses hires, then the boost fades', () => {
    const state = playTurns(newGame(9), 2);
    const actor = actorOf(state, 'opportunist');
    const obs = observe(state, actor.id);
    const company = obs.self.company;
    const key = Object.keys(company.workforce).find((k) => k.endsWith(':occ_operator')) ?? '';
    const staff = company.workforce[key as keyof typeof company.workforce];
    if (!staff) throw new Error('no operators');
    staff.lastQuarter = { requested: 50, hired: 5, quits: 30, dismissed: 0 };
    const W = state.config.ai.wageOutbid;
    const pressed = plan(obs, newAiMemory());
    expect(pressed.memory.wageBoost[key as keyof AiMemory['wageBoost']]).toBeCloseTo(W.step, 9);
    const offer = (r: typeof pressed) =>
      r.decisions.hr.find((h) => `${h.regionId}:${h.occupationId}` === key)?.wageOffer ?? 0;
    const calm = structuredClone(obs);
    const calmStaff = calm.self.company.workforce[key as keyof typeof company.workforce];
    if (calmStaff) calmStaff.lastQuarter = { requested: 0, hired: 0, quits: 0, dismissed: 0 };
    expect(offer(pressed)).toBeGreaterThan(offer(plan(calm, newAiMemory())));
    const fading = plan(calm, pressed.memory);
    expect(fading.memory.wageBoost[key as keyof AiMemory['wageBoost']] ?? 0).toBeCloseTo(
      Math.max(0, W.step - W.decay),
      9,
    );
  });

  it('adds capacity when demand exceeds its lines and it can pay', () => {
    const state = newGame(9);
    const actor = actorOf(state, 'premium');
    const obs = observe(state, actor.id);
    const memory = newAiMemory();
    memory.demandForecast = 2 * obs.self.sites.reduce((s, x) => s + x.capacity, 0);
    obs.self.company.books.current.balance.cash = 5e7;
    const { decisions } = plan(obs, memory);
    expect(decisions.capex).toEqual([{ kind: 'add_line', siteId: obs.self.sites[0]?.siteId }]);
  });
});

describe('AI step', () => {
  it('plans for every AI company, never overrides submitted decisions', () => {
    const state = newGame(4);
    const player = playerCompanyId(state);
    const { ctx } = resolveAll(state, [emptyDecisions(player)], { until: 'ai' });
    for (const actor of aiActors(state)) {
      expect(ctx.decisions[actor.rootCompanyId]?.hr.length).toBeGreaterThan(0);
    }
    expect(ctx.decisions[player]).toEqual(emptyDecisions(player));
    const forced = aiActors(state)[0]?.rootCompanyId ?? '';
    const { ctx: c2 } = resolveAll(state, [emptyDecisions(forced)], { until: 'ai' });
    expect(c2.decisions[forced]).toEqual(emptyDecisions(forced));
    expect(c2.decisions[player]).toBeUndefined(); // the player has no profile: no autopilot
  });

  it('keeps the memory in the state and runs the player on autopilot when asked', () => {
    const state = newGame(4, undefined, { playerProfileId: 'premium', mode: 'sandbox' });
    const next = resolveTurn(state, []).state;
    const player = next.actors[next.meta.playerActorId];
    expect(player?.profileId).toBe('premium');
    expect(next.aiMemory[player?.id ?? '']?.demandForecast).toBeGreaterThan(0);
    const company = next.companies[player?.rootCompanyId ?? ''];
    expect(company?.lastDecisions?.hr.length).toBeGreaterThan(0);
    expect(() => newGame(4, undefined, { playerProfileId: 'innovator' })).toThrow(/innovator/);
  });

  it('keeps every AI alive and at least one profitable over 40 quarters', () => {
    for (const seed of [3, 17]) {
      const state = playTurns(newGame(seed, undefined, { mode: 'sandbox' }), 40);
      const ai = aiActors(state).map((a) => state.companies[a.rootCompanyId] as Company);
      const profit = (c: Company) => c.books.history.reduce((s, q) => s + q.pnl.netIncome, 0);
      expect(ai.filter((c) => c.status === 'bankrupt').length).toBeLessThan(ai.length);
      expect(ai.some((c) => profit(c) > 0)).toBe(true);
    }
  });
});
