import type { GameConfig } from './schema';

/**
 * Every balancing coefficient of the game. Values are starting points; they
 * are tuned with sim-cli (lot 1.5). Units: money in euros, rates annualized
 * unless stated otherwise, flows per quarter.
 */
export const defaultConfig: GameConfig = {
  time: {
    standardGameTurns: 40,
  },

  reporting: {
    logMaxEntries: 500,
    historyMaxLength: 400,
  },

  macro: {
    initialRegime: 'expansion',
    regimeTransition: { expansionToRecession: 0.06, recessionToExpansion: 0.25 },
    gdpGrowth: {
      trend: 0.015,
      expansionMean: 0.022,
      recessionMean: -0.015,
      persistence: 0.6,
      volatility: 0.004,
    },
    inflation: { target: 0.02, initial: 0.02, persistence: 0.7, volatility: 0.003 },
    policyRate: {
      neutral: 0.025,
      initial: 0.025,
      inflationWeight: 1.5,
      growthWeight: 0.5,
      smoothing: 0.7,
      floor: 0,
    },
    demand: { gapPersistence: 0.85, gdpSensitivity: 3 },
  },

  regions: {
    reg_capitale: {
      populationWeight: 1.4,
      wageIndex: 1.15,
      landCostIndex: 1.5,
      logisticsCostIndex: 0.9,
    },
    reg_nord: {
      populationWeight: 1.0,
      wageIndex: 0.95,
      landCostIndex: 0.8,
      logisticsCostIndex: 1.0,
    },
    reg_ouest: {
      populationWeight: 0.9,
      wageIndex: 0.97,
      landCostIndex: 0.9,
      logisticsCostIndex: 1.05,
    },
    reg_sud: {
      populationWeight: 0.8,
      wageIndex: 0.92,
      landCostIndex: 0.85,
      logisticsCostIndex: 1.1,
    },
  },

  labor: {
    // Simulated firms hold 15 to 40 % of each occupation's jobs at start.
    occupations: {
      occ_operator: { level: 1, sectors: ['industry'], baseWage: 7500, baseLaborForce: 1200 },
      occ_technician: { level: 2, sectors: ['industry'], baseWage: 9500, baseLaborForce: 150 },
      occ_engineer: { level: 3, sectors: ['industry'], baseWage: 14000, baseLaborForce: 50 },
      occ_sales: { level: 2, sectors: ['industry'], baseWage: 10000, baseLaborForce: 100 },
      occ_manager: { level: 4, sectors: ['industry'], baseWage: 21000, baseLaborForce: 60 },
    },
    initialUnemploymentRate: 0.07,
    targetTension: 0.4,
    wageAdjustSpeed: 0.02,
    wageAdjustMaxGap: 0.5,
    matching: { efficiency: 0.6, alpha: 0.5 },
    wageOfferElasticity: 2,
    hiringCost: 0.5,
    rampUpProductivity: 0.5,
    severanceQuarters: 1.5,
    dismissalBrandPenalty: 0.5,
    wageOfferBounds: { min: 0.6, max: 2.5 },
    employerBrand: { recovery: 0.1, wagePremiumWeight: 100, hiringElasticity: 1 },
    attrition: { baseRate: 0.03, wageSensitivity: 2, brandSensitivity: 0.5 },
    // vacancyRate ≈ targetTension·u / (1 − u): tension sits at its target at start.
    outside: { adjustSpeed: 0.25, cycleSensitivity: 1.5, vacancyRate: 0.03 },
    maxHiringShareByLevel: [1, 1, 0.1, 0.05],
    training: { costPerPerson: 4000, quarters: 2, attritionReduction: 0.3 },
    graduates: { baseRate: 0.01, wagePremiumElasticity: 1, lagQuarters: 6 },
  },

  commodities: {
    forwardPremium: 0.03,
    spotPremium: 0.02,
    contractVolumeDiscountMax: 0.05,
    contractQuarters: { min: 2, max: 8 },
    takeOrPayPenalty: 0.3,
    contractDiscountFullVolumeShare: 0.25,
    minDemandShare: 0.2,
    limitOrderTranches: 5,
    overflowStorageMultiplier: 3,
    markets: {
      com_steel: {
        unit: 't',
        basePrice: 700,
        meanReversion: 0.25,
        volatility: 0.07,
        seasonality: [1, 1, 1, 1],
        priceImpact: 0.3,
        storable: true,
        storageCostPerUnit: 8,
      },
      com_polymers: {
        unit: 't',
        basePrice: 1500,
        meanReversion: 0.25,
        volatility: 0.09,
        seasonality: [1, 1, 1, 1],
        priceImpact: 0.25,
        storable: true,
        storageCostPerUnit: 15,
      },
      com_electronics: {
        unit: 'kit',
        basePrice: 60,
        meanReversion: 0.2,
        volatility: 0.08,
        seasonality: [1, 1, 1, 1],
        priceImpact: 0.35,
        storable: true,
        storageCostPerUnit: 0.5,
      },
      com_energy: {
        unit: 'MWh',
        basePrice: 110,
        meanReversion: 0.3,
        volatility: 0.1,
        seasonality: [1.15, 0.95, 0.9, 1.0],
        priceImpact: 0.1,
        storable: false,
        storageCostPerUnit: 0,
      },
    },
  },

  products: {
    markets: {
      mkt_appliances: {
        sectorId: 'industry',
        baseVolume: 90000,
        refPrice: 320,
        priceElasticity: 1.2,
        seasonality: [0.9, 1.0, 0.95, 1.15],
        segments: [
          {
            id: 'price',
            weight: 0.6,
            betaPrice: 4,
            betaQuality: 0.02,
            betaBrand: 0.01,
            betaMarketing: 0.05,
            outsideUtility: 0,
          },
          {
            id: 'quality',
            weight: 0.4,
            betaPrice: 1.5,
            betaQuality: 0.06,
            betaBrand: 0.03,
            betaMarketing: 0.08,
            outsideUtility: 0,
          },
        ],
      },
    },
    spilloverRate: 0.3,
    spilloverRounds: 3,
    marketingUnit: 10000,
    priceBounds: { min: 0.2, max: 5 },
    brand: { decay: 0.08, marketingWeight: 1.5, qualityWeight: 0.05 },
  },

  sectors: {
    industry: {
      productMarketId: 'mkt_appliances',
      recipe: { com_steel: 0.03, com_polymers: 0.012, com_electronics: 1, com_energy: 0.15 },
      line: {
        capacity: 5000,
        buildCost: 4_000_000,
        buildQuarters: 2,
        depreciationQuarters: 40,
        modernizeCost: 1_500_000,
        initialTechLevel: 1,
        agingPenalty: 0.002,
        maintenanceCost: 25000,
      },
      factory: {
        buildCost: 6_000_000,
        buildQuarters: 3,
        depreciationQuarters: 80,
        warehouseCapacity: 60000,
        maxLines: 10,
      },
      operatorOccupationId: 'occ_operator',
      operatorProductivity: 100,
      supportRatios: { occ_technician: 0.12, occ_engineer: 0.04 },
      supportStaff: { elasticity: 0.3, maxBonus: 1.05 },
      learningRate: 0.05,
      // Roughly the cumulative output of a starting company (3 years at 25 000/quarter).
      learningReferenceOutput: 300000,
      qualityCostSlope: 0.01,
      quality: {
        engineerOccupationId: 'occ_engineer',
        base: 25,
        engineerWeight: 45,
        maxEngineerRatio: 1.5,
        techLevelWeight: 20,
        adjustSpeed: 0.5,
      },
      logisticsCostPerUnit: 8,
      finishedGoodsStorageCost: 4,
      assetResaleDiscount: 0.5,
      startingCompany: {
        lines: 5,
        lineAgeQuarters: 12,
        staff: {
          occ_operator: 250,
          occ_technician: 30,
          occ_engineer: 10,
          occ_sales: 20,
          occ_manager: 12,
        },
        materialCoverQuarters: 1,
        finishedGoodsCoverQuarters: 0.25,
        brand: 50,
        employerBrand: 50,
      },
    },
  },

  finance: {
    taxRate: 0.25,
    overdraftSpread: 0.08,
    distressQuarters: 3,
    loanTermQuarters: 20,
    ratings: [
      { rating: 'AAA', maxNetDebtToEbitda: 0.5, minInterestCoverage: 12, spread: 0.007 },
      { rating: 'AA', maxNetDebtToEbitda: 1, minInterestCoverage: 8, spread: 0.01 },
      { rating: 'A', maxNetDebtToEbitda: 1.75, minInterestCoverage: 5, spread: 0.015 },
      { rating: 'BBB', maxNetDebtToEbitda: 2.5, minInterestCoverage: 3.5, spread: 0.022 },
      { rating: 'BB', maxNetDebtToEbitda: 3.5, minInterestCoverage: 2.5, spread: 0.035 },
      { rating: 'B', maxNetDebtToEbitda: 5, minInterestCoverage: 1.5, spread: 0.055 },
      { rating: 'CCC', maxNetDebtToEbitda: 1e9, minInterestCoverage: 0, spread: 0.09 },
    ],
    covenant: { maxNetDebtToEbitda: 4, spreadPenalty: 0.03 },
    collateralLoanToValue: 0.4,
    spendingOverdraftShareOfRevenue: 0.25,
    startingCash: 6_000_000,
    startingDebt: 8_000_000,
    initialRating: 'BBB',
  },

  stockMarket: {
    sharesOutstanding: 2_000_000,
    initialFloat: 0.4,
    initialPriceToBook: 1.2,
    maxFloatPerQuarter: 0.1,
    sectorMultiples: { industry: 6 },
    priceFormation: {
      fundamentalPull: 0.3,
      marketBeta: 1,
      earningsSurprise: 0.5,
      orderImpact: 0.8,
      noise: 0.06,
    },
    indexBase: 1000,
    publicationLagQuarters: 1,
  },

  ai: {
    profiles: {
      low_cost: {
        priceMarkup: 0.12,
        qualityTarget: 40,
        startPriceIndex: 0.9,
        wagePremium: 0,
        riskAversion: 0.5,
        aggressiveness: 0.7,
        marketingShareOfRevenue: 0.02,
        rndShareOfRevenue: 0.01,
      },
      premium: {
        priceMarkup: 0.35,
        qualityTarget: 70,
        startPriceIndex: 1.15,
        wagePremium: 0.1,
        riskAversion: 0.7,
        aggressiveness: 0.3,
        marketingShareOfRevenue: 0.05,
        rndShareOfRevenue: 0.04,
      },
      opportunist: {
        priceMarkup: 0.2,
        qualityTarget: 55,
        startPriceIndex: 1,
        wagePremium: 0,
        riskAversion: 0.3,
        aggressiveness: 0.6,
        marketingShareOfRevenue: 0.03,
        rndShareOfRevenue: 0.02,
      },
    },
    targetCoverage: 0.25,
  },

  // Effects are read by the systems through MODIFIER_KEYS (config/schema.ts).
  events: {
    definitions: [
      {
        // Regional strike: output collapses for a quarter, wages are renegotiated up.
        id: 'ev_strike',
        probability: 0.04,
        conditions: {},
        target: 'region',
        effects: [
          { key: 'labor.productivity', op: 'mul', value: 0.5 },
          { key: 'labor.wageGrowth', op: 'add', value: 0.01 },
        ],
        durationQuarters: 1,
        decay: 0,
      },
      {
        // Energy crisis, worse in winter.
        id: 'ev_energy_crisis',
        probability: 0.03,
        conditions: { seasons: [0, 3] },
        target: 'commodity',
        targetIds: ['com_energy'],
        effects: [{ key: 'commodity.price', op: 'mul', value: 1.6 }],
        durationQuarters: 3,
        decay: 0.3,
      },
      {
        // Electronic components shortage: prices up, deliveries rationed.
        id: 'ev_component_shortage',
        probability: 0.03,
        conditions: { sectors: ['industry'] },
        target: 'commodity',
        targetIds: ['com_electronics'],
        effects: [
          { key: 'commodity.price', op: 'mul', value: 1.4 },
          { key: 'commodity.supply', op: 'mul', value: 0.7 },
        ],
        durationQuarters: 2,
        decay: 0,
      },
      {
        // Surprise policy rate hike, fading over a year.
        id: 'ev_rate_hike',
        probability: 0.03,
        conditions: {},
        target: 'global',
        effects: [{ key: 'macro.policyRate', op: 'add', value: 0.015 }],
        durationQuarters: 4,
        decay: 0.25,
      },
      {
        // Recession shock: forces the regime switch and hits demand at once.
        id: 'ev_recession',
        probability: 0.02,
        conditions: { regimes: ['expansion'] },
        target: 'global',
        effects: [
          { key: 'macro.expansionToRecession', op: 'add', value: 1 },
          { key: 'market.demand', op: 'mul', value: 0.95 },
        ],
        durationQuarters: 2,
        decay: 0,
      },
    ],
  },

  scenario: {
    playerSector: 'industry',
    playerHqRegionId: 'reg_capitale',
    aiCompetitors: [
      { profileId: 'low_cost' },
      { profileId: 'premium' },
      { profileId: 'opportunist' },
    ],
    initialJitter: 0.05,
    playerStart: { quality: 50, priceIndex: 1 },
  },

  victory: {
    bankruptcyEndsGame: true,
  },
};
