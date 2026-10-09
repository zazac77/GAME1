import type { Id, Money } from './ids';
import type { RndType } from './company';

export type CapexOrder =
  | { kind: 'build_site'; regionId: Id }
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
  pricing: Record<Id, { price: Money }>;
  /** By site. */
  production: Record<Id, { targetOutput: number }>;
  hr: HrDecision[];
  purchasing: {
    spot: { commodityId: Id; qty: number; limitPrice?: Money }[];
    newContracts: { commodityId: Id; qtyPerQuarter: number; quarters: number }[];
  };
  capex: CapexOrder[];
  /** Marketing budget by product line. */
  marketing: Record<Id, Money>;
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
