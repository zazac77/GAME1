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

export interface TenderOffer {
  id: Id;
  bidderId: Id;
  targetId: Id;
  pricePerShare: Money;
  launchedAt: Quarter;
  expiresAt: Quarter;
  status: 'open' | 'succeeded' | 'failed' | 'withdrawn';
}

export interface StockMarketState {
  quotes: Record<Id, Quote>;
  /** Capitalization-weighted index of listed companies. */
  index: { value: number; history: number[] };
  /** Company → (holder → number of shares). */
  registry: Record<Id, Record<HolderId, number>>;
  /** Orders of the current quarter (executed at the end of the turn). */
  orders: StockOrder[];
  tenderOffers: TenderOffer[];
}
