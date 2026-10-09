import { isOperating } from '../../core/companies';
import { sameGroup } from '../../core/control';
import type { Company } from '../../model/company';
import type { Id, Money } from '../../model/ids';
import type { GameState } from '../../model/state';
import { fundamentalValue } from './fundamental';

/**
 * Value of one share for its holders: the quote of a listed company (or of a
 * delisted bankrupt one), else the fundamental value of its own accounts
 * (no publication lag: its owners see them), at least the floor price.
 */
export function shareValue(state: GameState, company: Company): Money {
  const SM = state.config.stockMarket;
  const quote = state.stock.quotes[company.id];
  if (quote && (company.listed || !isOperating(company))) return quote.price;
  if (!isOperating(company)) return SM.minPrice;
  const value = fundamentalValue(state, company, company.books.history);
  if (value !== undefined) return value;
  const book = company.books.current.balance.equity / Math.max(1, company.sharesOutstanding);
  return Math.max(SM.minPrice, book);
}

export interface HoldingValue {
  shares: number;
  /** Market (or private) value of the shares. */
  fairValue: Money;
  /** In the books: fair value for a minority stake, cost (impaired) inside the group. */
  carrying: Money;
  inGroup: boolean;
}

/**
 * The holdings of a company in the others. A stake in a company of its own
 * group is carried at cost, impaired to its recoverable value (fair value ×
 * (1 + the control premium) — what a buyer of control would pay), the
 * impairment reversing up to cost. A stake entering the group starts at its
 * fair value; shares sold leave with their share of the cost, shares bought
 * add what they are worth. Other stakes are at fair value. With `update`,
 * the cost basis (company.participations) follows the registry.
 */
export function holdings(
  state: GameState,
  company: Company,
  update = false,
): Record<Id, HoldingValue> {
  const premium = state.config.mna.valuation.controlPremium;
  const out: Record<Id, HoldingValue> = {};
  const participations = update ? company.participations : structuredClone(company.participations);
  for (const targetId of Object.keys(state.stock.registry).sort()) {
    const shares = state.stock.registry[targetId]?.[company.id] ?? 0;
    const target = state.companies[targetId];
    if (shares <= 0 || !target) continue;
    const fairValue = shares * shareValue(state, target);
    const inGroup = sameGroup(state, company.id, targetId);
    let carrying = fairValue;
    if (inGroup) {
      const p = (participations[targetId] ??= { shares, cost: fairValue });
      if (shares < p.shares) p.cost *= shares / p.shares;
      else if (shares > p.shares) p.cost += (fairValue * (shares - p.shares)) / shares;
      p.shares = shares;
      // A company bought before its first closed quarter is carried at cost until then.
      carrying =
        target.books.history.length === 0 ? p.cost : Math.min(p.cost, fairValue * (1 + premium));
    }
    out[targetId] = { shares, fairValue, carrying, inGroup };
  }
  if (update) {
    company.participations = Object.fromEntries(
      Object.entries(participations).filter(([targetId]) => out[targetId]?.inGroup),
    );
  }
  return out;
}

/** Book value of all the holdings of a company. */
export const holdingsCarrying = (state: GameState, company: Company): Money =>
  Object.values(holdings(state, company)).reduce((s, h) => s + h.carrying, 0);
