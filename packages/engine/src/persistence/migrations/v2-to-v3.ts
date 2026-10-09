import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});
const num = (x: unknown, fallback: number): number => (typeof x === 'number' ? x : fallback);

/** Profile parameters added in v3, by profile (first release values). */
const PROFILE_DEFAULTS: Record<string, { competitorPriceWeight: number; stockoutPremium: number }> =
  {
    low_cost: { competitorPriceWeight: 0.5, stockoutPremium: 0 },
    premium: { competitorPriceWeight: 0.4, stockoutPremium: 0 },
    opportunist: { competitorPriceWeight: 0.6, stockoutPremium: 0.05 },
  };

/**
 * v2 → v3 (lot 1.3: capex, AI, stock market v1, views).
 * State: line status and depreciation rate, building depreciation rate,
 * staff flows, pnl.financial, market lastResult.allocated, quote consensus,
 * AI memory fields. Config: the keys added by the new systems, with the
 * values of their first release.
 */
export function migrateV2ToV3(state: RawState): RawState {
  const config = obj(state.config);
  const industry = obj(obj(config.sectors).industry);
  const line = obj(industry.line);
  const factory = obj(industry.factory);
  const regions = obj(state.regions);

  for (const company of Object.values(obj(state.companies)).map(obj)) {
    for (const site of Object.values(obj(company.sites)).map(obj)) {
      const land = num(obj(regions[site.regionId as string]).landCostIndex, 1);
      site.buildingDepreciationPerQuarter ??=
        (num(factory.buildCost, 0) * land) / num(factory.depreciationQuarters, 1);
      for (const l of Object.values(obj(site.lines)).map(obj)) {
        l.status ??= 'operational';
        l.depreciationPerQuarter ??= num(line.buildCost, 0) / num(line.depreciationQuarters, 1);
      }
    }
    for (const staff of Object.values(obj(company.workforce)).map(obj)) {
      staff.lastQuarter ??= { requested: 0, hired: 0, quits: 0, dismissed: 0 };
    }
    const books = obj(company.books);
    for (const s of [books.current, ...(Array.isArray(books.history) ? books.history : [])]) {
      obj(obj(s).pnl).financial ??= 0;
    }
  }
  for (const market of Object.values(obj(state.productMarkets)).map(obj)) {
    obj(market.lastResult).allocated ??= {};
  }
  for (const quote of Object.values(obj(obj(state.stock).quotes)).map(obj)) {
    quote.consensus ??= 0;
    quote.publishedQuarter ??= -1;
  }
  for (const memory of Object.values(obj(state.aiMemory)).map(obj)) {
    memory.rivalPrices ??= {};
    memory.lastShare ??= -1;
    memory.priceWarDiscount ??= 0;
    memory.wageBoost ??= {};
    memory.demandForecast ??= -1;
    memory.priceForecast ??= {};
    memory.lowUtilizationQuarters ??= 0;
  }

  line.modernizeQuarters ??= 1;
  line.modernizeTechGain ??= 0.25;
  line.maxTechLevel ??= 2;
  factory.maxSites ??= 4;
  const sm = obj(config.stockMarket);
  sm.maxMinorityStake ??= 0.3;
  sm.minPrice ??= 0.01;
  sm.fundamental ??= {
    growthWeight: 1,
    growthCap: 0.3,
    rateSensitivity: 8,
    salesMultiples: { industry: 0.6 },
    fullEbitdaMargin: 0.08,
    inventoryLiquidationShare: 0.7,
  };
  const pf = obj(sm.priceFormation);
  pf.marketVolatility ??= 0.04;
  pf.marketRateSensitivity ??= 4;
  pf.marketDemandSensitivity ??= 1;
  pf.surpriseFloorShareOfRevenue ??= 0.05;
  pf.surpriseCap ??= 0.3;
  pf.consensusSmoothing ??= 0.5;
  const ai = obj(config.ai);
  for (const [id, profile] of Object.entries(obj(ai.profiles)).map(
    ([k, v]) => [k, obj(v)] as const,
  )) {
    const d = PROFILE_DEFAULTS[id] ?? { competitorPriceWeight: 0.5, stockoutPremium: 0 };
    profile.competitorPriceWeight ??= d.competitorPriceWeight;
    profile.stockoutPremium ??= d.stockoutPremium;
  }
  ai.forecastSmoothing ??= 0.5;
  ai.initialDemandShareOfCapacity ??= 0.85;
  ai.maxPriceChange ??= 0.08;
  ai.costingUtilization ??= 0.85;
  ai.priceFloorOverVariableCost ??= 1.05;
  ai.priceWar ??= {
    priceCutTrigger: 0.04,
    shareLossTrigger: 0.01,
    discount: 0.08,
    durationQuarters: 3,
    cooldownQuarters: 4,
    grudgeGain: 0.5,
    grudgeDecay: 0.15,
  };
  ai.wageOutbid ??= {
    attritionTrigger: 1.4,
    hiringShortfallTrigger: 0.3,
    step: 0.03,
    max: 0.15,
    decay: 0.01,
  };
  ai.hr ??= { fireAbove: 1.25, fireTo: 1.1 };
  ai.purchasing ??= {
    safetyStock: 0.05,
    opportunisticDiscount: 0.08,
    opportunisticCoverQuarters: 0.5,
    contractQuarters: 4,
    contractRefillThreshold: 0.8,
  };
  ai.capex ??= {
    expandUtilization: 0.95,
    shrinkUtilization: 0.5,
    shrinkQuarters: 4,
    modernizeMinAge: 24,
    cashAfterQuarters: 0.5,
    maxLeverage: 2.5,
  };
  ai.finance ??= { cashBufferQuarters: 0.3, repayAboveQuarters: 1.5 };
  config.views ??= {
    competitorHistoryQuarters: 8,
    alerts: {
      materialCoverQuarters: 1,
      wageGapShare: 0.03,
      covenantNearShare: 0.85,
      capacityUtilization: 0.95,
    },
  };
  return state;
}
