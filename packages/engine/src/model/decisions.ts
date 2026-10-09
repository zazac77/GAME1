import type { Id, Money } from './ids';
import type { RndType } from './company';

export type CapexOrder =
  | { kind: 'build_site'; regionId: Id }
  /** Agri: buys a farm (limited farmland per region). */
  | { kind: 'buy_farm'; regionId: Id }
  | { kind: 'add_line'; siteId: Id }
  | { kind: 'modernize_line'; siteId: Id; lineId: Id }
  | { kind: 'sell_line'; siteId: Id; lineId: Id }
  | { kind: 'sell_site'; siteId: Id };

/** How the cash part of an acquisition is financed, and the share of it paid in shares. */
export interface DealFinancing {
  /**
   * Share of the price paid in new shares of the buyer (exchange of shares,
   * listed buyers only), valued at the buyer's price at the start of the quarter.
   */
  stockShare?: number;
  /** Acquisition loan drawn to pay the cash part (bounded by the target's EBITDA). */
  debt?: Money;
}

/**
 * Takeovers (phase 2). Settled at the end of the quarter (step 12), on the
 * cash then available; a due diligence is paid at the start of the quarter
 * and its results are known from the next one.
 */
export type MnaAction =
  | { kind: 'due_diligence'; targetId: Id }
  /**
   * Friendly tender offer on a listed company, for every share the buyer's
   * group does not hold: needs the support of the target's board, succeeds
   * only if the group ends with control.
   */
  | ({ kind: 'tender_offer'; targetId: Id; pricePerShare: Money } & DealFinancing)
  /**
   * Over-the-counter purchase: the block of the target's controlling
   * shareholder at pricePerShare, or 100 % of a listing (targetId = listing
   * id) at its asking price.
   */
  | ({ kind: 'private_purchase'; targetId: Id; pricePerShare?: Money } & DealFinancing);

/** Phase 3. */
export interface IntraGroupTransfer {
  kind: 'dividend' | 'loan' | 'cash_pool';
  fromId: Id;
  toId: Id;
  amount: Money;
}

export interface HrDecision {
  regionId: Id;
  occupationId: Id;
  hire: number;
  fire: number;
  wageOffer: Money;
  train?: { toOccupationId: Id; count: number };
}

/** Identical for the player and the AI. */
export interface CompanyDecisions {
  companyId: Id;
  /** By product line. */
  pricing: Record<Id, { price: Money; qualityTarget?: number }>;
  /** By site; a missing site produces at full capacity. */
  production: Record<Id, { targetOutput: number }>;
  hr: HrDecision[];
  purchasing: {
    spot: { commodityId: Id; qty: number; limitPrice?: Money }[];
    newContracts: { commodityId: Id; qtyPerQuarter: number; quarters: number }[];
  };
  capex: CapexOrder[];
  /** Marketing budget by product line. */
  marketing: Record<Id, Money>;
  /** Retail listing fees by product line (sectors with listing). */
  listing: Record<Id, Money>;
  /**
   * Budget of the quarter by R&D project. Without projectId, funds the
   * project of that type in progress, or starts one. Tech: the project is
   * staffed with `developers` (their wages are its cost) and the budget is 0.
   */
  rnd: { projectId?: Id; type: RndType; budget: Money; developers?: number }[];
  finance: {
    borrow?: Money;
    repay?: Money;
    /** Total dividend paid to the shareholders at the start of the quarter. */
    dividend?: Money;
    /** New shares sold to the public (capital increase) at a discount to the price. */
    issueShares?: number;
    /** Own shares bought back from the public and cancelled. */
    buyback?: number;
    /** Initial public offering of an unlisted company (new shares sold to the public). */
    ipo?: boolean;
  };
  stockOrders: { targetId: Id; side: 'buy' | 'sell'; shares: number; limitPrice?: Money }[];
  mna: MnaAction[];
  intraGroup?: IntraGroupTransfer[];
}

export type ValidationIssueCode =
  | 'not_controlled' // the actor does not control this company
  | 'inactive_company' // bankrupt or absorbed: decisions ignored
  | 'unknown_id' // site, line, pool, commodity… that does not exist or belongs to someone else
  | 'invalid_value' // NaN, negative or non-integer where it matters: dropped or fixed
  | 'clamped' // value brought back within its bounds
  | 'duplicate' // second entry for the same key: ignored
  | 'budget' // discretionary spending scaled down (or an investment dropped) for lack of liquidity
  | 'limit' // a capacity, technology or holding limit is reached: the order is dropped
  | 'invalid_state' // the asset is not in a state that allows the order (e.g. under construction)
  | 'not_available'; // feature arriving in a later lot

/** Why a decision was changed by validation. Rendered in French by the UI. */
export interface ValidationIssue {
  companyId: Id;
  /** Path in CompanyDecisions, e.g. "hr[0].fire". */
  path: string;
  code: ValidationIssueCode;
  /** Value as submitted and as kept, when relevant. */
  submitted?: number;
  applied?: number;
}
