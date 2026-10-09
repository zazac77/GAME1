import { clamp } from '../../core/math';
import { rivalsOutOfStock } from './production';
import type { Plan } from './plan';

/**
 * Price war: when a rival cuts its price by more than priceCutTrigger and
 * the own share falls by more than shareLossTrigger, the planner ripostes
 * with probability = aggressiveness (one draw per planning, used or not).
 * The riposte discount fades linearly; grudges fade too.
 */
function priceWar(plan: Plan): void {
  const { obs, config, profile, memory, market, line, rng } = plan;
  const W = config.ai.priceWar;
  const roll = rng.next();
  memory.priceWarDiscount = Math.max(0, memory.priceWarDiscount - W.discount / W.durationQuarters);
  const grudges: Record<string, number> = {};
  for (const [id, g] of Object.entries(memory.grudges)) {
    const next = g * (1 - W.grudgeDecay);
    if (next > 1e-3) grudges[id] = next;
  }
  memory.grudges = grudges;

  const ownShare = market.lastResult.shares[line.id];
  const cutters: string[] = [];
  const prices: Record<string, number> = {};
  for (const c of obs.competitors) {
    if (c.status === 'bankrupt' || c.status === 'absorbed') continue;
    for (const p of c.products) {
      if (p.marketId !== market.id) continue;
      prices[p.lineId] = p.price;
      const before = memory.rivalPrices[p.lineId];
      if (before !== undefined && p.price < before * (1 - W.priceCutTrigger))
        cutters.push(c.companyId);
    }
  }
  const lostShare =
    ownShare !== undefined &&
    memory.lastShare >= 0 &&
    memory.lastShare - ownShare > W.shareLossTrigger;
  const cooled =
    memory.lastRetaliationAt === undefined ||
    obs.turn - memory.lastRetaliationAt >= W.cooldownQuarters;
  if (cutters.length > 0 && lostShare && cooled && roll < profile.aggressiveness) {
    memory.priceWarDiscount = W.discount;
    memory.lastRetaliationAt = obs.turn;
    for (const rivalId of [...new Set(cutters)]) {
      memory.grudges[rivalId] = Math.min(1, (memory.grudges[rivalId] ?? 0) + W.grudgeGain);
      plan.signals.push({ kind: 'ai_price_war', rivalId });
    }
  }
  memory.rivalPrices = prices;
  if (ownShare !== undefined) memory.lastShare = ownShare;
}

/**
 * 3. Price: full cost (fixed costs spread over at least costingUtilization
 * of the capacity) + profile markup (marketing and R&D taken out of the revenue),
 * blended geometrically with the rivals' average price × the profile
 * positioning; + premium while rivals are out of stock; − price war
 * discount; never below the variable cost floor; moves by at most
 * ai.maxPriceChange per quarter. Quality aimed at: the profile's.
 */
export function pricing(plan: Plan): void {
  const { obs, config, profile, company, market, line } = plan;
  const cfg = config.sectors.industry;
  priceWar(plan);

  const { priceLevel } = obs.macro;
  let materials = 0;
  for (const [id, q] of Object.entries(plan.perUnit)) {
    const p = plan.memory.priceForecast[id] ?? obs.commodities[id]?.spotPrice ?? 0;
    materials += q * p * (1 + config.commodities.spotPremium);
  }
  const logistics =
    cfg.logisticsCostPerUnit *
    (obs.regions[company.hqRegionId]?.logisticsCostIndex ?? 1) *
    priceLevel;
  plan.variableCost = materials + logistics;

  const capacity = obs.self.sites.reduce((s, x) => s + x.capacity, 0);
  const volume = Math.max(
    1,
    Math.min(plan.forecast, plan.staffedOutput || plan.forecast),
    config.ai.costingUtilization * capacity,
  );
  const wages = Object.values(company.workforce).reduce((s, x) => s + x.headcount * x.wage, 0);
  const lines = obs.self.sites.reduce((s, x) => s + x.operationalLines, 0);
  const maintenance = lines * cfg.line.maintenanceCost * priceLevel;
  const { depreciation, interest } = company.books.current.pnl;
  const fullCost = plan.variableCost + (wages + maintenance + depreciation + interest) / volume;
  const costPrice =
    (fullCost * (1 + profile.priceMarkup)) /
    Math.max(0.5, 1 - profile.marketingShareOfRevenue - profile.rndShareOfRevenue);
  plan.quarterlyCashCosts = wages + maintenance + interest + plan.variableCost * volume;

  const rivals = obs.competitors
    .filter((c) => c.status === 'active' || c.status === 'distressed')
    .flatMap((c) => c.products.filter((p) => p.marketId === market.id).map((p) => p.price));
  const ref = market.refPrice * priceLevel;
  const average = rivals.length > 0 ? rivals.reduce((s, x) => s + x, 0) / rivals.length : ref;
  const anchor = average * profile.startPriceIndex;
  const w = profile.competitorPriceWeight;
  let target = Math.exp((1 - w) * Math.log(costPrice) + w * Math.log(anchor));
  if (profile.stockoutPremium > 0 && rivalsOutOfStock(plan)) target *= 1 + profile.stockoutPremium;
  target *= 1 - plan.memory.priceWarDiscount;

  const m = config.ai.maxPriceChange;
  const { min, max } = config.products.priceBounds;
  const floor = plan.variableCost * config.ai.priceFloorOverVariableCost;
  plan.price = clamp(
    Math.max(floor, clamp(target, line.price * (1 - m), line.price * (1 + m))),
    min * ref,
    max * ref,
  );
  plan.decisions.pricing[line.id] = { price: plan.price, qualityTarget: profile.qualityTarget };
}
