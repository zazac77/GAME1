import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});

/**
 * v1 → v2 (lot 1.2: markets and production).
 * State: macro.baseRate, labor pool wageHistory, product line qualityTarget,
 * market lastResult.demand. Config: the keys added by the new systems, with
 * the values of their first release. Events stay as saved (none in v1).
 */
export function migrateV1ToV2(state: RawState): RawState {
  const macro = obj(state.macro);
  macro.baseRate ??= macro.policyRate;
  for (const pool of Object.values(obj(state.labor)).map(obj)) {
    pool.wageHistory ??= [pool.marketWage];
  }
  for (const company of Object.values(obj(state.companies)).map(obj)) {
    for (const line of Object.values(obj(company.productLines)).map(obj)) {
      line.qualityTarget ??= line.quality;
    }
  }
  for (const market of Object.values(obj(state.productMarkets)).map(obj)) {
    const result = obj(market.lastResult);
    result.demand ??= result.volume;
  }

  const config = obj(state.config);
  const cMacro = obj(config.macro);
  cMacro.demand ??= { gapPersistence: 0.85, gdpSensitivity: 3 };
  const labor = obj(config.labor);
  labor.wageOfferBounds ??= { min: 0.6, max: 2.5 };
  labor.employerBrand ??= { recovery: 0.1, wagePremiumWeight: 100, hiringElasticity: 1 };
  obj(labor.attrition).brandSensitivity ??= 0.5;
  labor.outside ??= { adjustSpeed: 0.25, cycleSensitivity: 1.5, vacancyRate: 0.03 };
  const commodities = obj(config.commodities);
  commodities.contractDiscountFullVolumeShare ??= 0.25;
  commodities.minDemandShare ??= 0.2;
  commodities.limitOrderTranches ??= 5;
  commodities.overflowStorageMultiplier ??= 3;
  const products = obj(config.products);
  products.spilloverRounds ??= 3;
  products.marketingUnit ??= 10000;
  products.priceBounds ??= { min: 0.2, max: 5 };
  const industry = obj(obj(config.sectors).industry);
  obj(industry.line).maintenanceCost ??= 25000;
  industry.supportStaff ??= { elasticity: 0.3, maxBonus: 1.05 };
  industry.learningReferenceOutput ??= 300000;
  industry.quality ??= {
    engineerOccupationId: 'occ_engineer',
    base: 25,
    engineerWeight: 45,
    maxEngineerRatio: 1.5,
    techLevelWeight: 20,
    adjustSpeed: 0.5,
  };
  industry.logisticsCostPerUnit ??= 8;
  industry.finishedGoodsStorageCost ??= 4;
  const finance = obj(config.finance);
  finance.collateralLoanToValue ??= 0.4;
  finance.spendingOverdraftShareOfRevenue ??= 0.25;
  return state;
}
