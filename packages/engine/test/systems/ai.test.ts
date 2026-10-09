import { describe, expect, it } from 'vitest';
import { resolveTurn } from '../../src';
import type { AiMemory, AiProfileId, Company, GameState, Observation } from '../../src';
import { newAiMemory } from '../../src/ai/memory';
import { AI_PROFILE_IDS } from '../../src/config/schema';
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

/** Last quarter at a 15 % EBITDA margin: no truce, outbidding affordable. */
function healthy(obs: Observation): Observation {
  const { pnl } = obs.self.company.books.current;
  pnl.revenue = Math.max(pnl.revenue, 1e7);
  pnl.ebitda = 0.15 * pnl.revenue;
  return obs;
}

/** Memory in which the rival product was 20 % dearer and the own share 5 points higher. */
function attackedBy(
  obs: Observation,
  memory: AiMemory,
  product: { lineId: string; price: number },
): AiMemory {
  const m = structuredClone(memory);
  const lineId = Object.keys(obs.self.company.productLines)[0] ?? '';
  const share = Object.values(obs.productMarkets).find((x) => lineId in x.lastResult.shares)
    ?.lastResult.shares[lineId];
  m.rivalPrices[product.lineId] = product.price * 1.2; // the rival just cut by 1/6
  m.lastShare = (share ?? 0) + 0.05; // and we lost 5 points
  delete m.lastRetaliationAt;
  delete m.priceWar;
  for (const r of Object.values(m.rivals)) r.grudge = 0;
  return m;
}

/** The first rival selling in the observer's market, and its product there. */
function marketRival(obs: Observation) {
  const lineId = Object.keys(obs.self.company.productLines)[0] ?? '';
  const marketId = obs.self.company.productLines[lineId]?.marketId;
  for (const c of obs.competitors) {
    const product = c.products.find((p) => p.marketId === marketId);
    if (product && c.status === 'active') return { rival: c, product, lineId };
  }
  throw new Error('no rival in the market');
}

const priceOf = (r: { decisions: { pricing: Record<string, { price: number }> } }) =>
  Object.values(r.decisions.pricing)[0]?.price ?? 0;

describe('AI planner', () => {
  it('plans decisions that pass validation untouched, deterministically', () => {
    const state = playTurns(newGame(9), 3);
    for (const actor of aiActors(state)) {
      const obs = observe(state, actor.id);
      const memory = state.aiMemory[actor.rootCompanyId] as AiMemory;
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
        plan(observe(state, actor.id), state.aiMemory[actor.rootCompanyId]).decisions.pricing,
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
    healthy(obs);
    const memory = attackedBy(obs, state.aiMemory[actor.rootCompanyId] as AiMemory, product);

    const fierce = structuredClone(obs);
    if (fierce.config.ai.profiles.low_cost) fierce.config.ai.profiles.low_cost.aggressiveness = 1;
    const war = plan(fierce, memory);
    const depth = state.config.ai.profiles.low_cost?.priceWarDepth ?? 0;
    expect(war.memory.priceWar?.discount).toBeCloseTo(state.config.ai.priceWar.discount * depth, 9);
    expect(war.memory.priceWar?.rivalIds).toEqual([rival.companyId]);
    expect(war.memory.lastRetaliationAt).toBe(obs.turn);
    expect(war.memory.rivals[rival.companyId]?.grudge).toBeGreaterThan(0);
    expect(war.signals).toContainEqual({ kind: 'ai_price_war', rivalId: rival.companyId });

    const meek = structuredClone(obs);
    if (meek.config.ai.profiles.low_cost) meek.config.ai.profiles.low_cost.aggressiveness = 0;
    const peace = plan(meek, memory);
    expect(peace.signals.filter((x) => x.kind === 'ai_price_war')).toEqual([]);
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
    staff.lastQuarter = { requested: 50, hired: 5, quits: 30, dismissed: 0, offered: staff.wage };
    for (const c of obs.competitors) c.jobOffers = []; // nobody to outbid: one step
    const W = state.config.ai.wageOutbid;
    const pressed = plan(obs, newAiMemory());
    expect(pressed.memory.wageBoost[key as keyof AiMemory['wageBoost']]).toBeCloseTo(W.step, 9);
    const offer = (r: typeof pressed) =>
      r.decisions.hr.find((h) => `${h.regionId}:${h.occupationId}` === key)?.wageOffer ?? 0;
    const calm = structuredClone(obs);
    const calmStaff = calm.self.company.workforce[key as keyof typeof company.workforce];
    if (calmStaff) {
      calmStaff.lastQuarter = { requested: 0, hired: 0, quits: 0, dismissed: 0, offered: 0 };
    }
    expect(offer(pressed)).toBeGreaterThan(offer(plan(calm, newAiMemory())));
    const fading = plan(calm, pressed.memory);
    expect(fading.memory.wageBoost[key as keyof AiMemory['wageBoost']] ?? 0).toBeCloseTo(
      Math.max(0, W.step - W.decay),
      9,
    );
  });

  it('in a cash squeeze, cuts marketing and R&D before materials, within the validation', () => {
    const base = playTurns(newGame(9), 3);
    const actor = actorOf(base, 'premium');
    // No supply contracts left: the materials are bought spot.
    (base.companies[actor.rootCompanyId] as Company).contracts = [];
    const richObs = observe(base, actor.id);
    richObs.self.borrowingCapacity = 0;
    const rich = plan(richObs, base.aiMemory[actor.rootCompanyId]).decisions;
    const { config } = base;
    const qty = (d: typeof rich) => d.purchasing.spot.reduce((s, o) => s + o.qty, 0);
    const soft = (d: typeof rich) =>
      Object.values(d.marketing).reduce((s, x) => s + x, 0) +
      d.rnd.reduce((s, r) => s + r.budget, 0);
    const hard =
      rich.purchasing.spot.reduce(
        (s, o) =>
          s +
          o.qty *
            (base.commodities[o.commodityId]?.spotPrice ?? 0) *
            (1 + config.commodities.spotPremium),
        0,
      ) + rich.hr.reduce((s, h) => s + h.hire * h.wageOffer * config.labor.hiringCost, 0);
    expect(soft(rich)).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(0);
    // No revenue last quarter: validation allows the cash only.
    for (const cash of [hard + 0.5 * soft(rich), 0.5 * hard]) {
      const state = structuredClone(base);
      const company = state.companies[actor.rootCompanyId] as Company;
      company.books.current.balance.cash = cash;
      company.books.current.pnl.revenue = 0;
      const obs = observe(state, actor.id);
      obs.self.borrowingCapacity = 0;
      const { decisions } = plan(obs, state.aiMemory[actor.rootCompanyId]);
      const { issues } = normalizeDecisions(state, company, decisions);
      expect(issues.filter((i) => i.code === 'budget')).toEqual([]);
      expect(soft(decisions)).toBeLessThan(soft(rich));
      if (cash > hard) {
        expect(soft(decisions)).toBeGreaterThan(0);
        expect(qty(decisions)).toBeCloseTo(qty(rich), 6); // materials untouched
      } else {
        expect(soft(decisions)).toBe(0);
        expect(qty(decisions)).toBeLessThan(qty(rich));
      }
    }
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
    expect(next.aiMemory[player?.rootCompanyId ?? '']?.demandForecast).toBeGreaterThan(0);
    const company = next.companies[player?.rootCompanyId ?? ''];
    expect(company?.lastDecisions?.hr.length).toBeGreaterThan(0);
    const unknown = 'tycoon' as AiProfileId;
    expect(() => newGame(4, undefined, { playerProfileId: unknown })).toThrow(/tycoon/);
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

describe('AI tactics (lot 2.3)', () => {
  const FIVE = {
    scenario: {
      aiCompetitors: AI_PROFILE_IDS.map((profileId) => ({
        profileId,
        sector: 'industry' as const,
      })),
    },
  };

  it('plays the five profiles, each within the validation', () => {
    const state = playTurns(newGame(9, FIVE), 3);
    const seen = new Set<string>();
    for (const actor of aiActors(state)) {
      const company = state.companies[actor.rootCompanyId] as Company;
      const a = plan(observe(state, actor.id), state.aiMemory[actor.rootCompanyId]);
      const { issues } = normalizeDecisions(state, company, a.decisions);
      expect(issues.filter((i) => i.code !== 'clamped')).toEqual([]);
      seen.add(actor.profileId ?? '');
    }
    expect([...seen].sort()).toEqual([...AI_PROFILE_IDS].sort());
  });

  it('pays talent: the innovator adds its skilled premium on the N3+ occupations', () => {
    const state = playTurns(newGame(9, FIVE), 2);
    const actor = actorOf(state, 'innovator');
    const obs = observe(state, actor.id);
    for (const staff of Object.values(obs.self.company.workforce)) {
      staff.lastQuarter = { requested: 0, hired: 0, quits: 0, dismissed: 0, offered: 0 };
    }
    const profile = state.config.ai.profiles.innovator;
    const W = state.config.ai.wageOutbid;
    const { decisions } = plan(obs);
    let skilled = 0;
    for (const h of decisions.hr) {
      const market = obs.labor[`${h.regionId}:${h.occupationId}`]?.marketWage ?? 0;
      const level = state.config.labor.occupations[h.occupationId]?.level ?? 1;
      const premium =
        (profile?.wagePremium ?? 0) +
        (level >= W.skilledLevel ? (profile?.skilledWagePremium ?? 0) : 0);
      expect(h.wageOffer).toBeCloseTo(market * (1 + premium), 6);
      if (level >= W.skilledLevel) skilled += 1;
    }
    expect(skilled).toBeGreaterThan(0);
  });

  it('remembers every operating rival: its product, health and a fading grudge', () => {
    const state = playTurns(newGame(9), 3);
    const actor = actorOf(state, 'low_cost');
    const obs = observe(state, actor.id);
    const memory = structuredClone(state.aiMemory[actor.rootCompanyId] as AiMemory);
    const { rival, product } = marketRival(obs);
    (memory.rivals[rival.companyId] ??= { grudge: 0, weakQuarters: 0 }).grudge = 0.5;
    const next = plan(obs, memory).memory;
    const operating = obs.competitors.filter(
      (c) => c.status === 'active' || c.status === 'distressed',
    );
    expect(Object.keys(next.rivals).sort()).toEqual(operating.map((c) => c.companyId).sort());
    expect(next.rivals[rival.companyId]?.quality).toBe(product.quality);
    expect(next.rivals[rival.companyId]?.grudge).toBeCloseTo(
      0.5 * (1 - state.config.ai.priceWar.grudgeDecay),
      9,
    );
  });

  it('escalates a war against a rival that keeps cutting, and grudges make ripostes likelier', () => {
    const state = playTurns(newGame(9), 4);
    const actor = actorOf(state, 'low_cost');
    const obs = healthy(observe(state, actor.id));
    const { rival, product } = marketRival(obs);
    const W = state.config.ai.priceWar;
    const depth = state.config.ai.profiles.low_cost?.priceWarDepth ?? 0;
    const fierce = structuredClone(obs);
    if (fierce.config.ai.profiles.low_cost) fierce.config.ai.profiles.low_cost.aggressiveness = 1;

    const memory = attackedBy(obs, state.aiMemory[actor.rootCompanyId] as AiMemory, product);
    memory.priceWar = {
      rivalIds: [rival.companyId],
      discount: W.discount * depth,
      startedAt: obs.turn - 1,
      escalations: 0,
    };
    memory.lastRetaliationAt = obs.turn - 1;
    const war = plan(fierce, memory);
    const faded = W.discount * depth * (1 - 1 / W.durationQuarters);
    expect(war.memory.priceWar?.discount).toBeCloseTo(
      Math.min(W.maxDiscount * depth, faded + W.escalationStep * depth),
      9,
    );
    expect(war.memory.priceWar?.escalations).toBe(1);
    expect(war.signals).toContainEqual({
      kind: 'ai_price_war',
      rivalId: rival.companyId,
      data: { escalation: 1 },
    });

    // A meek planner still ripostes against a rival it resents.
    const meek = structuredClone(obs);
    if (meek.config.ai.profiles.low_cost) meek.config.ai.profiles.low_cost.aggressiveness = 0;
    meek.config.ai.priceWar.grudgeAggression = 1;
    const resented = attackedBy(obs, state.aiMemory[actor.rootCompanyId] as AiMemory, product);
    resented.rivals[rival.companyId] = { grudge: 1, weakQuarters: 0 };
    expect(plan(meek, resented).memory.priceWar?.rivalIds).toEqual([rival.companyId]);
    resented.rivals[rival.companyId] = { grudge: 0, weakQuarters: 0 };
    expect(plan(meek, resented).memory.priceWar).toBeUndefined();
  });

  it('calls a truce when the war ruins its margin', () => {
    const state = playTurns(newGame(9), 4);
    const actor = actorOf(state, 'low_cost');
    const obs = observe(state, actor.id);
    const { rival, product } = marketRival(obs);
    const { pnl } = obs.self.company.books.current;
    pnl.revenue = 1e7;
    pnl.ebitda = -1e5;
    if (obs.config.ai.profiles.low_cost) obs.config.ai.profiles.low_cost.aggressiveness = 1;
    const memory = attackedBy(obs, state.aiMemory[actor.rootCompanyId] as AiMemory, product);
    memory.priceWar = { rivalIds: [rival.companyId], discount: 0.1, startedAt: 0, escalations: 0 };
    const truce = plan(obs, memory);
    expect(truce.memory.priceWar).toBeUndefined();
    expect(truce.signals).toContainEqual({ kind: 'ai_price_truce', rivalId: rival.companyId });
    // …and no new war starts while bleeding.
    const again = plan(obs, truce.memory);
    expect(again.memory.priceWar).toBeUndefined();
  });

  it('defends its brand with marketing when a rival price cut costs it market share', () => {
    const state = playTurns(newGame(9), 4);
    const actor = actorOf(state, 'premium');
    const obs = healthy(observe(state, actor.id));
    if (obs.config.ai.profiles.premium) obs.config.ai.profiles.premium.aggressiveness = 0;
    const { product, lineId } = marketRival(obs);
    const calm = structuredClone(state.aiMemory[actor.rootCompanyId] as AiMemory);
    calm.rivalPrices[product.lineId] = product.price;
    const attacked = plan(obs, attackedBy(obs, calm, product)).decisions.marketing[lineId] ?? 0;
    const quiet = plan(obs, calm).decisions.marketing[lineId] ?? 0;
    const defense = state.config.ai.profiles.premium?.brandDefense ?? 0;
    expect(defense).toBeGreaterThan(0);
    expect(attacked).toBeCloseTo(quiet * (1 + defense), 3);
  });

  it("outbids a rival's public job offer, resents the poacher, and says so once per cooldown", () => {
    const state = playTurns(newGame(9), 2);
    const actor = actorOf(state, 'opportunist');
    const obs = healthy(observe(state, actor.id));
    const company = obs.self.company;
    const key = Object.keys(company.workforce).find((k) => k.endsWith(':occ_operator')) ?? '';
    const staff = company.workforce[key as keyof typeof company.workforce];
    const pool = obs.labor[key as keyof typeof obs.labor];
    const rival = obs.competitors[0];
    if (!staff || !pool || !rival) throw new Error('no operators');
    staff.lastQuarter = { requested: 50, hired: 5, quits: 30, dismissed: 0, offered: staff.wage };
    for (const c of obs.competitors) c.jobOffers = [];
    rival.jobOffers = [
      { regionId: pool.regionId, occupationId: pool.occupationId, wage: pool.marketWage * 1.1 },
    ];
    const W = state.config.ai.wageOutbid;
    const premium = state.config.ai.profiles.opportunist?.wagePremium ?? 0;
    const max = state.config.ai.profiles.opportunist?.wageOutbidMax ?? 0;
    const first = plan(obs, newAiMemory());
    const boost = first.memory.wageBoost[key as keyof AiMemory['wageBoost']] ?? 0;
    expect(boost).toBeCloseTo(Math.min(max, 0.1 - premium + W.step), 9);
    const offer = first.decisions.hr.find((h) => `${h.regionId}:${h.occupationId}` === key);
    expect(offer?.wageOffer ?? 0).toBeGreaterThan(pool.marketWage * 1.1);
    expect(first.memory.rivals[rival.companyId]?.grudge).toBeCloseTo(W.poachGrudge, 9);
    expect(first.signals).toContainEqual({
      kind: 'ai_wage_outbid',
      rivalId: rival.companyId,
      data: { regionId: pool.regionId, occupationId: pool.occupationId },
    });

    // The rival outbids again next quarter: the boost follows, the news waits for the cooldown.
    const later = structuredClone(obs);
    later.turn += 1;
    const ad = later.competitors[0]?.jobOffers[0];
    if (!ad) throw new Error('no job ad');
    ad.wage = pool.marketWage * 1.12;
    const second = plan(later, first.memory);
    expect(second.memory.wageBoost[key as keyof AiMemory['wageBoost']] ?? 0).toBeGreaterThan(boost);
    expect(second.signals.filter((x) => x.kind === 'ai_wage_outbid')).toEqual([]);
    // Capped at the profile's wageOutbidMax.
    ad.wage = pool.marketWage * 2;
    expect(plan(later, first.memory).memory.wageBoost[key as keyof AiMemory['wageBoost']]).toBe(
      max,
    );
  });

  it('counter-launches against a rival whose product leaps ahead, then stops', () => {
    const state = playTurns(newGame(9), 4);
    const actor = actorOf(state, 'premium');
    const obs = healthy(observe(state, actor.id));
    const { rival, product, lineId } = marketRival(obs);
    product.quality = 70;
    const own = obs.self.company.productLines[lineId];
    if (!own) throw new Error('no line');
    own.quality = 68;
    const memory = structuredClone(state.aiMemory[actor.rootCompanyId] as AiMemory);
    memory.rivals[rival.companyId] = { grudge: 0, weakQuarters: 0, quality: 60 };
    delete memory.counterLaunch;
    delete memory.lastCounterLaunchAt;
    const C = state.config.ai.counterLaunch;
    const profile = state.config.ai.profiles.premium;

    const keen = structuredClone(obs);
    if (keen.config.ai.profiles.premium) keen.config.ai.profiles.premium.counterLaunch = 1;
    const cold = structuredClone(obs);
    if (cold.config.ai.profiles.premium) cold.config.ai.profiles.premium.counterLaunch = 0;
    const launch = plan(keen, memory);
    const none = plan(cold, memory);
    expect(launch.signals).toContainEqual({ kind: 'ai_counter_launch', rivalId: rival.companyId });
    expect(none.signals.filter((x) => x.kind === 'ai_counter_launch')).toEqual([]);
    expect(launch.memory.counterLaunch).toEqual({
      rivalId: rival.companyId,
      until: obs.turn + C.durationQuarters - 1,
    });
    expect(launch.decisions.pricing[lineId]?.qualityTarget).toBe(
      Math.min(70 + C.qualityMargin, (profile?.qualityTarget ?? 0) + C.maxQualityBoost),
    );
    expect(none.decisions.pricing[lineId]?.qualityTarget).toBe(profile?.qualityTarget);
    const productRnd = (r: typeof launch) =>
      r.decisions.rnd.find((x) => x.type === 'product')?.budget ?? 0;
    expect(productRnd(launch)).toBeGreaterThanOrEqual(productRnd(none));
    expect(launch.decisions.marketing[lineId] ?? 0).toBeGreaterThan(
      none.decisions.marketing[lineId] ?? 0,
    );

    // Over after durationQuarters; no new one during the cooldown.
    const after = structuredClone(keen);
    after.turn += C.durationQuarters;
    const ended = plan(after, launch.memory);
    expect(ended.memory.counterLaunch).toBeUndefined();
    expect(ended.signals.filter((x) => x.kind === 'ai_counter_launch')).toEqual([]);
  });

  it('counter-launches in tech: product releases and marketing', () => {
    const state = playTurns(newGame(9), 4);
    const actor = actorOf(state, 'innovator');
    const obs = healthy(observe(state, actor.id));
    const { rival, product, lineId } = marketRival(obs);
    const own = obs.self.company.productLines[lineId];
    if (!own) throw new Error('no line');
    product.techLevel = (own.techLevel ?? 0) + 0.2;
    const memory = structuredClone(state.aiMemory[actor.rootCompanyId] as AiMemory);
    memory.rivals[rival.companyId] = {
      grudge: 0,
      weakQuarters: 0,
      quality: product.quality,
      techLevel: (own.techLevel ?? 0) - 0.1,
    };
    delete memory.counterLaunch;
    delete memory.lastCounterLaunchAt;
    const cold = structuredClone(obs);
    if (cold.config.ai.profiles.innovator) cold.config.ai.profiles.innovator.counterLaunch = 0;
    const launch = plan(obs, memory, 3);
    const none = plan(cold, memory, 3);
    expect(launch.signals).toContainEqual({ kind: 'ai_counter_launch', rivalId: rival.companyId });
    const developers = (r: typeof launch) =>
      r.decisions.rnd.find((x) => x.type === 'product')?.developers ?? 0;
    // Releases may already run at full pace: more developers only within the project's cap.
    expect(developers(launch)).toBeGreaterThanOrEqual(developers(none));
    expect(launch.decisions.marketing[lineId] ?? 0).toBeGreaterThan(
      none.decisions.marketing[lineId] ?? 0,
    );
  });

  it('preys on a rival in difficulty: watchlist, offensive news once, lower price, more output', () => {
    const state = playTurns(newGame(13), 4);
    const actor = actorOf(state, 'opportunist');
    const obs = healthy(observe(state, actor.id));
    const { rival } = marketRival(obs);
    const memory = structuredClone(state.aiMemory[actor.rootCompanyId] as AiMemory);
    memory.demandForecast = 0.3 * obs.self.outputCeiling; // room to produce more
    memory.rivals[rival.companyId] = { grudge: 0, weakQuarters: 1 };
    memory.watchlist = [];
    delete memory.priceWar;

    const weak = structuredClone(obs);
    const target = weak.competitors.find((c) => c.companyId === rival.companyId);
    if (target) target.creditRating = 'CCC';
    const sound = structuredClone(obs);
    const healthyRival = sound.competitors.find((c) => c.companyId === rival.companyId);
    if (healthyRival) {
      healthyRival.creditRating = 'A';
      healthyRival.status = 'active';
      healthyRival.published = [];
    }
    const prey = plan(weak, memory);
    const none = plan(sound, memory);
    expect(prey.memory.watchlist).toContain(rival.companyId);
    expect(none.memory.watchlist).not.toContain(rival.companyId);
    expect(prey.signals).toContainEqual({ kind: 'ai_targets_rival', rivalId: rival.companyId });
    expect(priceOf(prey)).toBeLessThan(priceOf(none));
    const output = (r: typeof prey) =>
      Object.values(r.decisions.production).reduce((s, p) => s + p.targetOutput, 0);
    expect(output(prey)).toBeGreaterThan(output(none));
    // The offensive is news once; a profile without opportunism watches nobody.
    const next = structuredClone(weak);
    next.turn += 1;
    const again = plan(next, prey.memory).signals;
    expect(again).not.toContainEqual({ kind: 'ai_targets_rival', rivalId: rival.companyId });
    const premium = actorOf(state, 'premium');
    const premiumObs = observe(state, premium.id);
    for (const c of premiumObs.competitors) c.creditRating = 'CCC';
    const premiumMemory = structuredClone(state.aiMemory[premium.rootCompanyId] as AiMemory);
    for (const r of Object.values(premiumMemory.rivals)) r.weakQuarters = 5;
    expect(plan(premiumObs, premiumMemory).memory.watchlist).toEqual([]);
  });

  it('AI companies fight each other too, in public', () => {
    let state = newGame(5, undefined, { playerProfileId: 'premium', mode: 'sandbox' });
    const player = playerCompanyId(state);
    const ai = new Set(aiActors(state).map((a) => a.rootCompanyId));
    const moves: { kind: string; from: string; to: string }[] = [];
    for (let t = 0; t < 24; t++) {
      const { state: next, report } = resolveTurn(state, []);
      for (const e of report.events) {
        if (e.kind.startsWith('ai_') && e.companyId && typeof e.data?.rivalId === 'string') {
          moves.push({ kind: e.kind, from: e.companyId, to: e.data.rivalId });
        }
      }
      state = next;
    }
    const between = moves.filter((m) => ai.has(m.from) && ai.has(m.to) && m.to !== player);
    expect(between.length).toBeGreaterThan(0);
    expect(new Set(moves.map((m) => m.kind)).size).toBeGreaterThan(1);
  });
});

describe('AI takeovers and dividends (lot 2.4)', () => {
  /** A conglomerate head with cash to spare and a cheap company for sale. */
  function dealSetup() {
    const state = playTurns(newGame(15), 3);
    const actor = actorOf(state, 'conglomerate');
    const obs = healthy(observe(state, actor.id));
    obs.config.ai.profiles.conglomerate = {
      ...(obs.config.ai.profiles.conglomerate as NonNullable<
        Observation['config']['ai']['profiles']['conglomerate']
      >),
      acquisitiveness: 1,
    };
    const b = obs.self.company.books.current.balance;
    b.cash += 50_000_000;
    b.equity += 50_000_000;
    // Rivals are not for sale here: only the listing is a candidate.
    for (const c of obs.competitors) delete c.askedPremium;
    obs.mna.listings = [
      {
        id: 'tgt_900',
        name: 'Pépite',
        sector: 'tech',
        regionId: 'reg_nord',
        scale: 0.5,
        managementProfileId: 'premium',
        listedAt: obs.turn - 1,
        expiresAt: obs.turn + 4,
        askingPrice: 5_000_000,
        estimate: { revenue: 10_000_000, ebitda: 2_000_000 },
        netDebt: 0,
      },
    ];
    return { state, actor, obs };
  }

  it('orders a due diligence on a cheap listing, then bids on what it reveals', () => {
    const { obs } = dealSetup();
    expect(obs.group.isHead).toBe(true);
    const first = plan(obs);
    expect(first.decisions.mna).toContainEqual({ kind: 'due_diligence', targetId: 'tgt_900' });
    expect(first.memory.deal).toEqual({ targetId: 'tgt_900', since: obs.turn });

    const next = structuredClone(obs);
    next.turn += 1;
    next.mna.diligence = [
      {
        buyerId: obs.companyId,
        targetId: 'tgt_900',
        orderedAt: obs.turn,
        expiresAt: obs.turn + 5,
        figures: { revenue: 10_000_000, ebitda: 2_000_000 },
        netDebt: 0,
        hiddenLiability: 0,
      },
    ];
    const bid = plan(next, first.memory);
    expect(bid.decisions.mna.map((a) => a.kind)).toEqual(['private_purchase']);
    expect(bid.memory.deal).toBeUndefined();
    expect(bid.memory.lastDealAt).toBe(next.turn);

    // A due diligence revealing a much weaker company kills the deal.
    next.mna.diligence[0] = {
      ...(next.mna.diligence[0] as Observation['mna']['diligence'][number]),
      figures: { revenue: 800_000, ebitda: 20_000 },
    };
    const dropped = plan(next, first.memory);
    expect(dropped.decisions.mna).toEqual([]);
    expect(dropped.memory.deal).toBeUndefined();
  });

  it('a profile without acquisitiveness never buys; a listed company pays dividends', () => {
    const { state, obs } = dealSetup();
    obs.profileId = 'low_cost';
    expect(plan(obs).decisions.mna).toEqual([]);
    const sound = healthy(observe(state, actorOf(state, 'premium').id));
    const paid = plan(sound).decisions.finance.dividend ?? 0;
    const { pnl } = sound.self.company.books.current;
    if (pnl.netIncome > 0)
      expect(paid).toBeLessThanOrEqual(state.config.ai.dividends.payout * pnl.netIncome + 1e-6);
    expect(paid).toBeGreaterThanOrEqual(0);
  });
});
