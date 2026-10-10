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
  /**
   * Financial result (untaxed): dividends received, fair value changes of
   * minority stakes (unrealized and realized), impairment of controlled ones.
   */
  financial: Money;
  /**
   * Part of `financial` that comes from companies of the same group
   * (dividends, impairments and results on their shares, write-off of loans
   * to them): eliminated in the consolidated accounts.
   */
  groupFinancial: Money;
  tax: Money;
  netIncome: Money;
}

/**
 * Cash flows of the quarter. Financing includes the equity transactions
 * (share issues, dividends paid, buybacks); investing includes the stock
 * trades, acquisitions and dividends received.
 */
export interface CashFlowStatement {
  operating: Money;
  investing: Money;
  financing: Money;
  netChange: Money;
  /**
   * Part of `investing` exchanged with companies of the same group
   * (dividends received from them, intra-group loans granted or repaid):
   * their counterpart is in the other company's financing.
   */
  groupInvesting: Money;
}

/** Simplified balance sheet. Invariant: assets = liabilities + equity. */
export interface BalanceSheet {
  cash: Money;
  inventory: Money;
  fixedAssets: Money;
  /** Minority stakes at fair value, controlled stakes at cost (less impairment). */
  financialAssets: Money;
  /** Intra-group loans granted (and cash pool positions lent), outstanding. */
  groupLoans: Money;
  /** Bank loans, overdraft and intra-group borrowings. */
  debt: Money;
  equity: Money;
  minorityInterests: Money;
}

export interface Statements {
  quarter: Quarter;
  /** Shares outstanding at the close of the quarter. */
  shares: number;
  pnl: IncomeStatement;
  cashFlow: CashFlowStatement;
  balance: BalanceSheet;
}

/** What one company of a group brings to the consolidated accounts of a quarter. */
export interface MemberContribution {
  /**
   * Share of the company the head's shareholders own through the group
   * (product of the stakes along every chain of control, summed).
   */
  share: number;
  revenue: Money;
  ebitda: Money;
  /** Net income without its intra-group financial result (minorities included). */
  netIncome: Money;
}

/**
 * Consolidated accounts of a group (full consolidation of every operating
 * company the head controls). balance.equity is the group share,
 * balance.minorityInterests the outside shareholders' share of the
 * subsidiaries; pnl.netIncome includes the minorities' share
 * (minorityNetIncome). Invariant: assets = debt + equity + minorities.
 */
export interface ConsolidatedStatements extends Statements {
  /** Companies consolidated, head first. */
  members: Record<Id, MemberContribution>;
  /** Net income attributable to the minority shareholders of the subsidiaries. */
  minorityNetIncome: Money;
  /** Intra-group amounts removed from the sum of the members' accounts. */
  eliminations: {
    /** Loans between members (removed from groupLoans and debt). */
    loans: Money;
    /** Stakes held by members in members (removed from financialAssets and equity). */
    stakes: Money;
    /** Intra-group financial result (removed from financial and netIncome). */
    financial: Money;
    /** Intra-group cash flows (moved from investing to financing). */
    flows: Money;
  };
}

export interface Books {
  /** Statements of the last resolved quarter (opening balance at game start). */
  current: Statements;
  /** One entry per resolved quarter, oldest first. */
  history: Statements[];
  /** Tax losses carried forward. */
  taxLossCarryforward: Money;
  /** Group heads: consolidated accounts of the last quarters, oldest first. */
  consolidated?: ConsolidatedStatements[];
}

export interface Loan {
  id: Id;
  /** 'group': lent by another company of the group (no installments, repaid by transfers). */
  kind: 'term' | 'overdraft' | 'group';
  principal: Money;
  /** Annual spread over the policy rate, fixed at signature. */
  spread: number;
  /** Repaid in equal installments until this quarter (exclusive); group loans: when granted. */
  maturity: Quarter;
  /** Group loans: the lending company. */
  lenderId?: Id;
}

export interface CreditStatus {
  rating: CreditRating;
  covenantBreached: boolean;
  /** Consecutive quarters with negative equity and overdraft. */
  distressQuarters: number;
}
