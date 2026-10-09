import type { TurnContext } from '../../core/context';
import { operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import { sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company, ProductionLine, Site } from '../../model/company';
import type { CapexOrder } from '../../model/decisions';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import { buyFarmCost, farmLandValue, farmResaleValue } from '../../sectors/agri/farm';
import { assetResaleDiscountOf, plantConfigOf, techConfigOf } from '../../sectors/config';
import { addLineCost, buildSiteCost, modernizeLineCost } from '../../sectors/plant/capex';
import { officeCost } from '../../sectors/tech/team';

/**
 * Cash paid when the order is placed (0 for disposals), at the price level
 * of the start of the quarter (the price quoted when deciding).
 */
export function capexOrderCost(
  state: GameState,
  company: Company,
  order: CapexOrder,
  priceLevel: number = state.macro.priceLevel,
): number {
  const cfg = plantConfigOf(state.config, company.sector);
  const tech = techConfigOf(state.config, company.sector);
  const landCostIndex =
    'regionId' in order ? (state.regions[order.regionId]?.landCostIndex ?? 1) : 1;
  switch (order.kind) {
    case 'build_site':
      if (tech) return officeCost(tech, landCostIndex, priceLevel);
      return cfg ? buildSiteCost(cfg, landCostIndex, priceLevel) : 0;
    case 'buy_farm': {
      const farm = state.config.sectors.agri?.farm;
      return farm ? buyFarmCost(farm, landCostIndex, priceLevel) : 0;
    }
    case 'add_line':
      return cfg ? addLineCost(cfg, priceLevel) : 0;
    case 'modernize_line':
      return cfg ? modernizeLineCost(cfg, priceLevel) : 0;
    default:
      return 0;
  }
}

/** Book value of what a disposal order sells. */
export function disposalBookValue(company: Company, order: CapexOrder): number {
  const site = 'siteId' in order ? company.sites[order.siteId] : undefined;
  if (!site) return 0;
  if (order.kind === 'sell_line') return site.lines[order.lineId]?.bookValue ?? 0;
  if (order.kind === 'sell_site') {
    return site.buildingBookValue + sum(Object.values(site.lines).map((l) => l.bookValue));
  }
  return 0;
}

/** Cash a disposal order brings in: specific assets at a discount, farmland near its book value. */
export function disposalValue(state: GameState, company: Company, order: CapexOrder): number {
  const book = disposalBookValue(company, order);
  const farm = state.config.sectors.agri?.farm;
  const site = 'siteId' in order ? company.sites[order.siteId] : undefined;
  if (order.kind === 'sell_site' && site?.kind === 'farm' && farm) {
    return farmResaleValue(farm, book);
  }
  return book * (1 - assetResaleDiscountOf(state.config, company.sector));
}

/** Finished construction and modernization projects are put into service. */
function commission(ctx: TurnContext, company: Company): void {
  const { config, turn } = ctx;
  const line = plantConfigOf(config, company.sector)?.line;
  for (const siteId of Object.keys(company.sites).sort()) {
    const site = company.sites[siteId] as Site;
    if (site.status === 'under_construction' && (site.completesAt ?? turn) <= turn) {
      site.status = 'operational';
      delete site.completesAt;
      ctx.log({
        kind: 'site_commissioned',
        severity: 'info',
        companyId: company.id,
        data: { siteId, siteKind: site.kind },
      });
    }
    if (site.status !== 'operational' || !line) continue;
    for (const lineId of Object.keys(site.lines).sort()) {
      const l = site.lines[lineId] as ProductionLine;
      if (l.status === 'operational' || (l.completesAt ?? turn) > turn) continue;
      if (l.status === 'modernizing') {
        l.techLevel = Math.min(line.maxTechLevel, l.techLevel + line.modernizeTechGain);
        l.age = 0;
      }
      const kind = l.status === 'modernizing' ? 'line_modernized' : 'line_commissioned';
      l.status = 'operational';
      delete l.completesAt;
      ctx.log({ kind, severity: 'info', companyId: company.id, data: { siteId, lineId } });
    }
  }
}

function newLine(
  ctx: TurnContext,
  company: Company,
  cost: number,
  completesAt: number,
): ProductionLine {
  const cfg = plantConfigOf(ctx.config, company.sector)?.line;
  if (!cfg) throw new Error(`Sector ${company.sector} has no production lines`);
  return {
    id: newId(ctx.draft.meta, 'line'),
    status: 'under_construction',
    completesAt,
    capacity: cfg.capacity,
    age: 0,
    techLevel: cfg.initialTechLevel,
    bookValue: cost,
    depreciationPerQuarter: cost / cfg.depreciationQuarters,
  };
}

/** Executes one validated order: cash out (or in), assets in (or out). */
function execute(ctx: TurnContext, company: Company, order: CapexOrder): void {
  const { draft, config, turn } = ctx;
  const cfg = plantConfigOf(config, company.sector);
  const tech = techConfigOf(config, company.sector);
  const ledger = ctx.ledger(company.id);
  const cost = capexOrderCost(draft, company, order, ctx.openingPriceLevel);
  const log = (kind: string, data: Record<string, string | number>) =>
    ctx.log({ kind, severity: 'info', companyId: company.id, data });

  switch (order.kind) {
    case 'build_site': {
      const siteId = newId(draft.meta, 'site');
      if (tech) {
        company.sites[siteId] = {
          id: siteId,
          kind: 'office',
          regionId: order.regionId,
          status: 'under_construction',
          completesAt: turn + tech.office.setupQuarters,
          lines: {},
          buildingBookValue: cost,
          buildingDepreciationPerQuarter: cost / tech.office.depreciationQuarters,
          warehouseCapacity: 0,
          seats: tech.office.seats,
        };
        ledger.capex += cost;
        log('capex_started', { order: order.kind, siteId, siteKind: 'office', cost });
        return;
      }
      if (!cfg) return;
      company.sites[siteId] = {
        id: siteId,
        kind: 'factory',
        regionId: order.regionId,
        status: 'under_construction',
        completesAt: turn + cfg.factory.buildQuarters,
        lines: {},
        buildingBookValue: cost,
        buildingDepreciationPerQuarter: cost / cfg.factory.depreciationQuarters,
        warehouseCapacity: cfg.factory.warehouseCapacity,
      };
      ledger.capex += cost;
      log('capex_started', { order: order.kind, siteId, cost });
      return;
    }
    case 'buy_farm': {
      const farm = config.sectors.agri?.farm;
      if (!farm) return;
      const siteId = newId(draft.meta, 'site');
      const landCostIndex = draft.regions[order.regionId]?.landCostIndex ?? 1;
      const landValue = Math.min(cost, farmLandValue(farm, landCostIndex, ctx.openingPriceLevel));
      company.sites[siteId] = {
        id: siteId,
        kind: 'farm',
        regionId: order.regionId,
        status: 'under_construction',
        completesAt: turn + farm.setupQuarters,
        lines: {},
        buildingBookValue: cost,
        buildingDepreciationPerQuarter: (cost - landValue) / farm.depreciationQuarters,
        landValue,
        warehouseCapacity: farm.warehouseCapacity,
        hectares: farm.hectares,
      };
      ledger.capex += cost;
      log('capex_started', { order: order.kind, siteId, cost });
      return;
    }
    case 'add_line': {
      const site = company.sites[order.siteId];
      if (!site || !cfg) return;
      // A line cannot run before its factory.
      const completesAt = Math.max(turn + cfg.line.buildQuarters, site.completesAt ?? turn);
      const line = newLine(ctx, company, cost, completesAt);
      site.lines[line.id] = line;
      ledger.capex += cost;
      log('capex_started', { order: order.kind, siteId: site.id, lineId: line.id, cost });
      return;
    }
    case 'modernize_line': {
      const line = company.sites[order.siteId]?.lines[order.lineId];
      if (!line || !cfg) return;
      line.status = 'modernizing';
      line.completesAt = turn + cfg.line.modernizeQuarters;
      line.bookValue += cost;
      line.depreciationPerQuarter += cost / cfg.line.depreciationQuarters;
      ledger.capex += cost;
      log('capex_started', { order: order.kind, siteId: order.siteId, lineId: line.id, cost });
      return;
    }
    case 'sell_line':
    case 'sell_site': {
      const site = company.sites[order.siteId];
      if (!site) return;
      const book = disposalBookValue(company, order);
      const proceeds = disposalValue(draft, company, order);
      const siteKind = site.kind;
      const without = <T>(record: Record<Id, T>, id: Id) =>
        Object.fromEntries(Object.entries(record).filter(([k]) => k !== id));
      if (order.kind === 'sell_line') site.lines = without(site.lines, order.lineId);
      else company.sites = without(company.sites, order.siteId);
      ledger.disposals += proceeds;
      ledger.writeOffs += book - proceeds;
      log('asset_sold', {
        order: order.kind,
        siteId: order.siteId,
        siteKind,
        proceeds,
        bookValue: book,
      });
      return;
    }
  }
}

/**
 * Step 4: projects that complete this quarter are put into service, then the
 * validated orders are executed. Investments are paid when ordered and
 * capitalized at once (assets under construction are not depreciated);
 * disposals bring the resale value in and charge the book value lost.
 */
export const capexSystem: System = {
  id: 'capex',
  run(ctx) {
    for (const company of operatingCompanies(ctx.draft)) {
      commission(ctx, company);
      for (const order of ctx.decisions[company.id]?.capex ?? []) execute(ctx, company, order);
    }
  },
};
