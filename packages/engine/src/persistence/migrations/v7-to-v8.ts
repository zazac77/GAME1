import type { RawState } from './index';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (typeof x === 'object' && x !== null ? (x as Obj) : {});

/** Takeover parameters added to every AI profile (values of the lot 2.4 engine). */
const PROFILE_MNA: Record<string, { sellPremium: number; acquisitiveness: number }> = {
  low_cost: { sellPremium: 0.25, acquisitiveness: 0 },
  premium: { sellPremium: 0.45, acquisitiveness: 0 },
  innovator: { sellPremium: 0.5, acquisitiveness: 0 },
  opportunist: { sellPremium: 0.3, acquisitiveness: 0.25 },
  conglomerate: { sellPremium: 0.35, acquisitiveness: 0.5 },
};

/**
 * v7 → v8 (lot 2.4: takeovers and stock market v2). State: the M&A market
 * (listings, due diligences, integrations), the cost of the stakes held in
 * controlled companies (none yet), the shares outstanding at the close of
 * every quarter, and the AI memory keyed by the company it runs instead of
 * the actor. Config: equity transactions, public offerings and tender
 * offers in stockMarket, the mna section, the takeover parameters of the
 * profiles, AI dividends and takeovers.
 */
export function migrateV7ToV8(state: RawState): RawState {
  state.mna ??= { listings: [], diligence: [], integrations: [] };
  for (const company of Object.values(obj(state.companies)).map(obj)) {
    company.participations ??= {};
    const books = obj(company.books);
    const shares = company.sharesOutstanding;
    for (const s of [books.current, ...(Array.isArray(books.history) ? books.history : [])]) {
      obj(s).shares ??= shares;
    }
  }
  const actors = obj(state.actors);
  const memories: Obj = {};
  for (const [key, memory] of Object.entries(obj(state.aiMemory))) {
    const rootCompanyId = obj(actors[key]).rootCompanyId;
    memories[typeof rootCompanyId === 'string' ? rootCompanyId : key] = memory;
  }
  state.aiMemory = memories;

  const config = obj(state.config);
  const stockMarket = obj(config.stockMarket);
  stockMarket.capital ??= {
    maxIssueShare: 0.2,
    issueDiscount: 0.08,
    issueFeeShare: 0.03,
    maxBuybackShare: 0.05,
    buybackPremium: 0.02,
  };
  stockMarket.ipo ??= { floatShare: 0.3, discount: 0.1, feeShare: 0.04, minQuarters: 2 };
  stockMarket.tenderPremiumDist ??= { tranches: 10, mean: 0.2, std: 0.1 };
  config.mna ??= {
    controlThreshold: 0.5,
    listings: {
      maxOpen: 3,
      arrivalProbability: 0.3,
      durationQuarters: 6,
      scale: { min: 0.35, max: 0.65 },
      profiles: ['premium', 'innovator', 'low_cost', 'opportunist'],
      estimateNoise: 0.25,
      performanceSpread: 0.25,
      askPremium: { min: 0.05, max: 0.4 },
      hiddenLiability: { probability: 0.3, min: 0.05, max: 0.3 },
    },
    dueDiligence: { costShareOfValue: 0.005, minCost: 150_000, validQuarters: 4 },
    valuation: {
      controlPremium: 0.3,
      equityRiskPremium: 0.07,
      fcfShareOfEbitda: 0.5,
      terminalGrowth: 0.02,
      horizonYears: 5,
      rangeWidth: 0.2,
    },
    financing: { maxDebtToEbitda: 3, spreadPremium: 0.01 },
    distressedSellFactor: 0.4,
    squeezeOutThreshold: 0.9,
    integration: {
      quarters: 4,
      costShareOfRevenue: 0.02,
      attritionMultiplier: 1.6,
      productivityMultiplier: 0.95,
    },
    delegatedProfileId: 'conglomerate',
    dealHistory: 20,
  };
  const ai = obj(config.ai);
  for (const [id, profile] of Object.entries(obj(ai.profiles)).map(
    ([k, v]) => [k, obj(v)] as const,
  )) {
    const mna = PROFILE_MNA[id] ?? { sellPremium: 0.3, acquisitiveness: 0 };
    profile.sellPremium ??= mna.sellPremium;
    profile.acquisitiveness ??= mna.acquisitiveness;
  }
  ai.dividends ??= { payout: 0.25, maxLeverage: 1.5, minCashQuarters: 1.5 };
  ai.mna ??= {
    cooldownQuarters: 6,
    valueMargin: 0.1,
    extraPremium: 0.03,
    maxShareOfEquity: 0.6,
    cashAfterQuarters: 1,
    maxLeverage: 2.5,
    debtShare: 0.5,
    stockShare: 0.5,
  };
  return state;
}
