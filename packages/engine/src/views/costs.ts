import { isOperating } from '../core/companies';
import type { Company, RndType } from '../model/company';
import type { GameState } from '../model/state';
import type { PlayerCosts, RndQuote } from '../model/views';
import { buyFarmCost, farmlandLeft } from '../sectors/agri/farm';
import { agriConfigOf, plantConfigOf } from '../sectors/config';
import { mainProductLine } from '../sectors/plant';
import { addLineCost, buildSiteCost, modernizeLineCost } from '../sectors/plant/capex';
import { rndLevel, rndMaxSpend, rndProjectCost } from '../sectors/plant/rnd';
import { disposalValue } from '../systems/capex';

/** Quotes of the quarter, at the start-of-quarter price level (as validation charges them). */
export function playerCosts(state: GameState, company: Company): PlayerCosts | undefined {
  if (!isOperating(company)) return undefined;
  const cfg = plantConfigOf(state.config, company.sector);
  if (!cfg) return undefined;
  const { priceLevel } = state.macro;
  const buildSite: PlayerCosts['buildSite'] = {};
  for (const region of Object.values(state.regions)) {
    buildSite[region.id] = buildSiteCost(cfg, region.landCostIndex, priceLevel);
  }
  const saleValue: PlayerCosts['saleValue'] = {};
  for (const site of Object.values(company.sites)) {
    for (const line of Object.values(site.lines)) {
      saleValue[line.id] = disposalValue(state, company, {
        kind: 'sell_line',
        siteId: site.id,
        lineId: line.id,
      });
    }
    saleValue[site.id] = disposalValue(state, company, { kind: 'sell_site', siteId: site.id });
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
  const costs: PlayerCosts = {
    buildSite,
    addLine: addLineCost(cfg, priceLevel),
    modernizeLine: modernizeLineCost(cfg, priceLevel),
    saleValue,
    rnd: { process: quote('process'), product: quote('product') },
  };
  const farm = agriConfigOf(state.config, company.sector)?.farm;
  if (farm) {
    const farms: NonNullable<PlayerCosts['farms']> = {
      buy: {},
      landLeft: {},
      hectares: farm.hectares,
    };
    for (const region of Object.values(state.regions)) {
      farms.buy[region.id] = buyFarmCost(farm, region.landCostIndex, priceLevel);
      farms.landLeft[region.id] = farmlandLeft(state, region.id);
    }
    costs.farms = farms;
  }
  return costs;
}
