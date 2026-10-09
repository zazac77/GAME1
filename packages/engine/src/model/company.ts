import type { AiProfileId, Id, ItemId, Money, Quarter, SectorId, StaffKey } from './ids';
import type { Books, CreditStatus, Loan } from './finance';

export interface Actor {
  id: Id;
  kind: 'player' | 'ai';
  name: string;
  profileId?: AiProfileId;
  /** Top company of the actor (a plain company, later a holding). */
  rootCompanyId: Id;
}

export interface ProductionLine {
  id: Id;
  /** Units per quarter. */
  capacity: number;
  /** Quarters since commissioning. */
  age: number;
  techLevel: number;
  /** Net book value. */
  bookValue: Money;
}

export interface Site {
  id: Id;
  kind: 'factory';
  regionId: Id;
  status: 'operational' | 'under_construction';
  /** Quarter at which construction completes (under_construction only). */
  completesAt?: Quarter;
  lines: Record<Id, ProductionLine>;
  /** Net book value of land and buildings. */
  buildingBookValue: Money;
  /** Units the site can store. */
  warehouseCapacity: number;
}

export interface TrainingBatch {
  toOccupationId: Id;
  count: number;
  doneAt: Quarter;
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
  price: Money;
  techLevel?: number;
  users?: number;
}

export type RndType = 'process' | 'product';

export interface RndProject {
  id: Id;
  type: RndType;
  productLineId?: Id;
  /** 0..1 */
  progress: number;
  spent: Money;
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
  rnd: RndProject[];
  loans: Loan[];
  credit: CreditStatus;
  books: Books;
  /** Sector-specific state, typed by the SectorModule. */
  sectorState?: unknown;
}
