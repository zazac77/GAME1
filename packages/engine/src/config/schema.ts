import { z } from 'zod';

// ---- shared building blocks ------------------------------------------------

export const SECTOR_IDS = ['industry', 'agri', 'tech'] as const;
export const AI_PROFILE_IDS = [
  'low_cost',
  'premium',
  'innovator',
  'opportunist',
  'conglomerate',
] as const;
export const MACRO_REGIMES = ['expansion', 'recession'] as const;
export const CREDIT_RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'] as const;

const sectorId = z.enum(SECTOR_IDS);
const aiProfileId = z.enum(AI_PROFILE_IDS);
const regime = z.enum(MACRO_REGIMES);
const id = z.string().regex(/^[a-z][a-z0-9_]*$/, 'ids are lower_snake_case');
const share = z.number().min(0).max(1);
const nonNeg = z.number().finite().min(0);
const pos = z.number().finite().positive();
const posInt = z.number().int().positive();
const nonNegInt = z.number().int().min(0);
/** One multiplier per season (T1..T4). */
const seasonality = z.tuple([pos, pos, pos, pos]);

// ---- sections ----------------------------------------------------------------

const timeSchema = z.strictObject({
  /** Length of a standard game, in quarters. */
  standardGameTurns: posInt,
});

const reportingSchema = z.strictObject({
  /** The game log keeps at most this many entries (oldest dropped first). */
  logMaxEntries: posInt,
  /** Each history series keeps at most this many points. */
  historyMaxLength: posInt,
});

const macroSchema = z.strictObject({
  initialRegime: regime,
  /** Quarterly probability of switching regime. */
  regimeTransition: z.strictObject({
    expansionToRecession: share,
    recessionToExpansion: share,
  }),
  /** Annualized real GDP growth, AR(1) around the regime mean. */
  gdpGrowth: z.strictObject({
    trend: z.number(),
    expansionMean: z.number(),
    recessionMean: z.number(),
    persistence: share,
    volatility: nonNeg,
  }),
  /** Annualized inflation, AR(1) around the target. */
  inflation: z.strictObject({
    target: z.number(),
    initial: z.number(),
    persistence: share,
    volatility: nonNeg,
  }),
  /** Simplified, smoothed Taylor rule (annualized rates). */
  policyRate: z.strictObject({
    neutral: z.number(),
    initial: z.number(),
    inflationWeight: nonNeg,
    growthWeight: nonNeg,
    smoothing: share,
    floor: z.number(),
  }),
});

const regionSchema = z.strictObject({
  /** Scales the labor force of every occupation in the region. */
  populationWeight: pos,
  /** Multiplier on reference wages. */
  wageIndex: pos,
  /** Multiplier on land and construction costs. */
  landCostIndex: pos,
  /** Multiplier on outbound logistics costs. */
  logisticsCostIndex: pos,
});

const occupationSchema = z.strictObject({
  /** Qualification level, N1 (unskilled) to N4 (executive/expert). */
  level: z.number().int().min(1).max(4),
  sectors: z.array(sectorId).min(1),
  /** Quarterly reference wage, before the regional wage index. */
  baseWage: pos,
  /** Labor force of the occupation in a region of populationWeight 1. */
  baseLaborForce: posInt,
});

const laborSchema = z.strictObject({
  occupations: z.record(id, occupationSchema),
  /** Unemployment rate of every pool at game start. */
  initialUnemploymentRate: share,
  /** Equilibrium tension (vacancies / unemployed) where wages only follow inflation. */
  targetTension: nonNeg,
  /** κ: speed at which market wages react to tension. */
  wageAdjustSpeed: nonNeg,
  /** m: bound on (tension − target) in the wage equation. */
  wageAdjustMaxGap: nonNeg,
  /** Cobb-Douglas matching: hires = min(V, U, μ·U^α·V^(1−α)). */
  matching: z.strictObject({ efficiency: pos, alpha: share }),
  /** ε_w: elasticity of a firm's share of hires to its relative wage offer. */
  wageOfferElasticity: nonNeg,
  /** Recruiting cost, in quarters of wage per hire. */
  hiringCost: nonNeg,
  /** Productivity of new hires during their first quarter. */
  rampUpProductivity: share,
  /** Severance, in quarters of wage per dismissal. */
  severanceQuarters: nonNeg,
  /** Employer brand lost per 1 % of the workforce dismissed. */
  dismissalBrandPenalty: nonNeg,
  attrition: z.strictObject({ baseRate: share, wageSensitivity: nonNeg }),
  /** Max hires per quarter, as a share of the pool, by qualification level (1..4). */
  maxHiringShareByLevel: z.tuple([share, share, share, share]),
  training: z.strictObject({
    costPerPerson: nonNeg,
    quarters: z.number().int().min(1).max(3),
    attritionReduction: share,
  }),
  /** Graduates entering an occupation each quarter, as a share of its labor force. */
  graduates: z.strictObject({
    baseRate: share,
    wagePremiumElasticity: nonNeg,
    lagQuarters: z.number().int().min(4).max(8),
  }),
});

const commodityMarketSchema = z.strictObject({
  unit: z.string().min(1),
  /** World price at game start. */
  basePrice: pos,
  /** Ornstein-Uhlenbeck mean reversion of ln(world price), per quarter. */
  meanReversion: share,
  /** Quarterly volatility of ln(world price). */
  volatility: nonNeg,
  seasonality,
  /** η in P = P^w · (D_sim / D_ref)^η. */
  priceImpact: nonNeg,
  storable: z.boolean(),
  /** Storage cost per unit and per quarter. */
  storageCostPerUnit: nonNeg,
});

const commoditiesSchema = z.strictObject({
  /** Risk premium of long-term contracts over the expected spot price. */
  forwardPremium: z.number(),
  /** Surcharge on spot purchases delivered within the quarter. */
  spotPremium: nonNeg,
  /** Max volume discount on contracts. */
  contractVolumeDiscountMax: share,
  contractQuarters: z.strictObject({ min: posInt, max: posInt }),
  /** Take-or-pay penalty, as a share of the value of the volume not taken. */
  takeOrPayPenalty: share,
  markets: z.record(id, commodityMarketSchema),
});

const segmentSchema = z.strictObject({
  id,
  weight: share,
  betaPrice: nonNeg,
  betaQuality: nonNeg,
  betaBrand: nonNeg,
  betaMarketing: nonNeg,
  /** U_0: utility of the outside option (imports, not buying). */
  outsideUtility: z.number(),
});

const productMarketSchema = z.strictObject({
  sectorId,
  /** Quarterly volume at the reference price, before seasonality and cycle. */
  baseVolume: pos,
  refPrice: pos,
  /** ε_market: price elasticity of total demand. */
  priceElasticity: nonNeg,
  seasonality,
  segments: z.array(segmentSchema).min(1),
});

const productsSchema = z.strictObject({
  markets: z.record(id, productMarketSchema),
  /** Share of unserved demand lost when it is reallocated to firms with stock. */
  spilloverRate: share,
  brand: z.strictObject({
    decay: share,
    marketingWeight: nonNeg,
    qualityWeight: nonNeg,
  }),
});

const industrySchema = z.strictObject({
  productMarketId: id,
  /** Commodity units consumed per unit produced. */
  recipe: z.record(id, pos),
  line: z.strictObject({
    /** Units per quarter. */
    capacity: pos,
    buildCost: pos,
    buildQuarters: posInt,
    depreciationQuarters: posInt,
    modernizeCost: pos,
    initialTechLevel: pos,
    /** Productivity lost per quarter of age. */
    agingPenalty: nonNeg,
  }),
  factory: z.strictObject({
    /** Before the regional land cost index. */
    buildCost: pos,
    buildQuarters: z.number().int().min(2).max(3),
    depreciationQuarters: posInt,
    /** Units (materials and finished goods) the site can store. */
    warehouseCapacity: pos,
    maxLines: posInt,
  }),
  /** Occupation whose headcount drives output. */
  operatorOccupationId: id,
  /** Units per operator per quarter at full skill and nominal staffing. */
  operatorProductivity: pos,
  /** Target staff per operator, by occupation. */
  supportRatios: z.record(id, nonNeg),
  /** Labor cost reduction per doubling of cumulative output. */
  learningRate: share,
  /** Extra material cost per quality point above 50, as a share of material cost. */
  qualityCostSlope: nonNeg,
  /** Resale discount on specific assets. */
  assetResaleDiscount: share,
  startingCompany: z.strictObject({
    lines: posInt,
    lineAgeQuarters: nonNegInt,
    staff: z.record(id, nonNegInt),
    /** Quarters of nominal production held as materials at start. */
    materialCoverQuarters: nonNeg,
    /** Quarters of nominal production held as finished goods at start. */
    finishedGoodsCoverQuarters: nonNeg,
    brand: z.number().min(0).max(100),
    employerBrand: z.number().min(0).max(100),
  }),
});

const ratingSchema = z.strictObject({
  rating: z.enum(CREDIT_RATINGS),
  maxNetDebtToEbitda: nonNeg,
  minInterestCoverage: nonNeg,
  /** Annual spread over the policy rate. */
  spread: nonNeg,
});

const financeSchema = z.strictObject({
  taxRate: share,
  /** Annual spread of the automatic emergency overdraft. */
  overdraftSpread: nonNeg,
  /** Quarters of negative equity and overdraft before bankruptcy. */
  distressQuarters: posInt,
  loanTermQuarters: posInt,
  /** Ordered from best to worst; the last entry catches everything. */
  ratings: z.array(ratingSchema).min(1),
  covenant: z.strictObject({ maxNetDebtToEbitda: pos, spreadPenalty: nonNeg }),
  startingCash: nonNeg,
  startingDebt: nonNeg,
  initialRating: z.enum(CREDIT_RATINGS),
});

const stockMarketSchema = z.strictObject({
  sharesOutstanding: posInt,
  /** Share of a listed company held by the public at start. */
  initialFloat: share,
  initialPriceToBook: pos,
  /** Max share of a float one holder can trade per quarter. */
  maxFloatPerQuarter: share,
  /** EV / EBITDA multiple by sector. */
  sectorMultiples: z.partialRecord(sectorId, pos),
  priceFormation: z.strictObject({
    /** λ: pull towards the fundamental value. */
    fundamentalPull: share,
    /** β: sensitivity to the market factor. */
    marketBeta: nonNeg,
    /** θ: sensitivity to earnings surprises. */
    earningsSurprise: nonNeg,
    /** γ: impact of net buying, per unit of float. */
    orderImpact: nonNeg,
    /** σ: idiosyncratic quarterly noise. */
    noise: nonNeg,
  }),
  indexBase: pos,
  /** Listed companies publish their results with this lag. */
  publicationLagQuarters: nonNegInt,
});

const aiProfileSchema = z.strictObject({
  /** Margin over full cost. */
  priceMarkup: z.number(),
  /** Quality (0..100) aimed at. */
  qualityTarget: z.number().min(0).max(100),
  /** Starting price, relative to the market reference price. */
  startPriceIndex: pos,
  /** Wage offer relative to the market wage. */
  wagePremium: z.number(),
  riskAversion: share,
  /** Probability of retaliating in a price war. */
  aggressiveness: share,
  marketingShareOfRevenue: share,
  rndShareOfRevenue: share,
});

const aiSchema = z.strictObject({
  profiles: z.partialRecord(aiProfileId, aiProfileSchema),
  /** Finished-goods coverage aimed at, in quarters of expected sales. */
  targetCoverage: nonNeg,
});

const effectSchema = z.strictObject({
  /** Name of the modified quantity, interpreted by the systems. */
  key: z.string().min(1),
  op: z.enum(['add', 'mul']),
  value: z.number().finite(),
});

const eventDefinitionSchema = z.strictObject({
  id,
  /** Probability per quarter. */
  probability: share,
  conditions: z.strictObject({
    seasons: z.array(z.number().int().min(0).max(3)).optional(),
    regimes: z.array(regime).optional(),
    sectors: z.array(sectorId).optional(),
  }),
  target: z.enum(['global', 'region', 'laborPool', 'commodity', 'market', 'company']),
  effects: z.array(effectSchema).min(1),
  durationQuarters: posInt,
  /** Share of the effect lost each quarter. */
  decay: share,
});

const eventsSchema = z.strictObject({
  definitions: z.array(eventDefinitionSchema),
});

const scenarioSchema = z.strictObject({
  playerSector: sectorId,
  playerHqRegionId: id,
  /** One entry per AI competitor; their HQs rotate over the other regions. */
  aiCompetitors: z
    .array(z.strictObject({ profileId: aiProfileId }))
    .min(3)
    .max(6),
  /** Relative jitter applied to starting values so that seeds differ. */
  initialJitter: share,
  playerStart: z.strictObject({
    quality: z.number().min(0).max(100),
    priceIndex: pos,
  }),
});

const victorySchema = z.strictObject({
  /** Whether a player bankruptcy ends a standard game. */
  bankruptcyEndsGame: z.boolean(),
});

// ---- root -----------------------------------------------------------------------

export const gameConfigSchema = z
  .strictObject({
    time: timeSchema,
    reporting: reportingSchema,
    macro: macroSchema,
    regions: z.record(id, regionSchema),
    labor: laborSchema,
    commodities: commoditiesSchema,
    products: productsSchema,
    sectors: z.strictObject({ industry: industrySchema }),
    finance: financeSchema,
    stockMarket: stockMarketSchema,
    ai: aiSchema,
    events: eventsSchema,
    scenario: scenarioSchema,
    victory: victorySchema,
  })
  .superRefine((cfg, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });

    if (!(cfg.scenario.playerHqRegionId in cfg.regions)) {
      issue(['scenario', 'playerHqRegionId'], 'unknown region');
    }
    cfg.scenario.aiCompetitors.forEach((c, i) => {
      if (!cfg.ai.profiles[c.profileId]) {
        issue(['scenario', 'aiCompetitors', i, 'profileId'], 'profile missing from ai.profiles');
      }
    });

    const industry = cfg.sectors.industry;
    if (!(industry.productMarketId in cfg.products.markets)) {
      issue(['sectors', 'industry', 'productMarketId'], 'unknown product market');
    }
    for (const commodityId of Object.keys(industry.recipe)) {
      if (!(commodityId in cfg.commodities.markets)) {
        issue(['sectors', 'industry', 'recipe', commodityId], 'unknown commodity');
      }
    }
    const occupationRefs: [(string | number)[], string][] = [
      [['sectors', 'industry', 'operatorOccupationId'], industry.operatorOccupationId],
      ...Object.keys(industry.supportRatios).map((o): [string[], string] => [
        ['sectors', 'industry', 'supportRatios', o],
        o,
      ]),
      ...Object.keys(industry.startingCompany.staff).map((o): [string[], string] => [
        ['sectors', 'industry', 'startingCompany', 'staff', o],
        o,
      ]),
    ];
    for (const [path, occupationId] of occupationRefs) {
      if (!(occupationId in cfg.labor.occupations)) issue(path, 'unknown occupation');
    }
    if (industry.startingCompany.lines > industry.factory.maxLines) {
      issue(['sectors', 'industry', 'startingCompany', 'lines'], 'exceeds factory.maxLines');
    }

    for (const [marketId, market] of Object.entries(cfg.products.markets)) {
      const total = market.segments.reduce((sum, s) => sum + s.weight, 0);
      if (Math.abs(total - 1) > 1e-9) {
        issue(['products', 'markets', marketId, 'segments'], 'segment weights must sum to 1');
      }
    }

    const { min, max } = cfg.commodities.contractQuarters;
    if (min > max) issue(['commodities', 'contractQuarters'], 'min > max');

    if (!cfg.stockMarket.sectorMultiples[cfg.scenario.playerSector]) {
      issue(['stockMarket', 'sectorMultiples'], 'missing multiple for the player sector');
    }
  });

/** Effective, validated configuration. Copied into every GameState. */
export type GameConfig = z.infer<typeof gameConfigSchema>;
export type SectorId = (typeof SECTOR_IDS)[number];
export type AiProfileId = (typeof AI_PROFILE_IDS)[number];
export type MacroRegime = (typeof MACRO_REGIMES)[number];
export type CreditRating = (typeof CREDIT_RATINGS)[number];
export type AiProfileConfig = z.infer<typeof aiProfileSchema>;
export type EventDefinition = z.infer<typeof eventDefinitionSchema>;

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Validates a full configuration; throws a readable error otherwise. */
export function parseConfig(input: unknown): GameConfig {
  const result = gameConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid game config:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
