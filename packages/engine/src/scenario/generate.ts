import type { GameConfig } from '../config/schema';
import { newAiMemory } from '../ai/memory';
import { newStaff } from '../core/companies';
import { newId } from '../core/ids';
import { laborPoolKey } from '../core/keys';
import { clamp, sum } from '../core/math';
import { createRng, seedRng } from '../core/rng';
import { SCHEMA_VERSION } from '../core/version';
import type { Actor, Company, ProductionLine, Site, Staff, StockLot } from '../model/company';
import type { BalanceSheet, Statements } from '../model/finance';
import type { AiProfileId, GameMode, Id, LaborPoolKey } from '../model/ids';
import type { CommodityMarket, LaborPool, ProductMarket, Region } from '../model/markets';
import type { GameState } from '../model/state';
import { recordHistory } from '../systems/reporting/history';
import { COMPANY_NAMES, EXECUTIVE_NAMES } from './names';

export interface NewGameOptions {
  /** Integer in [0, 2^32). Same seed + same decisions ⇒ same game. */
  seed: number;
  playerName: string;
  companyName: string;
  mode?: GameMode;
  /**
   * Autopilot: the player's company is run by the AI planner with this
   * profile whenever no decisions are submitted for it (sim-cli).
   */
  playerProfileId?: AiProfileId;
}

interface Participant {
  kind: 'player' | 'ai';
  profileId?: AiProfileId;
  regionId: Id;
  actorName: string;
  companyName: string;
}

const zeroStatements = (balance: BalanceSheet): Statements => ({
  quarter: -1, // opening balance: end of the quarter before the game starts
  pnl: {
    revenue: 0,
    cogs: 0,
    wages: 0,
    marketing: 0,
    rnd: 0,
    storage: 0,
    other: 0,
    ebitda: 0,
    depreciation: 0,
    ebit: 0,
    interest: 0,
    financial: 0,
    tax: 0,
    netIncome: 0,
  },
  cashFlow: { operating: 0, investing: 0, financing: 0, netChange: 0 },
  balance,
});

/** Builds the initial world. All randomness comes from the seed. */
export function generateWorld(config: GameConfig, opts: NewGameOptions): GameState {
  if (!opts.playerName.trim() || !opts.companyName.trim()) {
    throw new Error('playerName and companyName must not be empty');
  }
  if (opts.playerProfileId && !config.ai.profiles[opts.playerProfileId]) {
    throw new Error(`Unknown AI profile ${opts.playerProfileId}`);
  }
  const rngState = seedRng(opts.seed);
  const rng = createRng(rngState);
  const { scenario } = config;
  const jitter = (x: number): number => x * (1 + scenario.initialJitter * rng.range(-1, 1));

  const state: GameState = {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      seed: opts.seed,
      rng: rngState,
      turn: 0,
      mode: opts.mode ?? 'standard',
      status: 'running',
      playerActorId: '',
      idCounters: {},
    },
    config,
    macro: {
      regime: config.macro.initialRegime,
      gdpGrowth:
        config.macro.initialRegime === 'expansion'
          ? config.macro.gdpGrowth.expansionMean
          : config.macro.gdpGrowth.recessionMean,
      inflation: config.macro.inflation.initial,
      policyRate: config.macro.policyRate.initial,
      baseRate: config.macro.policyRate.initial,
      demandIndex: 1,
      priceLevel: 1,
    },
    regions: {},
    labor: {},
    commodities: {},
    productMarkets: {},
    actors: {},
    companies: {},
    stock: {
      quotes: {},
      index: { value: 0, history: [] },
      registry: {},
      orders: [],
      tenderOffers: [],
    },
    modifiers: [],
    pendingEvents: [],
    aiMemory: {},
    log: [],
    history: { turns: [], series: {} },
  };

  // ---- regions, labor pools (wages first: companies pay them) -------------
  for (const [regionId, r] of Object.entries(config.regions)) {
    state.regions[regionId] = { id: regionId, ...r } satisfies Region;
    for (const [occupationId, occ] of Object.entries(config.labor.occupations)) {
      const marketWage = occ.baseWage * r.wageIndex;
      state.labor[laborPoolKey(regionId, occupationId)] = {
        regionId,
        occupationId,
        laborForce: Math.round(occ.baseLaborForce * r.populationWeight),
        outsideEmployment: 0, // set once company headcounts are known
        marketWage,
        tension: config.labor.targetTension,
        wageHistory: [marketWage],
      } satisfies LaborPool;
    }
  }

  // ---- commodities and product markets -----------------------------------
  for (const [commodityId, c] of Object.entries(config.commodities.markets)) {
    const worldPrice = jitter(c.basePrice * c.seasonality[0]);
    state.commodities[commodityId] = {
      id: commodityId,
      unit: c.unit,
      worldPrice,
      spotPrice: worldPrice,
      lastSimDemand: 0, // set from the companies' nominal needs below
      refDemand: 0,
    } satisfies CommodityMarket;
  }
  for (const [marketId, m] of Object.entries(config.products.markets)) {
    state.productMarkets[marketId] = {
      id: marketId,
      sectorId: m.sectorId,
      baseVolume: m.baseVolume,
      refPrice: m.refPrice,
      segments: m.segments.map((s) => ({ ...s })),
      lastResult: { shares: {}, demand: 0, allocated: {}, volume: 0, avgPrice: m.refPrice },
    } satisfies ProductMarket;
  }

  // ---- participants: player first, then AI rotating over the other regions --
  const otherRegions = Object.keys(config.regions).filter((r) => r !== scenario.playerHqRegionId);
  const companyNames = rng.shuffle(COMPANY_NAMES);
  const executiveNames = rng.shuffle(EXECUTIVE_NAMES);
  const participants: Participant[] = [
    {
      kind: 'player',
      ...(opts.playerProfileId ? { profileId: opts.playerProfileId } : {}),
      regionId: scenario.playerHqRegionId,
      actorName: opts.playerName.trim(),
      companyName: opts.companyName.trim(),
    },
    ...scenario.aiCompetitors.map((c, i): Participant => ({
      kind: 'ai',
      profileId: c.profileId,
      regionId: otherRegions[i % otherRegions.length] ?? scenario.playerHqRegionId,
      actorName: pickName(executiveNames, i, 'executive'),
      companyName: pickName(companyNames, i, 'company'),
    })),
  ];

  for (const p of participants) {
    const company = createCompany(state, p, jitter);
    const actorId = newId(state.meta, 'act');
    const actor: Actor = {
      id: actorId,
      kind: p.kind,
      name: p.actorName,
      rootCompanyId: company.id,
    };
    if (p.profileId) actor.profileId = p.profileId;
    state.actors[actorId] = actor;
    state.companies[company.id] = company;
    if (p.kind === 'player') state.meta.playerActorId = actorId;
    if (p.profileId) state.aiMemory[actorId] = newAiMemory();
    listCompany(state, company, actorId);
  }

  // ---- close the labor accounts: initial unemployment hits its target ------
  const headcounts: Partial<Record<LaborPoolKey, number>> = {};
  for (const company of Object.values(state.companies)) {
    for (const [key, staff] of Object.entries(company.workforce)) {
      headcounts[key as LaborPoolKey] = (headcounts[key as LaborPoolKey] ?? 0) + staff.headcount;
    }
  }
  for (const [key, pool] of Object.entries(state.labor)) {
    const employed = Math.round(pool.laborForce * (1 - config.labor.initialUnemploymentRate));
    const simulated = headcounts[key as LaborPoolKey] ?? 0;
    if (simulated > employed) {
      throw new Error(`Labor pool ${key} is too small for the starting companies`);
    }
    pool.outsideEmployment = employed - simulated;
  }

  // ---- commodity reference demand = nominal needs of the simulated firms ---
  const industry = config.sectors.industry;
  const nominalOutputs = Object.values(state.companies).map((c) => nominalOutput(config, c));
  for (const [commodityId, perUnit] of Object.entries(industry.recipe)) {
    const market = state.commodities[commodityId];
    if (!market) continue;
    market.refDemand = sum(nominalOutputs) * perUnit;
    market.lastSimDemand = market.refDemand;
  }

  // ---- stock market index ------------------------------------------------
  state.stock.index = {
    value: config.stockMarket.indexBase,
    history: [config.stockMarket.indexBase],
  };

  state.log.push({ turn: 0, kind: 'game_started', severity: 'info', data: { seed: opts.seed } });
  recordHistory(state);
  return state;
}

function pickName(names: readonly string[], i: number, what: string): string {
  const name = names[i % names.length];
  if (name === undefined) throw new Error(`No ${what} name available`);
  return i < names.length ? name : `${name} ${Math.floor(i / names.length) + 1}`;
}

/** Units per quarter the company can make with its lines and operators. */
function nominalOutput(config: GameConfig, company: Company): number {
  const industry = config.sectors.industry;
  const lineCapacity = sum(
    Object.values(company.sites).flatMap((s) => Object.values(s.lines).map((l) => l.capacity)),
  );
  const operators = sum(
    Object.values(company.workforce)
      .filter((s) => s.occupationId === industry.operatorOccupationId)
      .map((s) => s.headcount),
  );
  return Math.min(lineCapacity, operators * industry.operatorProductivity);
}

function createCompany(state: GameState, p: Participant, jitter: (x: number) => number): Company {
  const { config } = state;
  const industry = config.sectors.industry;
  const start = industry.startingCompany;
  const region = state.regions[p.regionId];
  if (!region) throw new Error(`Unknown region ${p.regionId}`);
  const profile = p.profileId ? config.ai.profiles[p.profileId] : undefined;
  const market = state.productMarkets[industry.productMarketId];
  if (!market) throw new Error(`Unknown product market ${industry.productMarketId}`);

  const companyId = newId(state.meta, 'co');

  // Factory with its production lines.
  const lines: Record<Id, ProductionLine> = {};
  for (let i = 0; i < start.lines; i++) {
    const lineId = newId(state.meta, 'line');
    lines[lineId] = {
      id: lineId,
      status: 'operational',
      capacity: industry.line.capacity,
      age: start.lineAgeQuarters,
      techLevel: industry.line.initialTechLevel,
      bookValue:
        industry.line.buildCost *
        Math.max(0, 1 - start.lineAgeQuarters / industry.line.depreciationQuarters),
      depreciationPerQuarter: industry.line.buildCost / industry.line.depreciationQuarters,
    };
  }
  const siteId = newId(state.meta, 'site');
  const site: Site = {
    id: siteId,
    kind: 'factory',
    regionId: region.id,
    status: 'operational',
    lines,
    buildingBookValue:
      industry.factory.buildCost *
      region.landCostIndex *
      Math.max(0, 1 - start.lineAgeQuarters / industry.factory.depreciationQuarters),
    buildingDepreciationPerQuarter:
      (industry.factory.buildCost * region.landCostIndex) / industry.factory.depreciationQuarters,
    warehouseCapacity: industry.factory.warehouseCapacity,
  };

  // Workforce in the HQ region, paid at the market wage (+ profile premium).
  const workforce: Record<string, Staff> = {};
  for (const [occupationId, headcount] of Object.entries(start.staff)) {
    if (headcount === 0) continue;
    const key = laborPoolKey(region.id, occupationId);
    const pool = state.labor[key];
    if (!pool) throw new Error(`Unknown labor pool ${key}`);
    workforce[key] = {
      ...newStaff(region.id, occupationId, pool.marketWage * (1 + (profile?.wagePremium ?? 0))),
      headcount,
    };
  }

  const quality = clamp(
    jitter(profile?.qualityTarget ?? config.scenario.playerStart.quality),
    0,
    100,
  );
  const priceIndex = profile?.startPriceIndex ?? config.scenario.playerStart.priceIndex;
  const productLineId = newId(state.meta, 'pl');

  const company: Company = {
    id: companyId,
    name: p.companyName,
    sector: config.scenario.playerSector,
    hqRegionId: region.id,
    status: 'active',
    listed: true,
    sharesOutstanding: config.stockMarket.sharesOutstanding,
    sites: { [siteId]: site },
    workforce,
    inventory: {},
    contracts: [],
    productLines: {
      [productLineId]: {
        id: productLineId,
        marketId: market.id,
        quality,
        qualityTarget: quality,
        price: jitter(market.refPrice * priceIndex),
        techLevel: 0,
      },
    },
    brand: clamp(jitter(start.brand), 0, 100),
    employerBrand: clamp(jitter(start.employerBrand), 0, 100),
    cumulativeOutput: 0,
    processLevel: 0,
    rnd: [],
    loans: [],
    credit: { rating: config.finance.initialRating, covenantBreached: false, distressQuarters: 0 },
    books: { current: zeroStatements(emptyBalance()), history: [], taxLossCarryforward: 0 },
  };

  // Opening inventories: materials and finished goods at estimated cost.
  const output = nominalOutput(config, company);
  company.cumulativeOutput = output * start.lineAgeQuarters;
  let materialCostPerUnit = 0;
  for (const [commodityId, perUnit] of Object.entries(industry.recipe)) {
    const commodity = state.commodities[commodityId];
    const commodityConfig = config.commodities.markets[commodityId];
    if (!commodity || !commodityConfig) throw new Error(`Unknown commodity ${commodityId}`);
    materialCostPerUnit += perUnit * commodity.worldPrice;
    if (commodityConfig.storable) {
      company.inventory[commodityId] = {
        qty: output * start.materialCoverQuarters * perUnit,
        avgCost: commodity.worldPrice,
      };
    }
  }
  // Finished goods are carried at their material cost (wages are period costs).
  materialCostPerUnit *= 1 + industry.qualityCostSlope * Math.max(0, quality - 50);
  company.inventory[productLineId] = {
    qty: Math.round(output * start.finishedGoodsCoverQuarters),
    avgCost: materialCostPerUnit,
  };

  // Financing: starting cash and a term loan; equity balances the sheet.
  const rating = config.finance.ratings.find((r) => r.rating === config.finance.initialRating);
  if (config.finance.startingDebt > 0) {
    company.loans.push({
      id: newId(state.meta, 'loan'),
      kind: 'term',
      principal: config.finance.startingDebt,
      spread: rating?.spread ?? 0,
      maturity: config.finance.loanTermQuarters,
    });
  }
  company.books.current = zeroStatements(openingBalance(company, config.finance.startingCash));
  return company;
}

function emptyBalance(): BalanceSheet {
  return {
    cash: 0,
    inventory: 0,
    fixedAssets: 0,
    financialAssets: 0,
    debt: 0,
    equity: 0,
    minorityInterests: 0,
  };
}

function openingBalance(company: Company, cash: number): BalanceSheet {
  const inventory = sum(Object.values(company.inventory).map((l: StockLot) => l.qty * l.avgCost));
  const fixedAssets = sum(
    Object.values(company.sites).map(
      (s) => s.buildingBookValue + sum(Object.values(s.lines).map((l) => l.bookValue)),
    ),
  );
  const debt = sum(company.loans.map((l) => l.principal));
  return {
    ...emptyBalance(),
    cash,
    inventory,
    fixedAssets,
    debt,
    equity: cash + inventory + fixedAssets - debt,
  };
}

/** Lists the company: founder stake for the actor, the rest as public float. */
function listCompany(state: GameState, company: Company, actorId: Id): void {
  const { stockMarket } = state.config;
  const shares = company.sharesOutstanding;
  const publicShares = Math.round(shares * stockMarket.initialFloat);
  state.stock.registry[company.id] = { [actorId]: shares - publicShares, public: publicShares };
  const bookPerShare = company.books.current.balance.equity / shares;
  const price = Math.max(0.01, bookPerShare * stockMarket.initialPriceToBook);
  state.stock.quotes[company.id] = {
    price,
    referencePrice: price,
    fundamental: price,
    history: [price],
    consensus: 0,
    publishedQuarter: -1,
  };
}
