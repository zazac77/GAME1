import type { TurnContext } from '../../core/context';
import { operationalSites, producingLines, trainees } from '../../core/companies';
import { laborPoolKey } from '../../core/keys';
import { clamp, sum } from '../../core/math';
import { applyModifiers } from '../../core/modifiers';
import type { Company, ProductionLine, ProductLine, Site, Staff } from '../../model/company';
import type { CompanyDecisions } from '../../model/decisions';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import type { SectorModule } from '../types';
import { rndProductivityFactor, rndQualityBonus } from './rnd';

type IndustryConfig = GameState['config']['sectors']['industry'];

/** Units per quarter of a line, after the aging penalty. */
export function lineCapacity(cfg: IndustryConfig, line: ProductionLine): number {
  return line.capacity * Math.max(0, 1 - cfg.line.agingPenalty * line.age);
}

/** Units per quarter of the producing lines of a site. */
export const siteCapacity = (cfg: IndustryConfig, site: Site): number =>
  sum(producingLines(site).map((l) => lineCapacity(cfg, l)));

/** Material consumption multiplier of a quality level (the recipe is for quality ≤ 50). */
export const materialFactor = (cfg: IndustryConfig, quality: number): number =>
  1 + cfg.qualityCostSlope * Math.max(0, quality - 50);

/** Producing staff: trainees excluded, new hires at reduced productivity. */
function effectiveStaff(state: GameState, staff: Staff | undefined): number {
  if (!staff) return 0;
  const rampLoss = (1 - state.config.labor.rampUpProductivity) * staff.rampingUp;
  return Math.max(0, staff.headcount - trainees(staff) - rampLoss);
}

const staffAt = (company: Company, regionId: Id, occupationId: Id): Staff | undefined =>
  company.workforce[laborPoolKey(regionId, occupationId)];

/** Units per operator and per quarter in a region (process R&D included). */
export function operatorProductivity(state: GameState, company: Company, regionId: Id): number {
  const cfg = state.config.sectors.industry;
  const operators = effectiveStaff(state, staffAt(company, regionId, cfg.operatorOccupationId));
  let support = 1;
  for (const [occupationId, ratio] of Object.entries(cfg.supportRatios)) {
    if (ratio <= 0) continue;
    const actual = effectiveStaff(state, staffAt(company, regionId, occupationId));
    const relative = operators > 0 ? actual / (ratio * operators) : 1;
    support *= Math.min(cfg.supportStaff.maxBonus, relative ** cfg.supportStaff.elasticity);
  }
  const learning =
    (Math.max(company.cumulativeOutput, cfg.learningReferenceOutput) /
      cfg.learningReferenceOutput) **
    -Math.log2(1 - cfg.learningRate);
  const modifier = applyModifiers(state.modifiers, 'labor.productivity', 1, [
    { kind: 'region', id: regionId },
    { kind: 'laborPool', id: laborPoolKey(regionId, cfg.operatorOccupationId) },
    { kind: 'company', id: company.id },
  ]);
  const rnd = rndProductivityFactor(cfg, company, mainProductLine(state, company));
  return cfg.operatorProductivity * support * learning * rnd * Math.max(0, modifier);
}

/**
 * Output ceiling of each operational site from its lines and the operators of
 * its region (shared between the sites of a region by line capacity).
 */
export function siteCeilings(
  state: GameState,
  company: Company,
): { site: Site; ceiling: number }[] {
  const cfg = state.config.sectors.industry;
  const sites = operationalSites(company);
  const regionCapacity: Record<Id, number> = {};
  for (const site of sites) {
    regionCapacity[site.regionId] = (regionCapacity[site.regionId] ?? 0) + siteCapacity(cfg, site);
  }
  return sites.map((site) => {
    const capacity = siteCapacity(cfg, site);
    const operators = effectiveStaff(
      state,
      staffAt(company, site.regionId, cfg.operatorOccupationId),
    );
    const crewOutput = operators * operatorProductivity(state, company, site.regionId);
    const share =
      (regionCapacity[site.regionId] ?? 0) > 0
        ? capacity / (regionCapacity[site.regionId] ?? 1)
        : 0;
    return { site, ceiling: Math.min(capacity, crewOutput * share) };
  });
}

/** The product line fed by the factories (MVP: one line per company). */
export function mainProductLine(state: GameState, company: Company): ProductLine | undefined {
  const marketId = state.config.sectors.industry.productMarketId;
  return Object.keys(company.productLines)
    .sort()
    .map((id) => company.productLines[id] as ProductLine)
    .find((l) => l.marketId === marketId);
}

function materialsPerUnit(
  state: GameState,
  _company: Company,
  line: ProductLine,
): Record<Id, number> {
  const cfg = state.config.sectors.industry;
  const factor = materialFactor(cfg, line.quality);
  const out: Record<Id, number> = {};
  for (const [commodityId, perUnit] of Object.entries(cfg.recipe))
    out[commodityId] = perUnit * factor;
  return out;
}

function plannedOutput(
  state: GameState,
  company: Company,
  decisions: CompanyDecisions | undefined,
): number {
  return sum(
    siteCeilings(state, company).map(({ site, ceiling }) =>
      Math.floor(Math.min(ceiling, decisions?.production[site.id]?.targetOutput ?? Infinity)),
    ),
  );
}

/**
 * Moves the product line's quality towards min(aimed, reachable). Reachable
 * quality: engineers, line tech level and R&D levels.
 */
function updateQuality(state: GameState, company: Company, line: ProductLine): void {
  const cfg = state.config.sectors.industry;
  const q = cfg.quality;
  const sites = operationalSites(company);
  const regions = [...new Set(sites.map((s) => s.regionId))];
  const operators = sum(
    regions.map((r) => effectiveStaff(state, staffAt(company, r, cfg.operatorOccupationId))),
  );
  const engineers = sum(
    regions.map((r) => effectiveStaff(state, staffAt(company, r, q.engineerOccupationId))),
  );
  const targetRatio = cfg.supportRatios[q.engineerOccupationId] ?? 0;
  const ratio =
    operators > 0 && targetRatio > 0
      ? engineers / (targetRatio * operators)
      : engineers > 0
        ? q.maxEngineerRatio
        : 0;
  const lines = sites.flatMap(producingLines);
  const capacity = sum(lines.map((l) => l.capacity));
  const techLevel =
    capacity > 0
      ? sum(lines.map((l) => l.capacity * l.techLevel)) / capacity
      : cfg.line.initialTechLevel;
  const reachable = clamp(
    q.base +
      q.engineerWeight * Math.min(q.maxEngineerRatio, ratio) +
      q.techLevelWeight * (techLevel - 1) +
      rndQualityBonus(cfg, company, line),
    0,
    100,
  );
  const aim = Math.min(line.qualityTarget, reachable);
  line.quality = clamp(line.quality + q.adjustSpeed * (aim - line.quality), 0, 100);
}

/**
 * Settles a non-storable input (energy) at consumption: contract volumes
 * first (unused volume pays the take-or-pay penalty), the rest at spot.
 * Returns the cost to capitalize into the finished goods.
 */
function settleNonStorable(
  ctx: TurnContext,
  company: Company,
  commodityId: Id,
  need: number,
): number {
  const { draft, config, turn } = ctx;
  const market = draft.commodities[commodityId];
  if (!market) return 0;
  const ledger = ctx.ledger(company.id);
  const supply = clamp(
    applyModifiers(draft.modifiers, 'commodity.supply', 1, [
      { kind: 'commodity', id: commodityId },
    ]),
    0,
    1,
  );
  let remaining = need;
  let cost = 0;
  for (const contract of company.contracts) {
    if (contract.commodityId !== commodityId) continue;
    if (contract.startsAt > turn || contract.endsAt <= turn) continue;
    const delivered = contract.qtyPerQuarter * supply;
    const used = Math.min(remaining, delivered);
    remaining -= used;
    cost += used * contract.price;
    ledger.other += (delivered - used) * contract.price * config.commodities.takeOrPayPenalty;
  }
  cost += remaining * market.spotPrice * (1 + config.commodities.spotPremium);
  ledger.purchases += cost;
  return cost;
}

function produce(ctx: TurnContext, company: Company): void {
  const { draft: state, config } = ctx;
  const cfg = config.sectors.industry;
  const ledger = ctx.ledger(company.id);
  const decisions = ctx.decisions[company.id];
  const line = mainProductLine(state, company);

  let total = 0;
  let perUnit: Record<Id, number> = {};
  if (line) {
    const qualityTarget = decisions?.pricing[line.id]?.qualityTarget;
    if (qualityTarget !== undefined) line.qualityTarget = qualityTarget;
    updateQuality(state, company, line);
    perUnit = materialsPerUnit(state, company, line);

    // Storable materials limit the output; non-storable ones are bought as needed.
    let materialLimit = Infinity;
    for (const [commodityId, q] of Object.entries(perUnit)) {
      if (q <= 0 || !config.commodities.markets[commodityId]?.storable) continue;
      materialLimit = Math.min(materialLimit, (company.inventory[commodityId]?.qty ?? 0) / q);
    }
    for (const { site, ceiling } of siteCeilings(state, company)) {
      const wanted = Math.min(ceiling, decisions?.production[site.id]?.targetOutput ?? Infinity);
      const output = Math.max(0, Math.floor(Math.min(wanted, materialLimit - total)));
      total += output;
    }
  }

  // Consumption, at book cost for stored materials.
  let cost = 0;
  for (const [commodityId, market] of Object.entries(config.commodities.markets)) {
    const need = total * (perUnit[commodityId] ?? 0);
    if (!market.storable) {
      cost += settleNonStorable(ctx, company, commodityId, need);
      continue;
    }
    if (need <= 0) continue;
    const lot = company.inventory[commodityId];
    if (!lot) continue;
    const used = Math.min(lot.qty, need);
    lot.qty = lot.qty - used < 1e-9 ? 0 : lot.qty - used;
    cost += used * lot.avgCost;
  }

  if (line && total > 0) {
    const lot = (company.inventory[line.id] ??= { qty: 0, avgCost: 0 });
    const qty = lot.qty + total;
    lot.avgCost = (lot.qty * lot.avgCost + cost) / qty;
    lot.qty = qty;
  }

  const lines = operationalSites(company).flatMap(producingLines);
  ledger.other += lines.length * cfg.line.maintenanceCost * state.macro.priceLevel;
  for (const l of lines) l.age += 1;
  company.cumulativeOutput += total;
  ledger.unitsProduced += total;
}

export const industryModule: SectorModule = {
  id: 'industry',
  materialsPerUnit,
  plannedOutput,
  produce,
};
