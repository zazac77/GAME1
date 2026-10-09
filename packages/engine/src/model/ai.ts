import type { GameConfig } from '../config/schema';
import type { Company } from './company';
import type { ModifierTargetKind } from './events';
import type { Statements } from './finance';
import type {
  AiProfileId,
  CreditRating,
  Id,
  LaborPoolKey,
  ModifierKey,
  Money,
  Quarter,
  SectorId,
} from './ids';
import type { CommodityMarket, LaborPool, MacroState, ProductMarket, Region } from './markets';
import type { Quote } from './stock';

/** What a planner remembers from one quarter to the next (its own brain, per actor). */
export interface AiMemory {
  /** Rival company id → grudge level (0..1). */
  grudges: Record<Id, number>;
  lastRetaliationAt?: Quarter;
  watchlist: Id[];
  /** Rival product line → price seen at the last planning. */
  rivalPrices: Record<Id, Money>;
  /** Own share of its main market seen at the last planning (−1: none yet). */
  lastShare: number;
  /** Price war discount on the profile price, fading to 0. */
  priceWarDiscount: number;
  /** Extra wage premium won by outbidding, by labor pool. */
  wageBoost: Record<LaborPoolKey, number>;
  /** Smoothed, deseasonalized demand for the main product line (−1: none yet). */
  demandForecast: number;
  /** Smoothed world price by commodity. */
  priceForecast: Record<Id, Money>;
  /** Consecutive quarters of low capacity utilization. */
  lowUtilizationQuarters: number;
}

// ---- Observation: the only input of the AI planner (and the base of PlayerView) ----

export interface LaborPoolView extends LaborPool {
  /** laborForce − outsideEmployment − Σ headcount of the simulated firms. */
  unemployed: number;
}

export interface SiteView {
  siteId: Id;
  regionId: Id;
  status: 'operational' | 'under_construction';
  operationalLines: number;
  /** Lines under construction or being modernized. */
  pendingLines: number;
  /** Units per quarter of the operational lines (aging included). */
  capacity: number;
  /** Output ceiling with the current crew. */
  ceiling: number;
}

/** Everything about the observer's own company. */
export interface SelfView {
  company: Company;
  sites: SiteView[];
  /** Units per operator and per quarter, by region with a site. */
  operatorProductivity: Record<Id, number>;
  /** New term debt the bank would grant now. */
  borrowingCapacity: Money;
  /** Units the company can make this quarter with its current crew and lines. */
  outputCeiling: number;
}

/** What anyone can see on the shelves. */
export interface CompetitorProductView {
  lineId: Id;
  marketId: Id;
  price: Money;
  quality: number;
  /** Ran out of stock last quarter (empty shelves). */
  stockout: boolean;
  /** Share of the volume sold last quarter. */
  marketShare: number;
}

/** Partial view of another company: public facts and published accounts only. */
export interface CompetitorView {
  companyId: Id;
  name: string;
  actorName: string;
  sector: SectorId | 'holding';
  hqRegionId: Id;
  status: Company['status'];
  listed: boolean;
  brand: number;
  creditRating: CreditRating;
  products: CompetitorProductView[];
  /** Factories are visible from the street. */
  sites: { regionId: Id; status: 'operational' | 'under_construction'; lines: number }[];
  /** Published statements (listed companies, with the publication lag), oldest first. */
  published: Statements[];
}

/** Public news: an event whose effects are still active. */
export interface ActiveEventView {
  eventId: Id;
  target: { kind: ModifierTargetKind; id?: Id };
  key: ModifierKey;
  op: 'add' | 'mul';
  value: number;
  remaining: number;
}

export interface StockMarketView {
  index: { value: number; history: number[] };
  quotes: Record<Id, Quote>;
  /** Shares held by the public, by listed company. */
  float: Record<Id, number>;
  /** Shares of other companies held by the observer's company. */
  holdings: Record<Id, number>;
}

/**
 * Filtered view of the state for one actor (anti-cheat by construction): its
 * own company in full, markets and public facts about the others.
 */
export interface Observation {
  turn: Quarter;
  actorId: Id;
  profileId?: AiProfileId;
  companyId: Id;
  /** The rules are public. */
  config: GameConfig;
  macro: MacroState;
  regions: Record<Id, Region>;
  labor: Record<LaborPoolKey, LaborPoolView>;
  commodities: Record<Id, CommodityMarket>;
  /** lastResult.allocated only lists the observer's own lines. */
  productMarkets: Record<Id, ProductMarket>;
  self: SelfView;
  competitors: CompetitorView[];
  stock: StockMarketView;
  news: ActiveEventView[];
}
