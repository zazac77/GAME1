import { isOperating } from '../core/companies';
import type { TechConfig } from '../config/schema';
import type { Company, RndType } from '../model/company';
import type { GameState } from '../model/state';
import type { PlayerCosts, RndQuote } from '../model/views';
import { buyFarmCost, farmlandLeft } from '../sectors/agri/farm';
import { agriConfigOf, plantConfigOf, sectorProductLine, techConfigOf } from '../sectors/config';
import { mainProductLine } from '../sectors/plant';
import { addLineCost, buildSiteCost, modernizeLineCost } from '../sectors/plant/capex';
import { rndLevel, rndMaxSpend, rndProjectCost } from '../sectors/plant/rnd';
import { canStartTechProject, maxDevelopersFor, techProjectEffort } from '../sectors/tech/rnd';
import {
  averageWage,
  developerEfficiency,
  headcountByRegion,
  seatsByRegion,
  techTeam,
} from '../sectors/tech/team';
import { disposalValue } from '../systems/capex';
import { capitalQuotes } from './mna';

/** Cash a disposal would bring, by line id and by site id. */
function saleValues(state: GameState, company: Company): PlayerCosts['saleValue'] {
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
  return saleValue;
}

/** Quotes of the quarter, at the start-of-quarter price level (as validation charges them). */
export function playerCosts(state: GameState, company: Company): PlayerCosts | undefined {
  if (!isOperating(company)) return undefined;
  const costs = sectorCosts(state, company);
  return costs ? { ...costs, capital: capitalQuotes(state, company) } : undefined;
}

function sectorCosts(state: GameState, company: Company): Omit<PlayerCosts, 'capital'> | undefined {
  const tech = techConfigOf(state.config, company.sector);
  if (tech) return techCosts(state, company, tech);
  const cfg = plantConfigOf(state.config, company.sector);
  if (!cfg) return undefined;
  const { priceLevel } = state.macro;
  const buildSite: PlayerCosts['buildSite'] = {};
  for (const region of Object.values(state.regions)) {
    buildSite[region.id] = buildSiteCost(cfg, region.landCostIndex, priceLevel);
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
  const costs: Omit<PlayerCosts, 'capital'> = {
    buildSite,
    addLine: addLineCost(cfg, priceLevel),
    modernizeLine: modernizeLineCost(cfg, priceLevel),
    saleValue: saleValues(state, company),
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

/**
 * Tech: buildSite prices an office; R&D projects are quoted in
 * developer-quarters and developers (no cash budget: maxBudget is 0). The
 * product's "level" is its tech level and its ceiling the frontier + maxLead.
 */
function techCosts(
  state: GameState,
  company: Company,
  tech: TechConfig,
): Omit<PlayerCosts, 'capital'> {
  const { priceLevel } = state.macro;
  const buildSite: PlayerCosts['buildSite'] = {};
  for (const region of Object.values(state.regions)) {
    buildSite[region.id] = tech.office.buildCost * region.landCostIndex * priceLevel;
  }
  const line = sectorProductLine(state.config, company);
  const frontier = line ? (state.productMarkets[line.marketId]?.techFrontier ?? 0) : 0;
  const team = techTeam(state.config, tech, company, 0);
  const efficiency = developerEfficiency(tech, team);
  const developers = Math.max(0, Math.floor(team.developers + 1e-9));
  const wage = averageWage(company, tech.developerOccupationId);
  const quote = (type: RndType): RndQuote => {
    const project = company.rnd.find((p) => p.type === type);
    const effort = project?.effort ?? techProjectEffort(tech, type, company.processLevel);
    const progress = project?.progress ?? 0;
    const blocked =
      (!project && !canStartTechProject(tech, type, company.processLevel)) ||
      (type === 'product' && !line);
    const q: RndQuote = {
      level: type === 'process' ? company.processLevel : (line?.techLevel ?? 0),
      maxLevel: type === 'process' ? tech.rnd.maxLevel : frontier + tech.frontier.maxLead,
      progress,
      cost: project?.cost ?? effort * wage,
      maxBudget: 0,
      effort,
      maxDevelopers: blocked
        ? 0
        : Math.min(developers, maxDevelopersFor(tech, effort, progress, efficiency)),
    };
    if (project) q.projectId = project.id;
    return q;
  };
  const seats = seatsByRegion(company);
  const headcounts = headcountByRegion(company);
  const freeSeats: Record<string, number> = {};
  for (const regionId of Object.keys(state.regions)) {
    freeSeats[regionId] = Math.max(0, (seats[regionId] ?? 0) - (headcounts[regionId] ?? 0));
  }
  return {
    buildSite,
    addLine: 0,
    modernizeLine: 0,
    saleValue: saleValues(state, company),
    rnd: { process: quote('process'), product: quote('product') },
    tech: {
      seats: tech.office.seats,
      freeSeats,
      developers,
      frontier,
    },
  };
}
