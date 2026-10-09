import type { CreditRating, Id, Money, Quarter } from './ids';

export interface IncomeStatement {
  revenue: Money;
  cogs: Money;
  wages: Money;
  marketing: Money;
  rnd: Money;
  storage: Money;
  other: Money;
  ebitda: Money;
  depreciation: Money;
  ebit: Money;
  interest: Money;
  /** Fair value changes of financial assets (unrealized and realized, untaxed). */
  financial: Money;
  tax: Money;
  netIncome: Money;
}

export interface CashFlowStatement {
  operating: Money;
  investing: Money;
  financing: Money;
  netChange: Money;
}

/** Simplified balance sheet. Invariant: assets = liabilities + equity. */
export interface BalanceSheet {
  cash: Money;
  inventory: Money;
  fixedAssets: Money;
  financialAssets: Money;
  debt: Money;
  equity: Money;
  minorityInterests: Money;
}

export interface Statements {
  quarter: Quarter;
  pnl: IncomeStatement;
  cashFlow: CashFlowStatement;
  balance: BalanceSheet;
}

export interface Books {
  /** Statements of the last resolved quarter (opening balance at game start). */
  current: Statements;
  /** One entry per resolved quarter, oldest first. */
  history: Statements[];
  /** Tax losses carried forward. */
  taxLossCarryforward: Money;
}

export interface Loan {
  id: Id;
  kind: 'term' | 'overdraft';
  principal: Money;
  /** Annual spread over the policy rate, fixed at signature. */
  spread: number;
  /** Repaid in equal installments until this quarter (exclusive). */
  maturity: Quarter;
}

export interface CreditStatus {
  rating: CreditRating;
  covenantBreached: boolean;
  /** Consecutive quarters with negative equity and overdraft. */
  distressQuarters: number;
}
