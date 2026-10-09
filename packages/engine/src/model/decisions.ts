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

/** Phase 2+. */
export interface MnaAction {
  kind: 'tender_offer' | 'private_purchase' | 'divest';
  targetId: Id;
  pricePerShare?: Money;
  shares?: number;
}

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
   * project of that type in progress, or starts one.
   */
  rnd: { projectId?: Id; type: RndType; budget: Money }[];
  finance: {
    borrow?: Money;
    repay?: Money;
    dividend?: Money;
    issueShares?: number;
    buyback?: number;
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
