import type { AgriConfig } from '../../config/schema';
import type { TurnContext } from '../../core/context';
import { isOperating, operationalSites } from '../../core/companies';
import { sum } from '../../core/math';
import type { Company, Site } from '../../model/company';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import { effectiveStaff, settleNonStorable, staffAt } from '../plant';
import { regionalYield } from './weather';

type FarmConfig = AgriConfig['farm'];

export const isFarm = (site: Site): boolean => site.kind === 'farm';

/** Land of a farm at today's prices (it is not depreciated). */
export const farmLandValue = (F: FarmConfig, landCostIndex: number, priceLevel: number): number =>
  F.hectares * F.landCostPerHectare * landCostIndex * priceLevel;

/** Price of a farm: its land and its equipment. */
export const buyFarmCost = (F: FarmConfig, landCostIndex: number, priceLevel: number): number =>
  farmLandValue(F, landCostIndex, priceLevel) + F.equipmentCost * priceLevel;

/** Farmland keeps most of its value. */
export const farmResaleValue = (F: FarmConfig, bookValue: number): number =>
  bookValue * (1 - F.resaleDiscount);

/** Hectares of a region not yet owned by an operating company (farms being set up included). */
export function farmlandLeft(state: GameState, regionId: Id): number {
  const F = state.config.sectors.agri?.farm;
  if (!F) return 0;
  const owned = sum(
    Object.values(state.companies)
      .filter(isOperating)
      .flatMap((c) => Object.values(c.sites))
      .filter((s) => isFarm(s) && s.regionId === regionId)
      .map((s) => s.hectares ?? 0),
  );
  return Math.max(0, (F.landByRegion[regionId] ?? 0) - owned);
}

/** Hectares of the operational farms, by region. */
function hectaresByRegion(company: Company): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const site of operationalSites(company)) {
    if (isFarm(site)) out[site.regionId] = (out[site.regionId] ?? 0) + (site.hectares ?? 0);
  }
  return out;
}

const isHarvest = (F: FarmConfig, turn: number): boolean => turn % 4 === F.harvestSeason;

/** Fertilizer the farms spread this quarter (at the harvest only). */
export function fertilizerNeed(state: GameState, company: Company): number {
  const F = state.config.sectors.agri?.farm;
  if (!F || !isHarvest(F, state.meta.turn)) return 0;
  return sum(Object.values(hectaresByRegion(company))) * F.fertilizerPerHectare;
}

/**
 * Expected harvest of the farms of a region: hectares × yield × yield index ×
 * min(1, farmhands / target) × (1 + bonus × min(1, agronomists / target)).
 */
export function regionHarvest(
  state: GameState,
  company: Company,
  regionId: Id,
  hectares: number,
): number {
  const F = state.config.sectors.agri?.farm;
  if (!F || hectares <= 0) return 0;
  const ratio = (occupationId: Id, perHectare: number) =>
    Math.min(
      1,
      effectiveStaff(state, staffAt(company, regionId, occupationId)) / (hectares * perHectare),
    );
  return (
    hectares *
    F.yieldPerHectare *
    regionalYield(state, regionId) *
    ratio(F.farmhandOccupationId, F.farmhandsPerHectare) *
    (1 + F.agronomistYieldBonus * ratio(F.agronomistOccupationId, F.agronomistsPerHectare))
  );
}

/**
 * Harvest season: the farms bring in their crop, which joins the stock of
 * that commodity at the cost of the fertilizer spread (wages are period
 * costs). Every quarter: upkeep of the farms.
 */
export function runFarms(ctx: TurnContext, company: Company): void {
  const { draft: state, config, turn } = ctx;
  const F = config.sectors.agri?.farm;
  if (!F) return;
  const ledger = ctx.ledger(company.id);
  const byRegion = hectaresByRegion(company);
  const regions = Object.keys(byRegion).sort();
  ledger.other +=
    operationalSites(company).filter(isFarm).length * F.maintenanceCost * state.macro.priceLevel;
  if (regions.length === 0 || !isHarvest(F, turn)) return;

  const crop = sum(regions.map((r) => regionHarvest(state, company, r, byRegion[r] ?? 0)));
  const hectares = sum(regions.map((r) => byRegion[r] ?? 0));
  const cost = settleNonStorable(ctx, company, F.fertilizerId, hectares * F.fertilizerPerHectare);
  if (crop > 0) {
    const lot = (company.inventory[F.cropId] ??= { qty: 0, avgCost: 0 });
    lot.avgCost = (lot.qty * lot.avgCost + cost) / (lot.qty + crop);
    lot.qty += crop;
  } else {
    ledger.cogs += cost; // nothing to carry the fertilizer: an expense of the quarter
  }
  ctx.log({
    kind: 'harvest',
    severity: 'info',
    companyId: company.id,
    data: { commodityId: F.cropId, qty: crop, hectares },
  });
}
