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
/**
 * Quantities that modifiers (events, later synergies) can change. Each system
 * documents which keys it reads and with which targets.
 */
export const MODIFIER_KEYS = [
  'macro.gdpGrowth', // add, annualized growth (global)
  'macro.inflation', // add, annualized inflation (global)
  'macro.policyRate', // add, annualized rate on top of the Taylor rule (global)
  'macro.expansionToRecession', // add, quarterly switch probability (global)
  'labor.productivity', // mul, operator productivity (region, laborPool, company)
  'labor.wageGrowth', // add, quarterly market wage growth (region, laborPool)
  'labor.attrition', // mul, quit rate (region, laborPool, company)
  'commodity.price', // mul, world price used for clearing (commodity)
  'commodity.supply', // mul, share of contracts and spot orders delivered (commodity)
  'market.demand', // mul, total demand of a product market (market)
  'agri.yield', // mul, crop yield of the farms (region)
  'tech.frontier', // add, extra advance of the technology frontier in a quarter (market)
] as const;

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
  /** Cyclical demand index: ln(d_t) = persistence·ln(d_{t−1}) + sensitivity·(g − trend)/4. */
  demand: z.strictObject({ gapPersistence: share, gdpSensitivity: nonNeg }),
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
  /** Allowed wage offers, relative to the market wage. */
  wageOfferBounds: z.strictObject({ min: pos, max: pos }),
  employerBrand: z.strictObject({
    /** Share of the gap to its target closed each quarter. */
    recovery: share,
    /** Target = 50 + weight·(average relative wage − 1). */
    wagePremiumWeight: nonNeg,
    /** Hiring weight f(brand) = (brand / 50)^elasticity. */
    hiringElasticity: nonNeg,
  }),
  /** Quit rate = base·(market / wage)^σ·(1 + brandSensitivity·(50 − brand)/50). */
  attrition: z.strictObject({ baseRate: share, wageSensitivity: nonNeg, brandSensitivity: nonNeg }),
  /** Non-simulated economy of each pool. */
  outside: z.strictObject({
    /** Share of the gap to its target employment closed each quarter. */
    adjustSpeed: share,
    /** Target unemployment = initial rate·demandIndex^(−sensitivity). */
    cycleSensitivity: nonNeg,
    /** Vacancies posted by the outside economy, as a share of its jobs. */
    vacancyRate: share,
  }),
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
  /** Share of the stored units lost each quarter (perishable goods). */
  perishRate: share,
  /**
   * Crops: the clearing price is multiplied by (national yield index)^(−weatherSensitivity),
   * so that a bad harvest raises the price for everyone.
   */
  weatherSensitivity: nonNeg,
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
  /** Contract volume (share of the reference demand) that earns the full discount. */
  contractDiscountFullVolumeShare: pos,
  /** Floor of D_sim / D_ref in the spot price formula. */
  minDemandShare: pos,
  /** Limit orders are cut by 1/tranches until their limit is met. */
  limitOrderTranches: posInt,
  /** Storage cost multiplier for units above the warehouse capacity. */
  overflowStorageMultiplier: z.number().min(1),
  markets: z.record(id, commodityMarketSchema),
});

const segmentSchema = z.strictObject({
  id,
  weight: share,
  betaPrice: nonNeg,
  betaQuality: nonNeg,
  betaBrand: nonNeg,
  betaMarketing: nonNeg,
  /** βd: weight of the shelf presence (distribution 0..1) of the product. */
  betaDistribution: nonNeg,
  /** βn: network effect, weight of ln(1 + users / products.networkUnit) (subscriptions). */
  betaNetwork: nonNeg,
  /** βt: weight of the product's technology level relative to the frontier (tech). */
  betaTech: nonNeg,
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
  /** Reallocation rounds of unserved demand. */
  spilloverRounds: nonNegInt,
  /** Marketing enters utilities and brand as ln(1 + budget / unit). */
  marketingUnit: pos,
  /** Subscribers enter utilities as ln(1 + users / unit) (network effect). */
  networkUnit: pos,
  /** Allowed prices, relative to the inflation-indexed reference price. */
  priceBounds: z.strictObject({ min: pos, max: pos }),
  brand: z.strictObject({
    decay: share,
    marketingWeight: nonNeg,
    qualityWeight: nonNeg,
  }),
});

const rndTypeSchema = z.strictObject({
  /** Cost of the first project, before the price level. */
  baseCost: pos,
  /** Reachable quality points per level. */
  qualityPerLevel: nonNeg,
  /** Relative operator productivity per level. */
  productivityPerLevel: nonNeg,
});

/** Sectors that make goods in factories with production lines (industry, agri). */
const plantSectorSchema = z.strictObject({
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
    /** The line stops producing for this many quarters while it is modernized. */
    modernizeQuarters: posInt,
    /** Tech level gained by a modernization (age reset to 0), up to maxTechLevel. */
    modernizeTechGain: pos,
    maxTechLevel: pos,
    initialTechLevel: pos,
    /** Productivity lost per quarter of age. */
    agingPenalty: nonNeg,
    /** Fixed maintenance per line and per quarter. */
    maintenanceCost: nonNeg,
  }),
  factory: z.strictObject({
    /** Before the regional land cost index. */
    buildCost: pos,
    buildQuarters: z.number().int().min(2).max(3),
    depreciationQuarters: posInt,
    /** Units (materials and finished goods) the site can store. */
    warehouseCapacity: pos,
    maxLines: posInt,
    /** Factories a company can own (built or under construction). */
    maxSites: posInt,
  }),
  /** Occupation whose headcount drives output. */
  operatorOccupationId: id,
  /** Units per operator per quarter at full skill and nominal staffing. */
  operatorProductivity: pos,
  /** Target staff per operator, by occupation. */
  supportRatios: z.record(id, nonNeg),
  /** Productivity factor from support staff: min(maxBonus, (actual / target ratio)^elasticity). */
  supportStaff: z.strictObject({ elasticity: nonNeg, maxBonus: z.number().min(1) }),
  /** Labor cost reduction per doubling of cumulative output. */
  learningRate: share,
  /** Cumulative output at which the learning factor is 1. */
  learningReferenceOutput: pos,
  /** Extra material consumed per quality point above 50, as a share of the recipe. */
  qualityCostSlope: nonNeg,
  /**
   * Reachable quality = base + engineerWeight·min(maxEngineerRatio, actual / target
   * engineer ratio) + techLevelWeight·(average line tech level − 1).
   */
  quality: z.strictObject({
    /** Occupation whose ratio to operators drives quality; its target ratio is in supportRatios. */
    engineerOccupationId: id,
    base: nonNeg,
    engineerWeight: nonNeg,
    maxEngineerRatio: pos,
    techLevelWeight: nonNeg,
    /** Share of the gap to the aimed quality closed each quarter. */
    adjustSpeed: share,
  }),
  /**
   * R&D projects (step 9). A project costs baseCost·(1 + costGrowthPerLevel·level)
   * at the price level of its start; completing it adds one level (up to
   * maxLevel). Process level: company-wide productivity and reachable quality;
   * product level: reachable quality of the product line. Levels lose
   * obsolescencePerQuarter each quarter.
   */
  rnd: z.strictObject({
    process: rndTypeSchema,
    product: rndTypeSchema,
    costGrowthPerLevel: nonNeg,
    maxLevel: pos,
    /** At most this share of a project's cost is spent per quarter (minimum duration). */
    maxSpendShare: z.number().gt(0).max(1),
    /** Progress of a quarter = budget / cost × U[1 − noise, 1 + noise]. */
    progressNoise: z.number().min(0).lt(1),
    obsolescencePerQuarter: nonNeg,
  }),
  /** Outbound logistics per unit sold, before the regional index. */
  logisticsCostPerUnit: nonNeg,
  /** Storage cost of a finished unit per quarter. */
  finishedGoodsStorageCost: nonNeg,
  /** Share of the finished goods in stock lost at the end of each quarter (perishables). */
  finishedGoodsPerishRate: share,
  /** Resale discount on specific assets (on their book value). */
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

const industrySchema = plantSectorSchema;

/** Agrifood: a plant sector with farms, regional weather and retail listing. */
const agriSchema = plantSectorSchema.extend({
  /**
   * Own farms (upstream integration). Farmland is limited by region; a farm
   * harvests its crop once a year: hectares × yieldPerHectare × regional
   * yield index (weather, drought) × staffing factor × (1 + agronomist bonus).
   */
  farm: z.strictObject({
    /** Storable commodity harvested (it feeds the plants like a bought one). */
    cropId: id,
    /** Season (0..3) of the harvest. */
    harvestSeason: z.number().int().min(0).max(3),
    /** Hectares of a farm. */
    hectares: pos,
    /** Crop units per hectare and per harvest, at a yield index of 1. */
    yieldPerHectare: pos,
    /** Price of a hectare, before the regional land cost index. */
    landCostPerHectare: pos,
    /** Equipment and buildings of a farm (depreciated; the land is not). */
    equipmentCost: nonNeg,
    depreciationQuarters: posInt,
    /** A bought farm is set up during this many quarters. */
    setupQuarters: posInt,
    /** Resale discount on the book value of a farm (land keeps its value). */
    resaleDiscount: share,
    /** Hectares of farmland the simulated firms can own, by region. */
    landByRegion: z.record(id, nonNeg),
    maxFarms: posInt,
    /** Crop storage of a farm (units). */
    warehouseCapacity: nonNeg,
    /** Occupation working the fields; the harvest scales with min(1, staff / (hectares × ratio)). */
    farmhandOccupationId: id,
    farmhandsPerHectare: pos,
    /** Experts raising the yield by up to agronomistYieldBonus at their target ratio. */
    agronomistOccupationId: id,
    agronomistsPerHectare: pos,
    agronomistYieldBonus: nonNeg,
    /** Non-storable input bought at the harvest, per hectare. */
    fertilizerId: id,
    fertilizerPerHectare: nonNeg,
    /** Fixed upkeep of a farm per quarter. */
    maintenanceCost: nonNeg,
  }),
  /**
   * Regional weather: ln w_r,t = persistence·ln w_r,t−1 + volatility·(√c·ε_common + √(1−c)·ε_r),
   * bounded; w is the yield index of the region's farms (1 = normal).
   */
  weather: z.strictObject({
    persistence: share,
    volatility: nonNeg,
    commonShare: share,
    min: pos,
    max: pos,
  }),
  /**
   * Retail listing: distribution_t = d·(1 − decay) + (1 − d·(1 − decay))·(1 − exp(−fees / (feeUnit × price level))).
   * Listing fees are a commercial expense (booked with marketing).
   */
  listing: z.strictObject({
    feeUnit: pos,
    decay: share,
    /** Distribution of a starting company. */
    initial: share,
  }),
  /** Starting farms of a company, in its HQ region. */
  startingFarms: nonNegInt,
});

/**
 * Technology (SaaS): no plant. Offices seat the staff; subscribers are
 * served from rented cloud capacity; developers either maintain the product
 * (quality) or work on R&D projects measured in developer-quarters.
 */
const techSchema = z.strictObject({
  productMarketId: id,
  /** Non-storable compute capacity, bought at consumption. */
  cloudId: id,
  /** Cloud units per billed subscriber and per quarter, before platform R&D. */
  cloudPerUser: pos,
  developerOccupationId: id,
  seniorOccupationId: id,
  supportOccupationId: id,
  productManagerOccupationId: id,
  /** Subscribers that one developer kept off R&D maintains (bugs, operations). */
  usersPerDeveloper: pos,
  /** Subscribers one support agent serves. */
  usersPerSupport: pos,
  /** Target seniors per developer. */
  seniorRatio: pos,
  /** Target product managers per developer. */
  productManagerRatio: pos,
  /**
   * Reachable quality (bugs) = base + seniorWeight·min(maxSeniorRatio, seniors / target)
   * − maintenanceWeight·(1 − maintenance coverage) + platform R&D; quality moves
   * towards it by adjustSpeed of the gap each quarter.
   */
  quality: z.strictObject({
    base: nonNeg,
    seniorWeight: nonNeg,
    maxSeniorRatio: pos,
    maintenanceWeight: nonNeg,
    adjustSpeed: share,
  }),
  /**
   * Technology frontier of the market: starts at `initial`, advances each
   * quarter (plus tech.frontier modifiers). A product release cannot take the
   * product more than maxLead ahead of it.
   */
  frontier: z.strictObject({ initial: pos, advancePerQuarter: nonNeg, maxLead: nonNeg }),
  /**
   * Quarterly churn = baseChurn·(price / average offer price)^priceSensitivity
   * ·(1 + techGapSensitivity·gap)·(1 + qualitySensitivity·(50 − quality)/50)
   * ·(1 + supportSensitivity·(1 − support coverage)), within [minChurn, maxChurn].
   */
  subscription: z.strictObject({
    baseChurn: share,
    priceSensitivity: nonNeg,
    techGapSensitivity: nonNeg,
    qualitySensitivity: nonNeg,
    supportSensitivity: nonNeg,
    minChurn: share,
    maxChurn: share,
  }),
  /**
   * R&D projects (step 9), measured in developer-quarters. A developer
   * assigned to a project brings (1 + seniorBonus·min(1, senior coverage))
   * developer-quarters, × U[1 − progressNoise, 1 + progressNoise]; at most
   * maxEffortShare of the effort per quarter. Their wages are booked as R&D.
   * Product release: tech level + releaseGain·U[1 − outcomeNoise, 1 + outcomeNoise]
   * ·(1 + productManagerBonus·min(1, PM coverage)) + imitation·(gap to the frontier):
   * catching up costs less than innovating. Platform (process) level:
   * cloud per user × (1 − cloudSavingPerLevel·level), reachable quality +
   * qualityPerLevel·level; it fades by obsolescencePerQuarter.
   */
  rnd: z.strictObject({
    product: z.strictObject({ effort: pos, releaseGain: pos, imitation: share }),
    process: z.strictObject({
      effort: pos,
      cloudSavingPerLevel: z.number().min(0).max(0.15),
      qualityPerLevel: nonNeg,
    }),
    /** Platform projects cost (1 + effortGrowthPerLevel·level) × their effort. */
    effortGrowthPerLevel: nonNeg,
    /** Max platform level. */
    maxLevel: pos,
    maxEffortShare: z.number().gt(0).max(1),
    progressNoise: z.number().min(0).lt(1),
    outcomeNoise: z.number().min(0).lt(1),
    seniorBonus: nonNeg,
    productManagerBonus: nonNeg,
    obsolescencePerQuarter: nonNeg,
  }),
  /** Offices seat the staff of a region; hiring needs a free seat. */
  office: z.strictObject({
    /** Fit-out, before the regional land cost index. */
    buildCost: pos,
    setupQuarters: posInt,
    depreciationQuarters: posInt,
    seats: posInt,
    /** Rent and running costs per office and per quarter. */
    upkeep: nonNeg,
    maxOffices: posInt,
  }),
  /** Resale discount on the book value of an office. */
  assetResaleDiscount: share,
  startingCompany: z.strictObject({
    offices: posInt,
    officeAgeQuarters: nonNegInt,
    users: nonNeg,
    /** Starting tech level below the frontier. */
    techGap: nonNeg,
    staff: z.record(id, nonNegInt),
    brand: z.number().min(0).max(100),
    employerBrand: z.number().min(0).max(100),
    /** Asset-light firms start with their own financing (instead of finance.starting*). */
    cash: nonNeg,
    debt: nonNeg,
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
  /** New borrowing allowed against fixed assets when EBITDA does not support it. */
  collateralLoanToValue: share,
  /**
   * Discretionary spending (spot purchases, marketing, hiring, training,
   * repayments) is capped at cash + new borrowing + this share of the last
   * quarter's revenue.
   */
  spendingOverdraftShareOfRevenue: nonNeg,
  startingCash: nonNeg,
  startingDebt: nonNeg,
  initialRating: z.enum(CREDIT_RATINGS),
});

const stockMarketSchema = z.strictObject({
  sharesOutstanding: posInt,
  /** Share of a listed company held by the public at start. */
  initialFloat: share,
  initialPriceToBook: pos,
  /** Price / book of a sector at listing, where book value says little (asset-light tech). */
  initialPriceToBookBySector: z.partialRecord(sectorId, pos),
  /** Max share of a float one holder can trade per quarter. */
  maxFloatPerQuarter: share,
  /** Stock orders: a group holds at most this share of another company (control needs a takeover). */
  maxMinorityStake: share,
  /** Price floor, and price of a bankrupt (delisted) company. */
  minPrice: pos,
  /** EV / EBITDA multiple by sector. */
  sectorMultiples: z.partialRecord(sectorId, pos),
  fundamental: z.strictObject({
    /** EV multiple × (1 + growthWeight·clamp(year-on-year revenue growth, ±growthCap)). */
    growthWeight: nonNeg,
    growthCap: share,
    /** EV multiple × exp(−rateSensitivity·(policy rate − neutral rate)). */
    rateSensitivity: nonNeg,
    /** EV / revenue by sector, blended in while the EBITDA margin is below fullEbitdaMargin. */
    salesMultiples: z.partialRecord(sectorId, pos),
    fullEbitdaMargin: pos,
    /** Liquidation floor: inventories at this share of book value, fixed assets after assetResaleDiscount. */
    inventoryLiquidationShare: share,
  }),
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
    /** Quarterly volatility of the common market factor r_market. */
    marketVolatility: nonNeg,
    /** r_market falls by this much per point of policy rate increase over the quarter. */
    marketRateSensitivity: nonNeg,
    /** r_market response to the change of ln(demand index). */
    marketDemandSensitivity: nonNeg,
    /** surprise = (EBITDA − consensus) / max(|consensus|, floor·revenue), clamped to ±surpriseCap. */
    surpriseFloorShareOfRevenue: pos,
    surpriseCap: pos,
    /** Share of the gap to the published EBITDA closed by the consensus. */
    consensusSmoothing: share,
  }),
  indexBase: pos,
  /** Listed companies publish their results with this lag. */
  publicationLagQuarters: nonNegInt,
  /** Equity transactions of a listed company, at the start of the quarter. */
  capital: z.strictObject({
    /** New shares per quarter, as a share of the shares outstanding. */
    maxIssueShare: share,
    /** New shares are sold at the price × (1 − issueDiscount)… */
    issueDiscount: share,
    /** …less fees (share of the gross proceeds). */
    issueFeeShare: share,
    /** Buybacks per quarter, as a share of the shares outstanding (and within maxFloatPerQuarter of the float). */
    maxBuybackShare: share,
    /** Buybacks are paid at the price × (1 + buybackPremium). */
    buybackPremium: nonNeg,
  }),
  /** Initial public offering of an unlisted company (a subsidiary). */
  ipo: z.strictObject({
    /** Share of the capital the public holds after the offering (new shares). */
    floatShare: share,
    /** Offering price = fundamental value per share × (1 − discount). */
    discount: share,
    /** Fees, as a share of the gross proceeds. */
    feeShare: share,
    /** Closed quarters needed before the offering. */
    minQuarters: posInt,
  }),
  /**
   * Tender offers: the float is split into `tranches` of investors, each
   * asking a premium drawn from N(mean, std) (floored at 0); a tranche tenders
   * its shares when the premium offered is at least the premium it asks.
   */
  tenderPremiumDist: z.strictObject({ tranches: posInt, mean: nonNeg, std: nonNeg }),
});

const aiProfileSchema = z.strictObject({
  /** Margin over full cost. */
  priceMarkup: z.number(),
  /** Quality (0..100) aimed at. */
  qualityTarget: z.number().min(0).max(100),
  /** Starting price relative to the reference price, then positioning against the rivals' average. */
  startPriceIndex: pos,
  /** Weight of the positioned rivals' price against cost-plus in the target price (geometric blend). */
  competitorPriceWeight: share,
  /** Wage offer relative to the market wage. */
  wagePremium: z.number(),
  /** Share of the material needs secured by long-term contracts; caution with investments. */
  riskAversion: share,
  /** Probability of retaliating in a price war. */
  aggressiveness: share,
  /** Price premium taken while rivals are out of stock (opportunist). */
  stockoutPremium: nonNeg,
  marketingShareOfRevenue: share,
  rndShareOfRevenue: share,
  /** Share of the R&D budget spent on process projects (the rest on product projects). */
  rndProcessShare: share,
  /** Extra wage premium on the skilled occupations (level ≥ ai.wageOutbid.skilledLevel): talent hunting. */
  skilledWagePremium: z.number(),
  /** Max outbidding boost on top of the wage premium. */
  wageOutbidMax: nonNeg,
  /** Depth of the price war ripostes: × ai.priceWar.discount, escalationStep and maxDiscount. */
  priceWarDepth: nonNeg,
  /** Marketing raised by this share in a quarter a rival's price cut costs market share. */
  brandDefense: nonNeg,
  /** Probability of a counter-launch when a rival's product leaps ahead. */
  counterLaunch: share,
  /** Appetite for rivals in difficulty (predatory discount, demand capture); 0: none. */
  opportunism: share,
  /**
   * Premium over the share price the controlling shareholder of a company run
   * by this profile asks to back a friendly offer or sell its block.
   */
  sellPremium: nonNeg,
  /** Probability per quarter of looking for a takeover (0: never buys companies). */
  acquisitiveness: share,
});

const aiSchema = z.strictObject({
  profiles: z.partialRecord(aiProfileId, aiProfileSchema),
  /** Per-sector adjustments of the profiles (e.g. thinner markups in agrifood). */
  sectorProfiles: z.partialRecord(
    sectorId,
    z.partialRecord(aiProfileId, aiProfileSchema.partial().strict()),
  ),
  /** Finished-goods coverage aimed at, in quarters of expected sales. */
  targetCoverage: nonNeg,
  /** Weight of the newest observation in the smoothed forecasts (demand, prices). */
  forecastSmoothing: share,
  /** Demand assumed before the first sales, as a share of the output ceiling. */
  initialDemandShareOfCapacity: share,
  /** Max relative price change per quarter. */
  maxPriceChange: share,
  /**
   * Standard costing: fixed costs per unit are spread over at least this share
   * of the line capacity (avoids the death spiral of cost-plus on a falling volume).
   */
  costingUtilization: share,
  /** The price never goes below the variable unit cost × this. */
  priceFloorOverVariableCost: pos,
  priceWar: z.strictObject({
    /** A rival cutting its price by more than this share… */
    priceCutTrigger: share,
    /** …while the own market share falls by more than this (absolute) triggers a riposte. */
    shareLossTrigger: share,
    /** Riposte: discount on the target price, fading linearly over durationQuarters. */
    discount: share,
    durationQuarters: posInt,
    /** Quarters between two ripostes. */
    cooldownQuarters: nonNegInt,
    /** Grudge gained against the rival per riposte; grudges fade by grudgeDecay per quarter. */
    grudgeGain: share,
    grudgeDecay: share,
    /** Riposte probability = aggressiveness + grudgeAggression × grudge against the cutter. */
    grudgeAggression: nonNeg,
    /** A rival still cutting during the war: discount + escalationStep (× depth), up to maxDiscount (× depth). */
    escalationStep: share,
    maxDiscount: share,
    /** Below this EBITDA margin (last quarter), the war ends at once (truce) and none starts. */
    truceMargin: z.number(),
  }),
  wageOutbid: z.strictObject({
    /** A quit rate above base attrition × this… */
    attritionTrigger: pos,
    /** …or this share of the requested hires not obtained raises the wage boost by `step`. */
    hiringShortfallTrigger: share,
    /**
     * Raise of the boost under pressure; when a rival's public job offer in the
     * pool beats the own offer, the boost goes at once to that offer + step
     * (up to the profile's wageOutbidMax).
     */
    step: nonNeg,
    /** Boost lost per quarter without pressure. */
    decay: nonNeg,
    /** No raise when the last EBITDA margin is below this. */
    minMargin: z.number(),
    /** Grudge gained against the rival whose job offer is outbid (and public news)… */
    poachGrudge: share,
    /** …at most once per rival in this many quarters. */
    cooldownQuarters: nonNegInt,
    /** Occupations of this qualification level and above get the profile's skilledWagePremium. */
    skilledLevel: z.number().int().min(1).max(4),
  }),
  counterLaunch: z.strictObject({
    /**
     * A rival whose product gains more than qualityJumpTrigger quality points
     * (or techJumpTrigger tech levels) in a quarter and overtakes the own
     * product triggers a counter-launch with probability = profile.counterLaunch.
     */
    qualityJumpTrigger: nonNeg,
    techJumpTrigger: nonNeg,
    durationQuarters: posInt,
    /** Quarters between the starts of two counter-launches. */
    cooldownQuarters: nonNegInt,
    /** Quality aimed at: the rival's + qualityMargin, at most the profile's + maxQualityBoost. */
    qualityMargin: nonNeg,
    maxQualityBoost: nonNeg,
    /** Product R&D (budget, or developers in tech) and marketing raised by these shares. */
    rndBoost: nonNeg,
    marketingBoost: nonNeg,
  }),
  /** Rivals in difficulty, as seen from public facts (status, rating, published accounts). */
  opportunism: z.strictObject({
    /** A rival with one of these ratings… */
    weakRatings: z.array(z.enum(CREDIT_RATINGS)),
    /** …or this many published quarters of net loss in a row, or distressed, looks weak. */
    lossQuarters: posInt,
    /** Quarters in a row a rival must look weak to go on the watchlist. */
    watchQuarters: posInt,
    /** Price discount × opportunism while a watched rival sells in the own market. */
    predatoryDiscount: share,
    /** Extra demand planned: captureShare × opportunism × the watched rivals' market share. */
    captureShare: share,
  }),
  hr: z.strictObject({
    /** Dismissals when headcount exceeds the need × fireAbove, down to need × fireTo. */
    fireAbove: z.number().min(1),
    fireTo: z.number().min(1),
  }),
  purchasing: z.strictObject({
    /** Extra share of materials bought on top of the planned need. */
    safetyStock: nonNeg,
    /** A world price below its smoothed value by this share… */
    opportunisticDiscount: share,
    /** …triggers extra purchases of this many quarters of need. */
    opportunisticCoverQuarters: nonNeg,
    contractQuarters: posInt,
    /** Contracts are topped up when the contracted volume falls below target × this. */
    contractRefillThreshold: share,
  }),
  capex: z.strictObject({
    /** Expected demand / line capacity above which capacity is added. */
    expandUtilization: pos,
    /** Below this for shrinkQuarters in a row, the oldest line is sold. */
    shrinkUtilization: share,
    shrinkQuarters: posInt,
    /** Lines older than this are modernized when cash allows. */
    modernizeMinAge: nonNegInt,
    /** Cash kept after an investment, in quarters of cash costs (× (1 + riskAversion)). */
    cashAfterQuarters: nonNeg,
    /** No investment above this net debt / EBITDA. */
    maxLeverage: nonNeg,
  }),
  /** Retail listing fees: enough to reach targetDistribution next quarter, within a share of revenue. */
  listing: z.strictObject({ targetDistribution: share, maxShareOfRevenue: share }),
  tech: z.strictObject({
    /** Staff sized for the expected subscribers × this (maintenance, support). */
    staffingCover: z.number().min(1),
    /**
     * Catching up: beyond gapTolerance behind the frontier, the R&D share of
     * revenue rises by catchUpPerGap per unit of gap (all on product
     * releases), up to maxRndShare.
     */
    gapTolerance: nonNeg,
    catchUpPerGap: nonNeg,
    maxRndShare: share,
    /** Price × (base churn / own churn)^churnPriceResponse when the churn is above its base. */
    churnPriceResponse: nonNeg,
  }),
  finance: z.strictObject({
    /** Cash buffer aimed at, in quarters of cash costs. */
    cashBufferQuarters: nonNeg,
    /** Term debt is repaid with the cash above this many quarters of cash costs. */
    repayAboveQuarters: nonNeg,
  }),
  /**
   * Dividends of a listed AI company: payout × the last published net income,
   * when net debt / EBITDA is below maxLeverage and the cash stays above
   * minCashQuarters of cash costs.
   */
  dividends: z.strictObject({ payout: share, maxLeverage: nonNeg, minCashQuarters: nonNeg }),
  /** Takeovers by the group heads whose profile has some acquisitiveness. */
  mna: z.strictObject({
    /** Quarters between two attempts. */
    cooldownQuarters: nonNegInt,
    /** A deal is made only if the valuation mid-point × (1 + this) covers the price. */
    valueMargin: z.number(),
    /** Premium offered on top of the board's asking premium (tender offers and blocks). */
    extraPremium: nonNeg,
    /** Price at most this share of the buyer's equity. */
    maxShareOfEquity: pos,
    /** Cash kept after the deal, in quarters of cash costs. */
    cashAfterQuarters: nonNeg,
    /** No deal above this net debt / EBITDA of the buyer. */
    maxLeverage: nonNeg,
    /** Share of the price financed by an acquisition loan (within the bank's limit)… */
    debtShare: share,
    /** …and at most this share paid in new shares (listed buyers, within their control). */
    stockShare: share,
  }),
});

const mnaSchema = z.strictObject({
  /** A holder controls a company above this share of its capital (with its group). */
  controlThreshold: z.number().min(0.5).max(1),
  /** Unlisted companies for sale ("pépites"), generated over the game. */
  listings: z.strictObject({
    /** At most this many listings at a time… */
    maxOpen: nonNegInt,
    /** …a new one arriving with this probability per quarter… */
    arrivalProbability: share,
    /** …for sale this many quarters. */
    durationQuarters: posInt,
    /** Size relative to a starting company of the sector. */
    scale: z.strictObject({ min: pos, max: pos }),
    /** Profiles of the management in place, drawn at random. */
    profiles: z.array(aiProfileId).min(1),
    /** Public estimates = actual figures × U[1 − noise, 1 + noise]. */
    estimateNoise: share,
    /** Actual performance = sector average × U[1 − spread, 1 + spread]. */
    performanceSpread: share,
    /** Asking price = valuation mid-point × (1 + U[min, max]). */
    askPremium: z.strictObject({ min: z.number(), max: z.number() }),
    /** Undeclared liability with this probability, worth U[min, max] × the asking price. */
    hiddenLiability: z.strictObject({ probability: share, min: nonNeg, max: nonNeg }),
  }),
  dueDiligence: z.strictObject({
    /** Cost = max(minCost × price level, costShareOfValue × the target's value). */
    costShareOfValue: share,
    minCost: nonNeg,
    /** Quarters the results stay valid. */
    validQuarters: posInt,
  }),
  valuation: z.strictObject({
    /** Control premium a buyer can expect to pay; controlled stakes are impaired below value × (1 + this). */
    controlPremium: nonNeg,
    /** DCF: discount rate = policy rate + equityRiskPremium. */
    equityRiskPremium: pos,
    /** Free cash flow = EBITDA × fcfShareOfEbitda; growth fades to terminalGrowth over horizonYears. */
    fcfShareOfEbitda: share,
    terminalGrowth: z.number(),
    horizonYears: posInt,
    /** The range shown spans the two methods, widened by ± rangeWidth / 2. */
    rangeWidth: share,
  }),
  financing: z.strictObject({
    /** Acquisition loan ≤ this × the target's annual EBITDA (light LBO). */
    maxDebtToEbitda: nonNeg,
    /** Extra annual spread of an acquisition loan. */
    spreadPremium: nonNeg,
  }),
  /** A controlling shareholder of a distressed company asks its sellPremium × this. */
  distressedSellFactor: share,
  /** Above this share after a tender offer, the rest is bought at the offer price and the target delisted. */
  squeezeOutThreshold: z.number().min(0.5).max(1),
  /** After a takeover: costs, talent departures and a productivity dip for `quarters` quarters. */
  integration: z.strictObject({
    quarters: nonNegInt,
    costShareOfRevenue: share,
    attritionMultiplier: z.number().min(1),
    productivityMultiplier: pos,
  }),
  /** Profile of the management running a subsidiary that its group does not decide for. */
  delegatedProfileId: aiProfileId,
  /** Tender offers kept in stock.tenderOffers. */
  dealHistory: posInt,
});

const viewsSchema = z.strictObject({
  /** Published quarters shown for each competitor. */
  competitorHistoryQuarters: posInt,
  alerts: z.strictObject({
    /** Material stock + contract deliveries below this many quarters of full-capacity need. */
    materialCoverQuarters: nonNeg,
    /** Wage below the market wage by more than this share. */
    wageGapShare: share,
    /** Net debt / EBITDA above this share of the covenant. */
    covenantNearShare: share,
    /** Units sold above this share of the line capacity. */
    capacityUtilization: share,
    /** Tech: the product lags the technology frontier by more than this. */
    techGap: nonNeg,
    /** Tech: developers off R&D maintain less than this share of the subscribers. */
    maintenanceCoverage: share,
  }),
});

const effectSchema = z.strictObject({
  /** Name of the modified quantity, interpreted by the systems. */
  key: z.enum(MODIFIER_KEYS),
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
  /** Restricts the drawn target to these ids (e.g. the energy commodity). */
  targetIds: z.array(z.string().min(1)).min(1).optional(),
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
  /**
   * One entry per AI competitor (3 to 6 per sector); the HQs of a sector's
   * competitors rotate over the regions (those of the player's sector skip
   * the player's HQ region).
   */
  aiCompetitors: z
    .array(z.strictObject({ profileId: aiProfileId, sector: sectorId }))
    .min(3)
    .max(18),
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
    sectors: z.strictObject({
      industry: industrySchema,
      agri: agriSchema.optional(),
      tech: techSchema.optional(),
    }),
    finance: financeSchema,
    stockMarket: stockMarketSchema,
    mna: mnaSchema,
    ai: aiSchema,
    views: viewsSchema,
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

    const plants: [SectorId, PlantSectorConfig][] = [['industry', cfg.sectors.industry]];
    if (cfg.sectors.agri) plants.push(['agri', cfg.sectors.agri]);
    const occupationRefs: [(string | number)[], string][] = [];
    for (const [sector, plant] of plants) {
      const at = (...path: (string | number)[]) => ['sectors', sector, ...path];
      const market = cfg.products.markets[plant.productMarketId];
      if (!market) issue(at('productMarketId'), 'unknown product market');
      else if (market.sectorId !== sector) issue(at('productMarketId'), 'market of another sector');
      for (const commodityId of Object.keys(plant.recipe)) {
        if (!(commodityId in cfg.commodities.markets)) {
          issue(at('recipe', commodityId), 'unknown commodity');
        }
      }
      occupationRefs.push(
        [at('operatorOccupationId'), plant.operatorOccupationId],
        [at('quality', 'engineerOccupationId'), plant.quality.engineerOccupationId],
        ...Object.keys(plant.supportRatios).map((o): [(string | number)[], string] => [
          at('supportRatios', o),
          o,
        ]),
        ...Object.keys(plant.startingCompany.staff).map((o): [(string | number)[], string] => [
          at('startingCompany', 'staff', o),
          o,
        ]),
      );
      if (!plant.supportRatios[plant.quality.engineerOccupationId]) {
        issue(at('supportRatios'), 'needs a ratio for the engineer occupation');
      }
      if (plant.startingCompany.lines > plant.factory.maxLines) {
        issue(at('startingCompany', 'lines'), 'exceeds factory.maxLines');
      }
      if (plant.line.initialTechLevel > plant.line.maxTechLevel) {
        issue(at('line', 'maxTechLevel'), 'below initialTechLevel');
      }
    }
    const agri = cfg.sectors.agri;
    if (agri) {
      const farm = agri.farm;
      const crop = cfg.commodities.markets[farm.cropId];
      if (!crop?.storable)
        issue(['sectors', 'agri', 'farm', 'cropId'], 'needs a storable commodity');
      const fertilizer = cfg.commodities.markets[farm.fertilizerId];
      if (!fertilizer || fertilizer.storable) {
        issue(['sectors', 'agri', 'farm', 'fertilizerId'], 'needs a non-storable commodity');
      }
      occupationRefs.push(
        [['sectors', 'agri', 'farm', 'farmhandOccupationId'], farm.farmhandOccupationId],
        [['sectors', 'agri', 'farm', 'agronomistOccupationId'], farm.agronomistOccupationId],
      );
      for (const regionId of Object.keys(farm.landByRegion)) {
        if (!(regionId in cfg.regions)) {
          issue(['sectors', 'agri', 'farm', 'landByRegion', regionId], 'unknown region');
        }
      }
      if (agri.weather.min > agri.weather.max) issue(['sectors', 'agri', 'weather'], 'min > max');
    }
    // Every sector in play needs its configuration and its stock market multiples.
    const inPlay = new Set<SectorId>([
      cfg.scenario.playerSector,
      ...cfg.scenario.aiCompetitors.map((c) => c.sector),
    ]);
    const tech = cfg.sectors.tech;
    if (tech) {
      const at = (...path: (string | number)[]) => ['sectors', 'tech', ...path];
      const market = cfg.products.markets[tech.productMarketId];
      if (!market) issue(at('productMarketId'), 'unknown product market');
      else if (market.sectorId !== 'tech') issue(at('productMarketId'), 'market of another sector');
      const cloud = cfg.commodities.markets[tech.cloudId];
      if (!cloud || cloud.storable) issue(at('cloudId'), 'needs a non-storable commodity');
      occupationRefs.push(
        [at('developerOccupationId'), tech.developerOccupationId],
        [at('seniorOccupationId'), tech.seniorOccupationId],
        [at('supportOccupationId'), tech.supportOccupationId],
        [at('productManagerOccupationId'), tech.productManagerOccupationId],
        ...Object.keys(tech.startingCompany.staff).map((o): [(string | number)[], string] => [
          at('startingCompany', 'staff', o),
          o,
        ]),
      );
      const s = tech.subscription;
      if (s.minChurn > s.maxChurn) issue(at('subscription'), 'minChurn > maxChurn');
      const start = tech.startingCompany;
      if (start.offices > tech.office.maxOffices) {
        issue(at('startingCompany', 'offices'), 'exceeds office.maxOffices');
      }
      const staff = Object.values(start.staff).reduce((sum, n) => sum + n, 0);
      if (staff > start.offices * tech.office.seats) {
        issue(at('startingCompany', 'staff'), 'more staff than seats');
      }
    }
    for (const [path, occupationId] of occupationRefs) {
      if (!(occupationId in cfg.labor.occupations)) issue(path, 'unknown occupation');
    }

    for (const sector of inPlay) {
      const configured = plants.some(([s]) => s === sector) || (sector === 'tech' && !!tech);
      if (!configured) {
        issue(['sectors', sector], 'sector in play without configuration');
      }
      if (!cfg.stockMarket.sectorMultiples[sector]) {
        issue(['stockMarket', 'sectorMultiples', sector], 'missing multiple for a sector in play');
      }
      if (!cfg.stockMarket.fundamental.salesMultiples[sector]) {
        issue(
          ['stockMarket', 'fundamental', 'salesMultiples', sector],
          'missing multiple for a sector in play',
        );
      }
      const rivals = cfg.scenario.aiCompetitors.filter((c) => c.sector === sector).length;
      if (rivals > 6) issue(['scenario', 'aiCompetitors'], `more than 6 competitors in ${sector}`);
    }

    for (const [marketId, market] of Object.entries(cfg.products.markets)) {
      const total = market.segments.reduce((sum, s) => sum + s.weight, 0);
      if (Math.abs(total - 1) > 1e-9) {
        issue(['products', 'markets', marketId, 'segments'], 'segment weights must sum to 1');
      }
    }

    const { min, max } = cfg.commodities.contractQuarters;
    if (min > max) issue(['commodities', 'contractQuarters'], 'min > max');
    if (cfg.labor.wageOfferBounds.min > cfg.labor.wageOfferBounds.max) {
      issue(['labor', 'wageOfferBounds'], 'min > max');
    }
    if (cfg.products.priceBounds.min > cfg.products.priceBounds.max) {
      issue(['products', 'priceBounds'], 'min > max');
    }

    const known: Record<string, readonly string[]> = {
      region: Object.keys(cfg.regions),
      commodity: Object.keys(cfg.commodities.markets),
      market: Object.keys(cfg.products.markets),
      laborPool: Object.keys(cfg.regions).flatMap((r) =>
        Object.keys(cfg.labor.occupations).map((o) => `${r}:${o}`),
      ),
    };
    const eventIds = new Set<string>();
    cfg.events.definitions.forEach((ev, i) => {
      if (eventIds.has(ev.id)) issue(['events', 'definitions', i, 'id'], 'duplicate event id');
      eventIds.add(ev.id);
      if (!ev.targetIds) return;
      const pool = known[ev.target];
      if (!pool) {
        issue(['events', 'definitions', i, 'targetIds'], `targetIds not allowed for ${ev.target}`);
        return;
      }
      for (const t of ev.targetIds) {
        if (!pool.includes(t)) issue(['events', 'definitions', i, 'targetIds'], `unknown ${t}`);
      }
    });

    const L = cfg.mna.listings;
    if (L.scale.min > L.scale.max) issue(['mna', 'listings', 'scale'], 'min > max');
    if (L.askPremium.min > L.askPremium.max) issue(['mna', 'listings', 'askPremium'], 'min > max');
    if (L.hiddenLiability.min > L.hiddenLiability.max) {
      issue(['mna', 'listings', 'hiddenLiability'], 'min > max');
    }
    for (const [i, profileId] of L.profiles.entries()) {
      if (!cfg.ai.profiles[profileId]) issue(['mna', 'listings', 'profiles', i], 'unknown profile');
    }
    if (!cfg.ai.profiles[cfg.mna.delegatedProfileId]) {
      issue(['mna', 'delegatedProfileId'], 'profile missing from ai.profiles');
    }
    if (cfg.stockMarket.ipo.floatShare >= 1 - cfg.mna.controlThreshold) {
      issue(['stockMarket', 'ipo', 'floatShare'], 'an offering would cost the parent its control');
    }
    if (cfg.ai.hr.fireTo > cfg.ai.hr.fireAbove) issue(['ai', 'hr'], 'fireTo > fireAbove');
    if (cfg.ai.priceWar.maxDiscount < cfg.ai.priceWar.discount) {
      issue(['ai', 'priceWar', 'maxDiscount'], 'maxDiscount < discount');
    }
  });

/** Effective, validated configuration. Copied into every GameState. */
export type GameConfig = z.infer<typeof gameConfigSchema>;
export type SectorId = (typeof SECTOR_IDS)[number];
export type AiProfileId = (typeof AI_PROFILE_IDS)[number];
export type MacroRegime = (typeof MACRO_REGIMES)[number];
export type CreditRating = (typeof CREDIT_RATINGS)[number];
export type AiProfileConfig = z.infer<typeof aiProfileSchema>;
export type PlantSectorConfig = z.infer<typeof plantSectorSchema>;
export type AgriConfig = z.infer<typeof agriSchema>;
export type TechConfig = z.infer<typeof techSchema>;
export type MnaConfig = z.infer<typeof mnaSchema>;
export type EventDefinition = z.infer<typeof eventDefinitionSchema>;
export type ModifierKey = (typeof MODIFIER_KEYS)[number];

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
