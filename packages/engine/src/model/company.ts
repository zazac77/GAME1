import type { AiProfileId, Id, ItemId, Money, Quarter, SectorId, StaffKey } from './ids';
import type { CompanyDecisions } from './decisions';
import type { Books, CreditStatus, Loan } from './finance';

export interface Actor {
  id: Id;
  kind: 'player' | 'ai';
  name: string;
  profileId?: AiProfileId;
  /** Top company of the actor (a plain company, later a holding). */
  rootCompanyId: Id;
}

export type AssetStatus = 'operational' | 'under_construction';

export interface ProductionLine {
  id: Id;
  /** A modernizing line does not produce until completesAt. */
  status: AssetStatus | 'modernizing';
  /** Quarter at which construction or modernization completes. */
  completesAt?: Quarter;
  /** Units per quarter. */
  capacity: number;
  /** Quarters since commissioning (or last modernization). */
  age: number;
  techLevel: number;
  /** Net book value. */
  bookValue: Money;
  /** Straight-line charge per quarter (cost / useful life), until the book value is 0. */
  depreciationPerQuarter: Money;
}

export interface Site {
  id: Id;
  kind: 'factory';
  regionId: Id;
  status: AssetStatus;
  /** Quarter at which construction completes (under_construction only). */
  completesAt?: Quarter;
  lines: Record<Id, ProductionLine>;
  /** Net book value of land and buildings. */
  buildingBookValue: Money;
  /** Straight-line charge of the building per quarter. */
  buildingDepreciationPerQuarter: Money;
  /** Units the site can store. */
  warehouseCapacity: number;
}

export interface TrainingBatch {
  toOccupationId: Id;
  count: number;
  doneAt: Quarter;
}

/** Labor flows of a staff group during the last resolved quarter. */
export interface StaffFlows {
  /** Hires asked for. */
  requested: number;
  hired: number;
  /** Voluntary departures (trainees included). */
  quits: number;
  dismissed: number;
}

export interface Staff {
  regionId: Id;
  occupationId: Id;
  headcount: number;
  /** Average quarterly wage. */
  wage: Money;
  /** New hires at reduced productivity (included in headcount). */
  rampingUp: number;
  inTraining: TrainingBatch[];
  lastQuarter: StaffFlows;
}

export interface StockLot {
  qty: number;
  avgCost: Money;
}

export interface SupplyContract {
  id: Id;
  commodityId: Id;
  qtyPerQuarter: number;
  price: Money;
  startsAt: Quarter;
  /** Last delivery happens the quarter before this one. */
  endsAt: Quarter;
}

export interface ProductLine {
  id: Id;
  marketId: Id;
  /** 0..100 */
  quality: number;
  /** Quality aimed at (0..100); higher quality consumes more material. */
  qualityTarget: number;
  price: Money;
  /** Product R&D level (0..rnd.maxLevel, fractional with obsolescence): raises the reachable quality. */
  techLevel?: number;
  users?: number;
}

export type RndType = 'process' | 'product';

/** An R&D project in progress (removed when completed). */
export interface RndProject {
  id: Id;
  type: RndType;
  /** Product line improved by a product project. */
  productLineId?: Id;
  /** 0..1; the project completes at 1. */
  progress: number;
  /** Cash spent so far. */
  spent: Money;
  /**
   * Nominal budget, fixed at its start (price level included). Progress is
   * uncertain: the actual spending may differ (up to cost / (1 − progressNoise)).
   */
  cost: Money;
  startedAt: Quarter;
}

export interface Company {
  id: Id;
  name: string;
  sector: SectorId | 'holding';
  hqRegionId: Id;
  status: 'active' | 'distressed' | 'bankrupt' | 'absorbed';
  listed: boolean;
  sharesOutstanding: number;
  // Control is derived from stock.registry, never stored twice.
  sites: Record<Id, Site>;
  workforce: Record<StaffKey, Staff>;
  inventory: Record<ItemId, StockLot>;
  contracts: SupplyContract[];
  productLines: Record<Id, ProductLine>;
  /** Customer reputation, 0..100. */
  brand: number;
  /** Employer attractiveness, 0..100. */
  employerBrand: number;
  /** Cumulative units produced (learning curve). */
  cumulativeOutput: number;
  /** Process R&D level (0..rnd.maxLevel, fractional with obsolescence). */
  processLevel: number;
  /** At most one project of each type at a time. */
  rnd: RndProject[];
  loans: Loan[];
  credit: CreditStatus;
  books: Books;
  /**
   * Normalized decisions of the last resolved quarter (private: never shown
   * to competitors). Base of defaultDecisions.
   */
  lastDecisions?: CompanyDecisions;
  /** Sector-specific state, typed by the SectorModule. */
  sectorState?: unknown;
}
