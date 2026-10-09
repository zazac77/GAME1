import {
  controlledCompanyIds,
  isOperating,
  newStaff,
  operationalSites,
  producingLines,
} from '../core/companies';
import { createTurnContext } from '../core/context';
import { laborPoolKey } from '../core/keys';
import { clamp, sum } from '../core/math';
import type { Company, ProductLine } from '../model/company';
import type { CompanyDecisions } from '../model/decisions';
import type { GameState } from '../model/state';
import type { CompanyPreview, DecisionPreview } from '../model/views';
import { sectorModule } from '../sectors';
import { plantConfig, sectorProductLine, techConfigOf } from '../sectors/config';
import { estimateSubscriptions } from '../sectors/tech/market';
import {
  assignedDevelopers,
  averageWage,
  cloudPerUser,
  isOffice,
  supportCoverage,
  techTeam,
} from '../sectors/tech/team';
import { mainProductLine, siteCeilings } from '../sectors/plant';
import { interestCharge, storageCost } from '../systems/accounting';
import { capexSystem } from '../systems/capex';
import { financePreSystem } from '../systems/finance';
import { unemployed } from '../systems/labor/pools';
import { nextDistribution } from '../systems/products';
import { marketShares } from '../systems/products/logit';
import { filterControlled, normalizeDecisions } from '../systems/validation';

const season = (state: GameState, marketId: string, turn: number): number =>
  state.config.products.markets[marketId]?.seasonality[((turn % 4) + 4) % 4] ?? 1;

/**
 * Demand addressed to a line this quarter, from what the player knows. After
 * the first quarter: last quarter's demand, seasonally adjusted, moved by the
 * local logit response to the own price, marketing and shelf presence
 * changes (rivals held constant). Before: full logit on the current public
 * offers (no marketing).
 */
export function estimateDemand(
  state: GameState,
  company: Company,
  line: ProductLine,
  price: number,
  marketing: number,
  listing = 0,
): number {
  const market = state.productMarkets[line.marketId];
  const marketCfg = state.config.products.markets[line.marketId];
  if (!market || !marketCfg) return 0;
  const P = state.config.products;
  const turn = state.meta.turn;
  const allocated = market.lastResult.allocated[line.id];
  const shelf = line.distribution ?? 0;
  const nextShelf =
    line.distribution === undefined ? 0 : nextDistribution(state, company, shelf, listing);
  if (turn > 0 && allocated !== undefined && market.lastResult.demand > 0) {
    const s = clamp(allocated / market.lastResult.demand, 0, 1);
    const before = company.lastDecisions?.marketing[line.id] ?? company.books.current.pnl.marketing;
    const dPrice = Math.log(price / line.price);
    const dMarketing =
      Math.log(1 + marketing / P.marketingUnit) - Math.log(1 + before / P.marketingUnit);
    const factor = sum(
      market.segments.map(
        (k) =>
          k.weight *
          Math.exp(
            (1 - s) *
              (-k.betaPrice * dPrice +
                k.betaMarketing * dMarketing +
                k.betaDistribution * (nextShelf - shelf)),
          ),
      ),
    );
    return (
      allocated * (season(state, market.id, turn) / season(state, market.id, turn - 1)) * factor
    );
  }
  const ref = market.refPrice * state.macro.priceLevel;
  const offers = Object.values(state.companies)
    .filter(isOperating)
    .flatMap((c) =>
      Object.values(c.productLines)
        .filter((l) => l.marketId === market.id)
        .map((l) => ({
          id: l.id,
          price: l.id === line.id ? price : l.price,
          quality: l.quality,
          brand: c.brand,
          marketing: l.id === line.id ? marketing : 0,
          distribution: l.id === line.id ? nextShelf : (l.distribution ?? 0),
        })),
    );
  const shares = marketShares(market.segments, offers, ref, P.marketingUnit);
  const inside = sum(shares);
  const avg = inside > 0 ? sum(offers.map((o, i) => (shares[i] ?? 0) * o.price)) / inside : ref;
  const total =
    market.baseVolume *
    season(state, market.id, turn) *
    state.macro.demandIndex *
    (avg / ref) ** -marketCfg.priceElasticity;
  const own = offers.findIndex((o) => o.id === line.id);
  return total * (shares[own] ?? 0);
}

/**
 * Deterministic estimate of the quarter for one company: financing and
 * investments go through the real systems on a copy; then expected values
 * (hires all matched within the unemployed, average attrition, materials
 * as ordered, demand from estimateDemand; tech: subscribers from
 * estimateSubscriptions). Nothing about the rivals' coming decisions is used.
 */
function previewCompany(state: GameState, companyId: string, d: CompanyDecisions): CompanyPreview {
  const draft = structuredClone(state);
  const ctx = createTurnContext(draft, [d]);
  financePreSystem.run(ctx);
  capexSystem.run(ctx);
  const company = draft.companies[companyId] as Company;
  const ledger = ctx.ledger(companyId);
  const { config } = draft;
  const L = config.labor;
  const { priceLevel } = draft.macro;
  const turn = draft.meta.turn;

  // Labor, at expected values.
  let hiring = 0;
  let severance = 0;
  let training = 0;
  for (const h of d.hr) {
    const key = laborPoolKey(h.regionId, h.occupationId);
    const pool = draft.labor[key];
    if (!pool) continue;
    const staff = (company.workforce[key] ??= newStaff(h.regionId, h.occupationId, h.wageOffer));
    const hired = Math.min(h.hire, Math.max(0, Math.floor(unemployed(state, key))));
    const quitRate = clamp(
      L.attrition.baseRate *
        (pool.marketWage / h.wageOffer) ** L.attrition.wageSensitivity *
        (1 + (L.attrition.brandSensitivity * (50 - company.employerBrand)) / 50),
      0,
      1,
    );
    const stay = staff.headcount - h.fire;
    severance += h.fire * staff.wage * L.severanceQuarters;
    hiring += hired * h.wageOffer * L.hiringCost;
    training += (h.train?.count ?? 0) * L.training.costPerPerson * priceLevel;
    staff.headcount = Math.max(0, Math.round(stay * (1 - quitRate)) + hired);
    staff.rampingUp = hired;
    staff.wage = h.wageOffer;
  }
  const staffWages = sum(Object.values(company.workforce).map((s) => s.headcount * s.wage));

  const input: SalesInput = { state, draft, company, d };
  const sales = techConfigOf(config, company.sector) ? techSales(input) : plantSales(input);
  const {
    outputCeiling,
    plannedOutput,
    materialNeeds,
    materials,
    expectedDemand,
    expectedUnitsSold,
    expectedRevenue,
    cogs,
    maintenance,
    logistics,
  } = sales;
  const marketing = sum(Object.values(d.marketing)) + sum(Object.values(d.listing));
  // Tech: the developers on R&D are booked as R&D, not wages.
  const rnd = sum(d.rnd.map((r) => r.budget)) + sales.rndWages;
  const wages = staffWages - sales.rndWages;
  const storage = storageCost(draft, company);
  const interest = interestCharge(draft, company);
  let installments = 0;
  for (const loan of company.loans) {
    if (loan.kind !== 'term') continue;
    const left = loan.maturity - turn;
    installments += left <= 1 ? loan.principal : loan.principal / left;
  }
  const other = hiring + severance + training + maintenance + logistics;
  const expectedEbitda = expectedRevenue - cogs - wages - marketing - rnd - storage - other;
  const overdraft = sum(
    company.loans.filter((l) => l.kind === 'overdraft').map((l) => l.principal),
  );
  const expectedCashEnd =
    company.books.current.balance.cash +
    ledger.borrowed -
    ledger.repaid -
    installments +
    ledger.disposals -
    ledger.capex +
    expectedRevenue -
    materials -
    wages -
    marketing -
    rnd -
    storage -
    other -
    interest -
    overdraft;

  return {
    companyId,
    outputCeiling,
    plannedOutput: Math.max(0, plannedOutput),
    materialNeeds,
    expectedDemand,
    ...(sales.expectedUsers !== undefined ? { expectedUsers: sales.expectedUsers } : {}),
    expectedUnitsSold,
    expectedRevenue,
    costs: {
      materials,
      wages,
      hiring,
      severance,
      training,
      marketing,
      rnd,
      maintenance,
      logistics,
      storage,
      interest,
    },
    capex: ledger.capex,
    disposals: ledger.disposals,
    borrowing: ledger.borrowed,
    repayment: ledger.repaid,
    installments,
    expectedEbitda,
    expectedCashEnd,
    overdraftRisk: expectedCashEnd < 0,
  };
}

interface SalesInput {
  /** State at the start of the quarter (what the player knows). */
  state: GameState;
  /** Copy after financing, investments and the expected labor flows. */
  draft: GameState;
  company: Company;
  d: CompanyDecisions;
}

interface SalesEstimate {
  outputCeiling: number;
  plannedOutput: number;
  materialNeeds: Record<string, number>;
  materials: number;
  expectedDemand: number;
  expectedUsers?: number;
  expectedUnitsSold: number;
  expectedRevenue: number;
  cogs: number;
  maintenance: number;
  logistics: number;
  /** Wages of the developers on R&D (tech). */
  rndWages: number;
}

/** Units and cost of the contracts delivering a commodity this quarter (in force and new). */
function contractedSupply(
  draft: GameState,
  company: Company,
  d: CompanyDecisions,
  commodityId: string,
): { qty: number; cost: number } {
  const turn = draft.meta.turn;
  const contracts = company.contracts.filter(
    (k) => k.commodityId === commodityId && k.startsAt <= turn && turn < k.endsAt,
  );
  const fresh = d.purchasing.newContracts.filter((c) => c.commodityId === commodityId);
  const forward =
    (draft.commodities[commodityId]?.worldPrice ?? 0) *
    (1 + draft.config.commodities.forwardPremium);
  return {
    qty: sum(contracts.map((k) => k.qtyPerQuarter)) + sum(fresh.map((c) => c.qtyPerQuarter)),
    cost:
      sum(contracts.map((k) => k.qtyPerQuarter * k.price)) +
      sum(fresh.map((c) => c.qtyPerQuarter * forward)),
  };
}

/** Cost of a non-storable need: contracts first, the rest at spot. */
function nonStorableCost(
  draft: GameState,
  company: Company,
  d: CompanyDecisions,
  commodityId: string,
  need: number,
): number {
  const spot =
    (draft.commodities[commodityId]?.spotPrice ?? 0) * (1 + draft.config.commodities.spotPremium);
  const contracted = contractedSupply(draft, company, d, commodityId);
  return contracted.cost + Math.max(0, need - contracted.qty) * spot;
}

/** Plants: production within the crew, the lines and the materials at hand, then sales from stock. */
function plantSales({ state, draft, company, d }: SalesInput): SalesEstimate {
  const { config } = draft;
  const { priceLevel } = draft.macro;
  const line = mainProductLine(draft, company);
  const outputCeiling = Math.floor(sum(siteCeilings(draft, company).map((c) => c.ceiling)));
  const module = sectorModule(company.sector);
  let plannedOutput = module?.plannedOutput(draft, company, d) ?? 0;
  const targetOutput = plannedOutput;
  const materialNeeds: Record<string, number> = {};
  let materials = 0;
  const commodities = config.commodities;
  if (line) {
    const qualityTarget = d.pricing[line.id]?.qualityTarget;
    if (qualityTarget !== undefined) line.qualityTarget = qualityTarget;
    const perUnit = module?.materialsPerUnit(draft, company, line) ?? {};
    // Inputs the sector consumes on its own (fertilizer at the harvest): bought at consumption.
    for (const [commodityId, qty] of Object.entries(
      module?.plannedInputs(draft, company, d) ?? {},
    )) {
      const market = draft.commodities[commodityId];
      if (!market || commodityId in perUnit || qty <= 0) continue;
      materialNeeds[commodityId] = qty;
      materials += qty * market.spotPrice * (1 + commodities.spotPremium);
    }
    for (const [commodityId, q] of Object.entries(perUnit)) {
      const market = draft.commodities[commodityId];
      const spec = commodities.markets[commodityId];
      if (!market || !spec || q <= 0) continue;
      materialNeeds[commodityId] = targetOutput * q;
      if (!spec.storable) {
        materials += nonStorableCost(draft, company, d, commodityId, plannedOutput * q);
        continue;
      }
      const contracted = contractedSupply(draft, company, d, commodityId);
      const spot = sum(
        d.purchasing.spot.filter((o) => o.commodityId === commodityId).map((o) => o.qty),
      );
      materials += contracted.cost + spot * market.spotPrice * (1 + commodities.spotPremium);
      const available = (company.inventory[commodityId]?.qty ?? 0) + contracted.qty + spot;
      plannedOutput = Math.min(plannedOutput, Math.floor(available / q));
    }
  }

  const price = line ? (d.pricing[line.id]?.price ?? line.price) : 0;
  const expectedDemand = line
    ? estimateDemand(
        state,
        state.companies[company.id] as Company,
        line,
        price,
        d.marketing[line.id] ?? 0,
        d.listing[line.id] ?? 0,
      )
    : 0;
  const lot = line ? company.inventory[line.id] : undefined;
  const expectedUnitsSold = Math.min(expectedDemand, (lot?.qty ?? 0) + plannedOutput);
  const cfg = plantConfig(config, company.sector);
  const producing = operationalSites(company).flatMap(producingLines).length;
  return {
    outputCeiling,
    plannedOutput: Math.max(0, plannedOutput),
    materialNeeds,
    materials,
    expectedDemand,
    expectedUnitsSold,
    expectedRevenue: expectedUnitsSold * price,
    cogs: expectedUnitsSold * (lot?.avgCost ?? 0),
    maintenance: producing * cfg.line.maintenanceCost * priceLevel,
    logistics:
      expectedUnitsSold *
      cfg.logisticsCostPerUnit *
      (draft.regions[company.hqRegionId]?.logisticsCostIndex ?? 1) *
      priceLevel,
    rndWages: 0,
  };
}

/**
 * Tech: subscribers from estimateSubscriptions (support coverage of the
 * expected team), cloud for the billed subscribers (a cost of sales), office
 * upkeep; the developers put on R&D are expensed as R&D.
 */
function techSales({ state, draft, company, d }: SalesInput): SalesEstimate {
  const { config } = draft;
  const tech = techConfigOf(config, company.sector);
  const line = sectorProductLine(config, company);
  const empty: SalesEstimate = {
    outputCeiling: 0,
    plannedOutput: 0,
    materialNeeds: {},
    materials: 0,
    expectedDemand: 0,
    expectedUnitsSold: 0,
    expectedRevenue: 0,
    cogs: 0,
    maintenance: 0,
    logistics: 0,
    rndWages: 0,
  };
  if (!tech || !line) return empty;
  const team = techTeam(config, tech, company, assignedDevelopers(d));
  const price = d.pricing[line.id]?.price ?? line.price;
  const estimate = estimateSubscriptions(
    state,
    state.companies[company.id] as Company,
    line,
    price,
    d.marketing[line.id] ?? 0,
    supportCoverage(tech, team, line.users ?? 0),
  );
  const need = estimate.billed * cloudPerUser(tech, company.processLevel);
  const materials = nonStorableCost(draft, company, d, tech.cloudId, need);
  const offices = operationalSites(company).filter(isOffice).length;
  return {
    outputCeiling: estimate.billed,
    plannedOutput: estimate.billed,
    materialNeeds: { [tech.cloudId]: need },
    materials,
    expectedDemand: estimate.billed,
    expectedUsers: estimate.users,
    expectedUnitsSold: estimate.billed,
    expectedRevenue: estimate.billed * price,
    cogs: materials,
    maintenance: offices * tech.office.upkeep * draft.macro.priceLevel,
    logistics: 0,
    rndWages: team.rndDevelopers * averageWage(company, tech.developerOccupationId),
  };
}

/** Estimates (without randomness) of the quarter under the player's decisions (public API). */
export function previewDecisions(
  state: GameState,
  decisions: readonly CompanyDecisions[],
): DecisionPreview {
  const actorId = state.meta.playerActorId;
  const { kept, issues } = filterControlled(state, actorId, decisions);
  const companies: DecisionPreview['companies'] = {};
  const own = controlledCompanyIds(state, actorId);
  for (const d of kept) {
    const company = state.companies[d.companyId];
    if (!company || !own.has(company.id)) continue;
    const normalized = normalizeDecisions(state, company, d);
    issues.push(...normalized.issues);
    if (isOperating(company)) {
      companies[company.id] = previewCompany(state, company.id, normalized.decisions);
    }
  }
  return { issues, companies };
}
