import { sum } from '../../core/math';
import { plantConfig } from '../../sectors/config';
import { materialFactor } from '../../sectors/plant';
import type { Plan } from './plan';

/** Rivals of the main market that ran out of stock last quarter. */
export const rivalsOutOfStock = (plan: Plan): boolean =>
  plan.obs.competitors.some((c) =>
    c.products.some((p) => p.marketId === plan.market.id && p.stockout),
  );

/**
 * 2. Production: sells the forecast and ends the quarter with
 * ai.targetCoverage quarters of next quarter's demand in stock. An
 * opportunist plans more while rivals are out of stock, and for
 * captureShare × opportunism of the volume of its prey (rivals in difficulty).
 */
export function production(plan: Plan): void {
  const { obs, config, profile, company, line } = plan;
  const cfg = plantConfig(config, company.sector);
  if (profile.stockoutPremium > 0 && rivalsOutOfStock(plan)) {
    plan.forecast *= 1 + profile.stockoutPremium;
    plan.nextForecast *= 1 + profile.stockoutPremium;
  }
  // Opportunism: plans for part of the customers of the rivals in difficulty.
  const prey = new Set(plan.tactics.prey);
  const preyShare = sum(
    obs.competitors
      .filter((c) => prey.has(c.companyId))
      .flatMap((c) => c.products.filter((p) => p.marketId === plan.market.id))
      .map((p) => p.marketShare),
  );
  const captured =
    profile.opportunism *
    config.ai.opportunism.captureShare *
    preyShare *
    plan.market.lastResult.volume;
  plan.forecast += captured;
  plan.nextForecast += captured;
  const stock = company.inventory[line.id]?.qty ?? 0;
  const wanted = plan.forecast + config.ai.targetCoverage * plan.nextForecast - stock;
  plan.output = Math.max(0, Math.min(obs.self.outputCeiling, wanted));

  const total = obs.self.sites.reduce((s, x) => s + x.ceiling, 0);
  for (const site of obs.self.sites) {
    if (site.status !== 'operational' || site.ceiling <= 0) continue;
    plan.decisions.production[site.siteId] = {
      targetOutput: total > 0 ? (plan.output * site.ceiling) / total : 0,
    };
  }

  const factor = materialFactor(cfg, line.quality);
  plan.perUnit = {};
  for (const [id, q] of Object.entries(cfg.recipe)) plan.perUnit[id] = q * factor;
}
