import type { Id, MacroRegime, Money, SectorId } from './ids';

export interface MacroState {
  regime: MacroRegime;
  /** Annualized real GDP growth of the last quarter. */
  gdpGrowth: number;
  /** Annualized inflation of the last quarter. */
  inflation: number;
  /** Annualized policy rate (base rate + modifiers, floored). */
  policyRate: number;
  /** Smoothed Taylor-rule rate, before temporary shocks. */
  baseRate: number;
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
  /** Weather of the quarter: crop yield index of the region's farms (1 = normal). */
  weather: number;
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
  /** Market wage at the start of each of the last quarters, oldest first (graduates lag). */
  wageHistory: Money[];
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
  betaDistribution: number;
  outsideUtility: number;
}

export interface ProductMarketResult {
  /** Product line id → share of the volume sold. */
  shares: Record<Id, number>;
  /** Units demanded from the simulated firms, before stock limits. */
  demand: number;
  /** Product line id → units demanded from it, before stock limits. */
  allocated: Record<Id, number>;
  /** Units sold. */
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
