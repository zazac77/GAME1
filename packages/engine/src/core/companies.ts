import type { Company, Site, Staff } from '../model/company';
import type { Id } from '../model/ids';
import type { GameState } from '../model/state';
import { sum } from './math';

/** Companies that still operate (active or distressed), in id order. */
export function operatingCompanies(state: GameState): Company[] {
  return Object.keys(state.companies)
    .sort()
    .map((id) => state.companies[id] as Company)
    .filter((c) => c.status === 'active' || c.status === 'distressed');
}

export const isOperating = (company: Company): boolean =>
  company.status === 'active' || company.status === 'distressed';

export const operationalSites = (company: Company): Site[] =>
  Object.values(company.sites).filter((s) => s.status === 'operational');

/** Staff in training (counted in headcount, not producing). */
export const trainees = (staff: Staff): number => sum(staff.inTraining.map((b) => b.count));

/** Companies the actor runs. MVP: its root company (control chains arrive in phase 2). */
export function controlledCompanyIds(state: GameState, actorId: Id): Set<Id> {
  const actor = state.actors[actorId];
  const out = new Set<Id>();
  if (actor && state.companies[actor.rootCompanyId]) out.add(actor.rootCompanyId);
  return out;
}

/** Reference price of a product market, indexed on the price level. */
export function indexedRefPrice(state: GameState, marketId: Id): number {
  const market = state.productMarkets[marketId];
  return (market?.refPrice ?? 0) * state.macro.priceLevel;
}

/** Book value of the company's inventories. */
export const inventoryValue = (company: Company): number =>
  sum(Object.values(company.inventory).map((l) => l.qty * l.avgCost));

/** Net book value of sites and lines. */
export const fixedAssetValue = (company: Company): number =>
  sum(
    Object.values(company.sites).map(
      (s) => s.buildingBookValue + sum(Object.values(s.lines).map((l) => l.bookValue)),
    ),
  );

export const totalDebt = (company: Company): number => sum(company.loans.map((l) => l.principal));

/** Rounds x up or down at random, with E[result] = x. */
export const stochasticRound = (x: number, u: number): number => Math.floor(x + u);
