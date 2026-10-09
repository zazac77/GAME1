import { isOperating } from '../../core/companies';
import { controllingActor, groupHolding } from '../../core/control';
import type { Company } from '../../model/company';
import type { Money } from '../../model/ids';
import type { GameState } from '../../model/state';
import { fundamentalValue } from '../stockmarket/fundamental';

/** Price of the new shares of a capital increase this quarter. */
export const issuePrice = (state: GameState, company: Company): Money =>
  (state.stock.quotes[company.id]?.referencePrice ?? 0) *
  (1 - state.config.stockMarket.capital.issueDiscount);

/** Price paid per share bought back this quarter. */
export const buybackPrice = (state: GameState, company: Company): Money =>
  (state.stock.quotes[company.id]?.referencePrice ?? 0) *
  (1 + state.config.stockMarket.capital.buybackPremium);

/**
 * Most new shares the company can issue without the actor controlling it
 * (with its group) falling to the control threshold (no limit if nobody
 * controls it).
 */
export function maxSharesKeepingControl(state: GameState, company: Company): number {
  const actorId = controllingActor(state, company.id);
  if (!actorId) return Number.MAX_SAFE_INTEGER;
  const held = groupHolding(state, actorId, company.id);
  const N = company.sharesOutstanding;
  return Math.max(0, Math.ceil(held / state.config.mna.controlThreshold - N) - 1);
}

/**
 * Most new shares the company can issue to the public this quarter:
 * maxIssueShare of its capital, and never so many that the actor
 * controlling it (with its group) falls to the control threshold.
 */
export function maxNewShares(state: GameState, company: Company): number {
  const max = Math.floor(
    state.config.stockMarket.capital.maxIssueShare * company.sharesOutstanding,
  );
  return Math.max(0, Math.min(max, maxSharesKeepingControl(state, company)));
}

/** Most own shares a listed company can buy back this quarter (from the float). */
export function maxBuyback(state: GameState, company: Company): number {
  const SM = state.config.stockMarket;
  const float = state.stock.registry[company.id]?.public ?? 0;
  return Math.max(
    0,
    Math.min(
      Math.floor(SM.capital.maxBuybackShare * company.sharesOutstanding),
      Math.floor(SM.maxFloatPerQuarter * float),
      float,
    ),
  );
}

/** Most the company can pay out this quarter: its cash, within its equity. */
export function maxDividend(company: Company): Money {
  const { cash, equity } = company.books.current.balance;
  return Math.max(0, Math.min(cash, equity));
}

/**
 * Terms of a public offering of an unlisted company: new shares sold to the
 * public so that it holds ipo.floatShare of the capital, at the fundamental
 * value of its own accounts (no publication yet) × (1 − discount).
 * Undefined if the company cannot go public this quarter.
 */
export function ipoTerms(
  state: GameState,
  company: Company,
): { pricePerShare: Money; newShares: number; proceeds: Money } | undefined {
  const I = state.config.stockMarket.ipo;
  if (company.listed || !isOperating(company)) return undefined;
  if (company.books.history.length < I.minQuarters) return undefined;
  const value = fundamentalValue(state, company, company.books.history);
  if (value === undefined) return undefined;
  const pricePerShare = value * (1 - I.discount);
  const newShares = Math.round((company.sharesOutstanding * I.floatShare) / (1 - I.floatShare));
  return { pricePerShare, newShares, proceeds: newShares * pricePerShare * (1 - I.feeShare) };
}
