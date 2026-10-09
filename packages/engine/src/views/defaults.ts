import { isOperating } from '../core/companies';
import { emptyDecisions } from '../core/decisions';
import { sum } from '../core/math';
import type { CompanyDecisions } from '../model/decisions';
import type { Id } from '../model/ids';
import type { GameState } from '../model/state';
import { sectorModule } from '../sectors';
import { mainProductLine } from '../sectors/industry';

/**
 * "Same as last quarter": prices, quality aimed at, wages, production
 * targets, marketing and R&D budgets carry over (an R&D budget whose project
 * completed starts the next project of its type); one-shot parts (investments, new
 * contracts, loans, repayments, stock orders, hires, dismissals, trainings)
 * do not. Spot purchases are recomputed to cover the planned output with the
 * stock and contracts at hand (a copied quantity would not match the stock).
 * Before the first quarter: current prices and wages.
 */
export function defaultDecisions(state: GameState, companyId: Id): CompanyDecisions {
  const company = state.companies[companyId];
  if (!company) throw new Error(`Unknown company ${companyId}`);
  if (!isOperating(company)) return emptyDecisions(companyId);

  const d = emptyDecisions(companyId);
  const last = company.lastDecisions;
  const line = mainProductLine(state, company);
  if (last) {
    d.pricing = structuredClone(last.pricing);
    d.production = structuredClone(last.production);
    d.marketing = structuredClone(last.marketing);
    d.rnd = last.rnd.map((r) => ({ type: r.type, budget: r.budget }));
    d.hr = last.hr.map((h) => ({
      regionId: h.regionId,
      occupationId: h.occupationId,
      hire: 0,
      fire: 0,
      wageOffer: h.wageOffer,
    }));
  } else {
    for (const staff of Object.values(company.workforce)) {
      d.hr.push({
        regionId: staff.regionId,
        occupationId: staff.occupationId,
        hire: 0,
        fire: 0,
        wageOffer: staff.wage,
      });
    }
    if (line) d.pricing[line.id] = { price: line.price, qualityTarget: line.qualityTarget };
  }

  const module = sectorModule(company.sector);
  if (!module || !line) return d;
  const output = module.plannedOutput(state, company, d);
  const perUnit = module.materialsPerUnit(state, company, line);
  const turn = state.meta.turn;
  for (const commodityId of Object.keys(perUnit).sort()) {
    if (!state.config.commodities.markets[commodityId]?.storable) continue;
    const contracted = sum(
      company.contracts
        .filter((k) => k.commodityId === commodityId && k.startsAt <= turn && turn < k.endsAt)
        .map((k) => k.qtyPerQuarter),
    );
    const stock = company.inventory[commodityId]?.qty ?? 0;
    const need = output * (perUnit[commodityId] ?? 0) - stock - contracted;
    if (need > 0) d.purchasing.spot.push({ commodityId, qty: need });
  }
  return d;
}
