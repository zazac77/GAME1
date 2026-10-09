import type { Plan } from './plan';

/**
 * 5. Purchasing: long-term contracts cover riskAversion of the expected
 * needs (topped up below contractRefillThreshold), spot buys the rest of
 * this quarter's need (the larger of the output plan and the demand forecast)
 * plus a safety margin, and more when the world price is
 * well below its smoothed value. Non-storable inputs are only contracted
 * (the rest is bought at consumption).
 */
export function purchasing(plan: Plan): void {
  const { obs, config, profile, company, memory } = plan;
  const P = config.ai.purchasing;
  const C = config.commodities;
  for (const commodityId of Object.keys(plan.perUnit).sort()) {
    const perUnit = plan.perUnit[commodityId] ?? 0;
    const market = obs.commodities[commodityId];
    const spec = C.markets[commodityId];
    if (!market || !spec || perUnit <= 0) continue;

    const active = company.contracts.filter(
      (k) => k.commodityId === commodityId && k.startsAt <= obs.turn && obs.turn < k.endsAt,
    );
    let contracted = active.reduce((s, k) => s + k.qtyPerQuarter, 0);
    let contractCost = active.reduce((s, k) => s + k.qtyPerQuarter * k.price, 0);
    const target = profile.riskAversion * plan.forecast * perUnit;
    if (target > 0 && contracted < target * P.contractRefillThreshold) {
      const qtyPerQuarter = target - contracted;
      plan.decisions.purchasing.newContracts.push({
        commodityId,
        qtyPerQuarter,
        quarters: P.contractQuarters,
      });
      contracted += qtyPerQuarter;
      contractCost += qtyPerQuarter * market.worldPrice * (1 + C.forwardPremium);
    }
    if (!spec.storable) {
      // Bought at consumption: contracts first, the rest at spot.
      const spot = Math.max(0, plan.output * perUnit - contracted);
      plan.spend.other += contractCost + spot * market.spotPrice * (1 + C.spotPremium);
      continue;
    }
    plan.spend.other += contractCost;
    // Sized on the smoothed demand rather than the output plan (which swings with the
    // finished-goods stock): steadier orders, no bullwhip on the commodity markets.
    const stock = company.inventory[commodityId]?.qty ?? 0;
    const planned = Math.max(plan.output, plan.forecast);
    let qty = Math.max(0, planned * perUnit * (1 + P.safetyStock) - stock - contracted);
    const smoothed = memory.priceForecast[commodityId] ?? market.worldPrice;
    if (market.worldPrice < smoothed * (1 - P.opportunisticDiscount)) {
      qty += P.opportunisticCoverQuarters * plan.forecast * perUnit;
    }
    if (qty <= 1e-6) continue;
    plan.decisions.purchasing.spot.push({ commodityId, qty });
    plan.spend.discretionary += qty * market.spotPrice * (1 + C.spotPremium);
  }
}
