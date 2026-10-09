import { isOperating } from '../core/companies';
import { sum } from '../core/math';
import type { Company, RndType } from '../model/company';
import type { GameState } from '../model/state';
import type { PlayerCosts, RndQuote } from '../model/views';
import { mainProductLine } from '../sectors/industry';
import {
  addLineCost,
  buildSiteCost,
  modernizeLineCost,
  resaleValue,
} from '../sectors/industry/capex';
import { rndLevel, rndMaxSpend, rndProjectCost } from '../sectors/industry/rnd';

/** Quotes of the quarter, at the start-of-quarter price level (as validation charges them). */
export function playerCosts(state: GameState, company: Company): PlayerCosts | undefined {
  if (!isOperating(company)) return undefined;
  const cfg = state.config.sectors.industry;
  const { priceLevel } = state.macro;
  const buildSite: PlayerCosts['buildSite'] = {};
  for (const region of Object.values(state.regions)) {
    buildSite[region.id] = buildSiteCost(cfg, region.landCostIndex, priceLevel);
  }
  const saleValue: PlayerCosts['saleValue'] = {};
  for (const site of Object.values(company.sites)) {
    for (const line of Object.values(site.lines)) {
      saleValue[line.id] = resaleValue(cfg, line.bookValue);
    }
    saleValue[site.id] = resaleValue(
      cfg,
      site.buildingBookValue + sum(Object.values(site.lines).map((l) => l.bookValue)),
    );
  }
  const line = mainProductLine(state, company);
  const quote = (type: RndType): RndQuote => {
    const project = company.rnd.find((p) => p.type === type);
    const level = rndLevel(company, type, line);
    const cost = project?.cost ?? rndProjectCost(cfg, type, level, priceLevel);
    const blocked = (!project && level >= cfg.rnd.maxLevel) || (type === 'product' && !line);
    const q: RndQuote = {
      level,
      maxLevel: cfg.rnd.maxLevel,
      progress: project?.progress ?? 0,
      cost,
      maxBudget: blocked ? 0 : rndMaxSpend(cfg, cost, project?.progress ?? 0),
    };
    if (project) q.projectId = project.id;
    return q;
  };
  return {
    buildSite,
    addLine: addLineCost(cfg, priceLevel),
    modernizeLine: modernizeLineCost(cfg, priceLevel),
    saleValue,
    rnd: { process: quote('process'), product: quote('product') },
  };
}
