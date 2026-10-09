import { clamp } from '../../core/math';
import { plantConfig } from '../../sectors/config';
import type { Plan } from './plan';
import { priceWar } from './priceWar';
import { rivalsOutOfStock } from './production';

/**
 * 3. Price: full cost (fixed costs spread over at least costingUtilization
 * of the capacity) + profile markup (marketing and R&D taken out of the revenue),
 * blended geometrically with the rivals' average price × the profile
 * positioning; + premium while rivals are out of stock; − price war and
 * predatory discounts; never below the variable cost floor; moves by at most
 * ai.maxPriceChange per quarter. Quality aimed at: the profile's, raised
 * during a counter-launch.
 */
export function pricing(plan: Plan): void {
  const { obs, config, profile, company, market, line } = plan;
  const cfg = plantConfig(config, company.sector);
  const discount = priceWar(plan);

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
  const fixed = wages + maintenance + depreciation + interest + plan.listingFees;
  const fullCost = plan.variableCost + fixed / volume;
  const costPrice =
    (fullCost * (1 + profile.priceMarkup)) /
    Math.max(0.5, 1 - profile.marketingShareOfRevenue - profile.rndShareOfRevenue);
  plan.quarterlyCashCosts =
    wages + maintenance + interest + plan.listingFees + plan.variableCost * volume;

  const rivals = obs.competitors
    .filter((c) => c.status === 'active' || c.status === 'distressed')
    .flatMap((c) => c.products.filter((p) => p.marketId === market.id).map((p) => p.price));
  const ref = market.refPrice * priceLevel;
  const average = rivals.length > 0 ? rivals.reduce((s, x) => s + x, 0) / rivals.length : ref;
  const anchor = average * profile.startPriceIndex;
  const w = profile.competitorPriceWeight;
  let target = Math.exp((1 - w) * Math.log(costPrice) + w * Math.log(anchor));
  if (profile.stockoutPremium > 0 && rivalsOutOfStock(plan)) target *= 1 + profile.stockoutPremium;
  target *= 1 - discount;

  const m = config.ai.maxPriceChange;
  const { min, max } = config.products.priceBounds;
  const floor = plan.variableCost * config.ai.priceFloorOverVariableCost;
  plan.price = clamp(
    Math.max(floor, clamp(target, line.price * (1 - m), line.price * (1 + m))),
    min * ref,
    max * ref,
  );
  plan.decisions.pricing[line.id] = {
    price: plan.price,
    qualityTarget: plan.tactics.qualityTarget,
  };
}
