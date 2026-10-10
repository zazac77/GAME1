import type { GameConfig } from '../../config/schema';
import { groupDebt } from '../../core/group';
import { sum } from '../../core/math';
import type { Company } from '../../model/company';
import type { CreditRating } from '../../model/ids';

/** Annualized EBITDA and interest over the last (up to) four resolved quarters. */
export function trailingAnnual(company: Company): { ebitda: number; interest: number } {
  const last = company.books.history.slice(-4);
  if (last.length === 0) return { ebitda: 0, interest: 0 };
  const scale = 4 / last.length;
  return {
    ebitda: sum(last.map((s) => s.pnl.ebitda)) * scale,
    interest: sum(last.map((s) => s.pnl.interest)) * scale,
  };
}

/** Net debt / annual EBITDA; Infinity when debt is not covered by a positive EBITDA. */
export function leverage(netDebt: number, ebitda: number): number {
  if (netDebt <= 0) return 0;
  return ebitda > 0 ? netDebt / ebitda : Infinity;
}

/** First rating (best to worst) whose thresholds are met; the last one catches all. */
export function rate(
  config: GameConfig,
  netDebt: number,
  ebitda: number,
  interest: number,
): { rating: CreditRating; covenantBreached: boolean } {
  const ratio = leverage(netDebt, ebitda);
  const coverage = interest > 0 ? ebitda / interest : Infinity;
  const ratings = config.finance.ratings;
  const found = ratings.find(
    (r) => ratio <= r.maxNetDebtToEbitda && coverage >= r.minInterestCoverage,
  );
  const rating = (found ?? ratings[ratings.length - 1])?.rating ?? config.finance.initialRating;
  return { rating, covenantBreached: ratio > config.finance.covenant.maxNetDebtToEbitda };
}

/** Annual spread of a new term loan for the company's current rating. */
export function currentSpread(config: GameConfig, company: Company): number {
  const r = config.finance.ratings.find((x) => x.rating === company.credit.rating);
  const base = r?.spread ?? config.finance.ratings[config.finance.ratings.length - 1]?.spread ?? 0;
  return base + (company.credit.covenantBreached ? config.finance.covenant.spreadPenalty : 0);
}

/**
 * New term debt the bank grants at the start of the quarter: headroom under
 * the covenant, or a loan-to-value on fixed assets, whichever is larger
 * (intra-group debt is not counted). Nothing while the covenant is breached.
 */
export function borrowingCapacity(config: GameConfig, company: Company): number {
  if (company.credit.covenantBreached) return 0;
  const { balance } = company.books.current;
  const termDebt = sum(company.loans.filter((l) => l.kind === 'term').map((l) => l.principal));
  const netDebt = balance.debt - groupDebt(company) - balance.cash;
  const { ebitda } = trailingAnnual(company);
  const covenantHeadroom =
    config.finance.covenant.maxNetDebtToEbitda * Math.max(0, ebitda) - netDebt;
  const collateral = config.finance.collateralLoanToValue * balance.fixedAssets - termDebt;
  return Math.max(0, covenantHeadroom, collateral);
}
