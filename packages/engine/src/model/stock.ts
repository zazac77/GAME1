import type { HolderId, Id, Money, Quarter } from './ids';

export interface Quote {
  price: Money;
  /** Price at the start of the current quarter (liquidity, limit checks). */
  referencePrice: Money;
  /** Fundamental value per share. */
  fundamental: Money;
  /** Price at the start of each quarter, oldest first. */
  history: Money[];
  /** Market consensus on the next published quarterly EBITDA. */
  consensus: Money;
  /** Last quarter whose results are public (−1: none yet). */
  publishedQuarter: Quarter;
}

export interface StockOrder {
  /** Company placing the order (holdings are its financial assets). */
  buyerId: Id;
  targetId: Id;
  side: 'buy' | 'sell';
  shares: number;
  limitPrice?: Money;
}

/** A takeover bid. Friendly offers (phase 2) are settled in the quarter they are launched. */
export interface TenderOffer {
  id: Id;
  bidderId: Id;
  targetId: Id;
  pricePerShare: Money;
  /** Premium over the target's price at the start of the quarter. */
  premium: number;
  /** Share of the price paid in new shares of the bidder (exchange of shares). */
  stockShare: number;
  launchedAt: Quarter;
  expiresAt: Quarter;
  /**
   * rejected: the target's board (its controlling shareholder) turned it
   * down; failed: the bidder would not get control, or could not pay.
   */
  status: 'open' | 'succeeded' | 'failed' | 'rejected' | 'withdrawn';
  /** Shares bought (0 unless succeeded). */
  acquired: number;
}

export interface StockMarketState {
  quotes: Record<Id, Quote>;
  /** Capitalization-weighted index of listed companies. */
  index: { value: number; history: number[] };
  /** Company → (holder → number of shares). */
  registry: Record<Id, Record<HolderId, number>>;
  /** Orders of the current quarter (executed at the end of the turn). */
  orders: StockOrder[];
  /** Recent tender offers, oldest first (bounded by mna.dealHistory). */
  tenderOffers: TenderOffer[];
}
