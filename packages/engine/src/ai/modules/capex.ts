import { sum } from '../../core/math';
import { plantConfig } from '../../sectors/config';
import { addLineCost, buildSiteCost, modernizeLineCost } from '../../sectors/plant/capex';
import type { Plan } from './plan';

/** Net debt / trailing annual EBITDA from the own books (Infinity if not covered). */
export function ownLeverage(plan: Plan): number {
  const { books } = plan.company;
  const last = books.history.slice(-4);
  const ebitda = last.length > 0 ? (sum(last.map((s) => s.pnl.ebitda)) * 4) / last.length : 0;
  const netDebt = books.current.balance.debt - books.current.balance.cash;
  if (netDebt <= 0) return 0;
  return ebitda > 0 ? netDebt / ebitda : Infinity;
}

/**
 * 6. Capex: adds a line (or builds a factory in the HQ region when every
 * factory is full) when the smoothed demand exceeds expandUtilization of the
 * capacity and cash plus borrowing capacity cover the cost and a buffer;
 * sells the oldest line after shrinkQuarters of low utilization; modernizes
 * an old line when cash alone allows it twice over.
 */
export function capex(plan: Plan): void {
  const { obs, config, profile, company, memory } = plan;
  const cfg = plantConfig(config, company.sector);
  const A = config.ai.capex;
  const { priceLevel } = obs.macro;
  const lines = Object.values(company.sites).flatMap((s) =>
    Object.values(s.lines).map((l) => ({ site: s, line: l })),
  );
  const pending =
    lines.some((x) => x.line.status !== 'operational') ||
    Object.values(company.sites).some((s) => s.status !== 'operational');
  const capacity =
    obs.self.sites.reduce((s, x) => s + x.capacity, 0) +
    lines.filter((x) => x.line.status === 'under_construction').length * cfg.line.capacity;
  const utilization = capacity > 0 ? memory.demandForecast / capacity : Infinity;
  memory.lowUtilizationQuarters =
    utilization < A.shrinkUtilization ? memory.lowUtilizationQuarters + 1 : 0;

  const cash = company.books.current.balance.cash;
  const buffer = A.cashAfterQuarters * (1 + profile.riskAversion) * plan.quarterlyCashCosts;
  const affordable = (cost: number) => cash + obs.self.borrowingCapacity - cost >= buffer;
  const order = (o: Plan['decisions']['capex'][number], cost: number) => {
    plan.decisions.capex.push(o);
    plan.spend.capex += cost;
  };

  if (!pending && utilization > A.expandUtilization && ownLeverage(plan) <= A.maxLeverage) {
    const factories = Object.values(company.sites).filter((s) => s.kind === 'factory');
    const site = factories
      .filter(
        (s) => s.status === 'operational' && Object.keys(s.lines).length < cfg.factory.maxLines,
      )
      .sort(
        (a, b) =>
          Object.keys(a.lines).length - Object.keys(b.lines).length || a.id.localeCompare(b.id),
      )[0];
    if (site) {
      const cost = addLineCost(cfg, priceLevel);
      if (affordable(cost)) return order({ kind: 'add_line', siteId: site.id }, cost);
    } else if (factories.length < cfg.factory.maxSites) {
      const land = obs.regions[company.hqRegionId]?.landCostIndex ?? 1;
      const cost = buildSiteCost(cfg, land, priceLevel);
      if (affordable(cost))
        return order({ kind: 'build_site', regionId: company.hqRegionId }, cost);
    }
    return;
  }

  const working = lines
    .filter((x) => x.site.status === 'operational' && x.line.status === 'operational')
    .sort((a, b) => b.line.age - a.line.age || a.line.id.localeCompare(b.line.id));
  if (memory.lowUtilizationQuarters >= A.shrinkQuarters && working.length > 1 && working[0]) {
    memory.lowUtilizationQuarters = 0;
    return order({ kind: 'sell_line', siteId: working[0].site.id, lineId: working[0].line.id }, 0);
  }

  const old = working.find(
    (x) => x.line.age >= A.modernizeMinAge && x.line.techLevel < cfg.line.maxTechLevel,
  );
  const cost = modernizeLineCost(cfg, priceLevel);
  if (!pending && old && cash - 2 * cost >= buffer) {
    order({ kind: 'modernize_line', siteId: old.site.id, lineId: old.line.id }, cost);
  }
}
