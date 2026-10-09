import type { Id, MacroRegime, Money, SectorId } from './ids';

export interface MacroState {
  regime: MacroRegime;
  /** Annualized real GDP growth of the last quarter. */
  gdpGrowth: number;
  /** Annualized inflation of the last quarter. */
  inflation: number;
  /** Annualized policy rate. */
  policyRate: number;
  /** Cyclical demand multiplier (1 = trend). */
  demandIndex: number;
  /** Cumulative price level (1 at game start). */
  priceLevel: number;
}

export interface Region {
  id: Id;
  populationWeight: number;
  wageIndex: number;
  landCostIndex: number;
  logisticsCostIndex: number;
}

export interface LaborPool {
  regionId: Id;
  occupationId: Id;
  /** Working population of the occupation in the region. */
  laborForce: number;
  /** Jobs in the non-simulated economy. */
  outsideEmployment: number;
  /** Quarterly market wage. */
  marketWage: Money;
  /** Vacancies / unemployed. */
  tension: number;
  // unemployed = laborForce − outsideEmployment − Σ company headcount (tested invariant)
}

export interface CommodityMarket {
  id: Id;
  unit: string;
  /** Exogenous world price. */
  worldPrice: Money;
  /** Clearing price of the last quarter. */
  spotPrice: Money;
  /** Aggregate demand of the simulated companies last quarter. */
  lastSimDemand: number;
  /** D_ref in the spot price formula. */
  refDemand: number;
}

export interface ConsumerSegment {
  id: Id;
  weight: number;
  betaPrice: number;
  betaQuality: number;
  betaBrand: number;
  betaMarketing: number;
  outsideUtility: number;
}

export interface ProductMarketResult {
  /** Product line id → share of the volume sold. */
  shares: Record<Id, number>;
  volume: number;
  avgPrice: Money;
}

export interface ProductMarket {
  id: Id;
  sectorId: SectorId;
  baseVolume: number;
  refPrice: Money;
  segments: ConsumerSegment[];
  lastResult: ProductMarketResult;
}
