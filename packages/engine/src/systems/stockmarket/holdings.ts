import { isOperating } from '../../core/companies';
import { sameGroup } from '../../core/control';
import { holdingDiscount } from '../../core/synergies';
import type { Company } from '../../model/company';
import type { Statements } from '../../model/finance';
import type { Id, Money } from '../../model/ids';
import type { GameState } from '../../model/state';
import { fundamentalValue } from './fundamental';

/** Holdings of holdings are valued through at most this many levels. */
const MAX_DEPTH = 4;

/**
 * Fundamental value per share (stockmarket/fundamental.ts); the stakes of a
 * holding company count at their current value (sum of the parts) instead
 * of their carrying value, less the conglomerate discount of its group.
 */
export function fundamentalOf(
  state: GameState,
  company: Company,
  published: readonly Statements[],
  depth = 0,
): number | undefined {
  if (company.sector !== 'holding' || depth >= MAX_DEPTH) {
    return fundamentalValue(state, company, published);
  }
  let stakes = 0;
  for (const targetId of Object.keys(state.stock.registry).sort()) {
    const shares = state.stock.registry[targetId]?.[company.id] ?? 0;
    const target = state.companies[targetId];
    if (shares > 0 && target) stakes += shares * shareValue(state, target, depth + 1);
  }
  // Conglomerate discount on a diversified group (lot 3.2).
  return fundamentalValue(
    state,
    company,
    published,
    stakes * (1 - holdingDiscount(state, company)),
  );
}

/**
 * Value of one share for its holders: the quote of a listed company (or of a
 * delisted bankrupt one), else the fundamental value of its own accounts
 * (no publication lag: its owners see them), at least the floor price.
 */
export function shareValue(state: GameState, company: Company, depth = 0): Money {
  const SM = state.config.stockMarket;
  const quote = state.stock.quotes[company.id];
  if (quote && (company.listed || !isOperating(company))) return quote.price;
  if (!isOperating(company)) return SM.minPrice;
  const value = fundamentalOf(state, company, company.books.history, depth);
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

/** Value paid for the shares of a target bought during a step, and received for those sold. */
export interface StakeTrades {
  bought: Money;
  sold: Money;
}

/**
 * Books the holdings of a company at the end of a step: their new carrying
 * values (holdings with `update`, kept in company.stakeValues) against the
 * values last booked and the stakes traded during the step (by target).
 * Returns the new total carrying value and the result, with the part of it
 * on the companies of its group (a holding that is, or was, in its
 * participations), eliminated on consolidation.
 */
export function revalueHoldings(
  state: GameState,
  company: Company,
  trades: Readonly<Record<Id, StakeTrades>> = {},
): { carrying: Money; result: Money; groupResult: Money } {
  const wasInGroup = new Set(Object.keys(company.participations));
  const now = holdings(state, company, true);
  const before = company.stakeValues;
  const values: Record<Id, Money> = {};
  let carrying = 0;
  let result = 0;
  let groupResult = 0;
  const targets = new Set([...Object.keys(before), ...Object.keys(now), ...Object.keys(trades)]);
  for (const targetId of [...targets].sort()) {
    const value = now[targetId]?.carrying ?? 0;
    const t = trades[targetId] ?? { bought: 0, sold: 0 };
    const r = value - (before[targetId] ?? 0) - t.bought + t.sold;
    if (value !== 0) values[targetId] = value;
    carrying += value;
    result += r;
    if (wasInGroup.has(targetId) || now[targetId]?.inGroup) groupResult += r;
  }
  company.stakeValues = values;
  return { carrying, result, groupResult };
}

/** Book value of all the holdings of a company. */
export const holdingsCarrying = (state: GameState, company: Company): Money =>
  Object.values(holdings(state, company)).reduce((s, h) => s + h.carrying, 0);
