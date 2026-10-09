import type { RndType } from '../../model/company';
import { plantConfig } from '../../sectors/config';
import { rndLevel, rndMaxSpend, rndProjectCost } from '../../sectors/plant/rnd';
import type { Plan } from './plan';

/**
 * 7b. R&D: rndShareOfRevenue of the expected revenue, split between process
 * and product projects by rndProcessShare, each within what its project can
 * absorb this quarter (as validation will cap it).
 */
export function rnd(plan: Plan, revenue: number): void {
  const { obs, config, profile, company, line } = plan;
  const cfg = plantConfig(config, company.sector);
  const total = profile.rndShareOfRevenue * revenue;
  if (total <= 0) return;
  const split: Record<RndType, number> = {
    process: profile.rndProcessShare,
    product: 1 - profile.rndProcessShare,
  };
  for (const type of ['process', 'product'] as const) {
    const current = company.rnd.find((p) => p.type === type);
    const level = rndLevel(company, type, line);
    if (!current && level >= cfg.rnd.maxLevel) continue;
    const cost = current?.cost ?? rndProjectCost(cfg, type, level, obs.macro.priceLevel);
    const budget = Math.min(split[type] * total, rndMaxSpend(cfg, cost, current?.progress ?? 0));
    if (budget <= 0) continue;
    plan.decisions.rnd.push({ type, budget });
    plan.spend.discretionary += budget;
  }
}
