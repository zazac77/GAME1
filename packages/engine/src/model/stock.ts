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

/**
 * A takeover bid. An offer the target's board backs is settled in the
 * quarter it is launched (friendly); a hostile offer (launched without the
 * board's support) stays open and others may compete with it until the close.
 */
export interface TenderOffer {
  id: Id;
  bidderId: Id;
  targetId: Id;
  pricePerShare: Money;
  /** Premium over basePrice. */
  premium: number;
  /** Undisturbed price of the target the premium is measured on (its price at the first launch on it). */
  basePrice: Money;
  /** Share of the price paid in new shares of the bidder (exchange of shares). */
  stockShare: number;
  /** Acquisition loan the bidder may draw at the close. */
  debt: Money;
  /** Launched without the board's support. */
  hostile: boolean;
  launchedAt: Quarter;
  /** Open offers close at the end of this quarter (settled offers: the quarter they were settled). */
  expiresAt: Quarter;
  /**
   * rejected: the target's board (its controlling shareholder) turned it
   * down; failed: the bidder would not get control, was outbid, or could not
   * pay; withdrawn: by the bidder during the contest.
   */
  status: 'open' | 'succeeded' | 'failed' | 'rejected' | 'withdrawn';
  /** Shares bought (0 unless succeeded). */
  acquired: number;
  /** Times the bidder raised its price. */
  raises: number;
  /** The board's answer to a hostile offer: a poison pill, a white knight sought. */
  defenses: { pill: boolean; whiteKnight: boolean };
}

/** Public campaign of an activist fund holding a stake in a listed company. */
export interface ActivistCampaign {
  fundId: Id;
  targetId: Id;
  /** payout: a dividend from its net cash; sale: sell the company. */
  demand: 'payout' | 'sale';
  since: Quarter;
}

export interface StockMarketState {
  quotes: Record<Id, Quote>;
  /** Capitalization-weighted index of listed companies. */
  index: { value: number; history: number[] };
  /** Company → (holder → number of shares). */
  registry: Record<Id, Record<HolderId, number>>;
  /** Orders of the current quarter (executed at the end of the turn). */
  orders: StockOrder[];
  /** Open offers and recent ones, oldest first (closed ones bounded by mna.dealHistory). */
  tenderOffers: TenderOffer[];
  /**
   * Holdings declared, by listed company and holder group (an actor, or a
   * company outside any group): the highest disclosure threshold reached.
   */
  declared: Record<Id, Record<HolderId, number>>;
  /** Activist campaigns under way. */
  campaigns: ActivistCampaign[];
}
