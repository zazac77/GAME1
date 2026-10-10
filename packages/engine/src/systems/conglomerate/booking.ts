import type { Company } from '../../model/company';
import type { Statements } from '../../model/finance';
import type { Money, Quarter } from '../../model/ids';

/** Changes to the statements of a quarter already closed (step 12). */
export interface Entry {
  cash?: Money;
  groupLoans?: Money;
  debt?: Money;
  /** Result booked in the financial result (and net income, equity). */
  financial?: Money;
  /** Part of it on companies of the group. */
  groupFinancial?: Money;
  /** Equity moved outside the result (dividends paid). */
  equity?: Money;
  investing?: Money;
  groupInvesting?: Money;
  financing?: Money;
}

/** Statements of the quarter if the company closed it this turn (operating, or bankrupt just now). */
export const closedStatements = (company: Company, turn: Quarter): Statements | undefined =>
  company.books.current.quarter === turn ? company.books.current : undefined;

/**
 * Books an entry into the statements the company closed this turn (cash flows
 * add to netChange; the result to financial, net income and equity), and
 * keeps the last history entry in step. Returns false if it did not close.
 */
export function book(company: Company, turn: Quarter, e: Entry): boolean {
  const s = closedStatements(company, turn);
  if (!s) return false;
  const b = s.balance;
  const result = e.financial ?? 0;
  b.cash += e.cash ?? 0;
  b.groupLoans += e.groupLoans ?? 0;
  b.debt += e.debt ?? 0;
  b.equity += result + (e.equity ?? 0);
  s.pnl.financial += result;
  s.pnl.groupFinancial += e.groupFinancial ?? 0;
  s.pnl.netIncome += result;
  s.cashFlow.investing += e.investing ?? 0;
  s.cashFlow.groupInvesting += e.groupInvesting ?? 0;
  s.cashFlow.financing += e.financing ?? 0;
  s.cashFlow.netChange += (e.investing ?? 0) + (e.financing ?? 0);
  const history = company.books.history;
  if (history.at(-1)?.quarter === turn) history[history.length - 1] = s;
  return true;
}
