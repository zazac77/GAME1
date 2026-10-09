import { isOperating, operationalSites } from '../core/companies';
import { sum } from '../core/math';
import type { Id } from '../model/ids';
import type { GameState } from '../model/state';
import type { Alert } from '../model/views';
import { sectorModule } from '../sectors';
import { plantConfig, sectorProductLine, techConfigOf } from '../sectors/config';
import { mainProductLine, siteCapacity } from '../sectors/plant';
import { maintenanceCoverage, techTeam } from '../sectors/tech/team';
import { leverage, trailingAnnual } from '../systems/finance/credit';

/**
 * Alerts on a company at the start of the quarter, so that the player does
 * not have to scan tables: material cover, lost sales, wages under the
 * market, covenant, overdraft, distress, saturated capacity; in tech, a
 * product lagging the frontier and too few developers kept on maintenance.
 */
export function companyAlerts(state: GameState, companyId: Id): Alert[] {
  const company = state.companies[companyId];
  if (!company || !isOperating(company)) return [];
  const { config } = state;
  const A = config.views.alerts;
  const alerts: Alert[] = [];
  const add = (kind: Alert['kind'], severity: Alert['severity'], data?: Alert['data']) => {
    const alert: Alert = { kind, severity, companyId };
    if (data) alert.data = data;
    alerts.push(alert);
  };
  const turn = state.meta.turn;
  const module = sectorModule(company.sector);
  const line = mainProductLine(state, company);

  if (module && line) {
    const needs = module.plannedInputs(state, company, undefined);
    for (const commodityId of Object.keys(needs).sort()) {
      if (!config.commodities.markets[commodityId]?.storable) continue;
      const quarterNeed = needs[commodityId] ?? 0;
      if (quarterNeed <= 0) continue;
      const contracted = sum(
        company.contracts
          .filter((k) => k.commodityId === commodityId && k.startsAt <= turn && turn < k.endsAt)
          .map((k) => k.qtyPerQuarter),
      );
      const cover = ((company.inventory[commodityId]?.qty ?? 0) + contracted) / quarterNeed;
      if (cover < A.materialCoverQuarters) {
        add('material_low', 'warning', { commodityId, coverQuarters: cover });
      }
    }

    const result = state.productMarkets[line.marketId]?.lastResult;
    const allocated = result?.allocated[line.id] ?? 0;
    const sold = (result?.shares[line.id] ?? 0) * (result?.volume ?? 0);
    if (allocated - sold > 0.5) add('stockout', 'warning', { lostUnits: allocated - sold });
    const capacity = sum(
      operationalSites(company).map((s) => siteCapacity(plantConfig(config, company.sector), s)),
    );
    if (capacity > 0 && sold >= A.capacityUtilization * capacity) {
      add('capacity_saturated', 'info', { utilization: sold / capacity });
    }
  }

  const tech = techConfigOf(config, company.sector);
  const product = sectorProductLine(config, company);
  if (tech && product) {
    const frontier = state.productMarkets[product.marketId]?.techFrontier ?? 0;
    const gap = frontier - (product.techLevel ?? 0);
    if (gap > A.techGap) add('tech_behind', 'warning', { gap });
    // Developers on R&D last quarter are assumed to stay on it.
    const rnd = sum((company.lastDecisions?.rnd ?? []).map((r) => r.developers ?? 0));
    const coverage = maintenanceCoverage(
      tech,
      techTeam(config, tech, company, rnd),
      product.users ?? 0,
    );
    if (coverage < A.maintenanceCoverage) add('maintenance_short', 'warning', { coverage });
  }

  for (const key of Object.keys(company.workforce).sort()) {
    const staff = company.workforce[key as keyof typeof company.workforce];
    const pool = state.labor[key as keyof typeof state.labor];
    if (!staff || !pool || staff.headcount <= 0) continue;
    if (staff.wage < pool.marketWage * (1 - A.wageGapShare)) {
      add('wage_below_market', 'warning', {
        regionId: staff.regionId,
        occupationId: staff.occupationId,
        gap: 1 - staff.wage / pool.marketWage,
      });
    }
  }

  const { balance } = company.books.current;
  const ratio = leverage(balance.debt - balance.cash, trailingAnnual(company).ebitda);
  const covenant = config.finance.covenant.maxNetDebtToEbitda;
  if (company.credit.covenantBreached) add('covenant_breached', 'critical');
  else if (company.books.history.length > 0 && ratio > A.covenantNearShare * covenant) {
    add('covenant_near', 'warning', { leverage: Number.isFinite(ratio) ? ratio : covenant * 10 });
  }
  const overdraft = company.loans.find((l) => l.kind === 'overdraft');
  if (overdraft) add('overdraft', 'warning', { amount: overdraft.principal });
  if (company.status === 'distressed') {
    add('distress', 'critical', {
      quartersLeft: config.finance.distressQuarters - company.credit.distressQuarters,
    });
  }
  return alerts;
}
