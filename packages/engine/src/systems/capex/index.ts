import type { TurnContext } from '../../core/context';
import { operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import { sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company, ProductionLine, Site } from '../../model/company';
import type { CapexOrder } from '../../model/decisions';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import {
  addLineCost,
  buildSiteCost,
  modernizeLineCost,
  resaleValue,
} from '../../sectors/industry/capex';

/**
 * Cash paid when the order is placed (0 for disposals), at the price level
 * of the start of the quarter (the price quoted when deciding).
 */
export function capexOrderCost(
  state: GameState,
  order: CapexOrder,
  priceLevel: number = state.macro.priceLevel,
): number {
  const cfg = state.config.sectors.industry;
  switch (order.kind) {
    case 'build_site':
      return buildSiteCost(cfg, state.regions[order.regionId]?.landCostIndex ?? 1, priceLevel);
    case 'add_line':
      return addLineCost(cfg, priceLevel);
    case 'modernize_line':
      return modernizeLineCost(cfg, priceLevel);
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

/** Finished construction and modernization projects are put into service. */
function commission(ctx: TurnContext, company: Company): void {
  const { config, turn } = ctx;
  const line = config.sectors.industry.line;
  for (const siteId of Object.keys(company.sites).sort()) {
    const site = company.sites[siteId] as Site;
    if (site.status === 'under_construction' && (site.completesAt ?? turn) <= turn) {
      site.status = 'operational';
      delete site.completesAt;
      ctx.log({
        kind: 'site_commissioned',
        severity: 'info',
        companyId: company.id,
        data: { siteId },
      });
    }
    if (site.status !== 'operational') continue;
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

function newLine(ctx: TurnContext, cost: number, completesAt: number): ProductionLine {
  const cfg = ctx.config.sectors.industry.line;
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
  const cfg = config.sectors.industry;
  const ledger = ctx.ledger(company.id);
  const cost = capexOrderCost(draft, order, ctx.openingPriceLevel);
  const log = (kind: string, data: Record<string, string | number>) =>
    ctx.log({ kind, severity: 'info', companyId: company.id, data });

  switch (order.kind) {
    case 'build_site': {
      const siteId = newId(draft.meta, 'site');
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
    case 'add_line': {
      const site = company.sites[order.siteId];
      if (!site) return;
      // A line cannot run before its factory.
      const completesAt = Math.max(turn + cfg.line.buildQuarters, site.completesAt ?? turn);
      const line = newLine(ctx, cost, completesAt);
      site.lines[line.id] = line;
      ledger.capex += cost;
      log('capex_started', { order: order.kind, siteId: site.id, lineId: line.id, cost });
      return;
    }
    case 'modernize_line': {
      const line = company.sites[order.siteId]?.lines[order.lineId];
      if (!line) return;
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
      const proceeds = resaleValue(cfg, book);
      const without = <T>(record: Record<Id, T>, id: Id) =>
        Object.fromEntries(Object.entries(record).filter(([k]) => k !== id));
      if (order.kind === 'sell_line') site.lines = without(site.lines, order.lineId);
      else company.sites = without(company.sites, order.siteId);
      ledger.disposals += proceeds;
      ledger.writeOffs += book - proceeds;
      log('asset_sold', { order: order.kind, siteId: order.siteId, proceeds, bookValue: book });
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
