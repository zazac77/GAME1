import type { TechConfig } from '../../config/schema';
import { laborPoolKey } from '../../core/keys';
import { clamp, sum } from '../../core/math';
import type { RndType } from '../../model/company';
import type { Id } from '../../model/ids';
import { techConfigOf } from '../../sectors/config';
import { canStartTechProject, maxDevelopersFor, techProjectEffort } from '../../sectors/tech/rnd';
import {
  averageWage,
  cloudPerUser,
  developerEfficiency,
  isOffice,
  officeCost,
  techTeam,
} from '../../sectors/tech/team';
import { ownLeverage } from './capex';
import { forecastCommodityPrices } from './forecast';
import { staffTo, updateWageBoosts } from './hiring';
import type { Plan } from './plan';
import { priceWar } from './priceWar';

// Planner modules of a SaaS company: a "unit" is a subscriber billed for a quarter.

function techOf(plan: Plan): TechConfig {
  const cfg = techConfigOf(plan.config, plan.company.sector);
  if (!cfg) throw new Error(`Sector ${plan.company.sector} has no tech configuration`);
  return cfg;
}

/**
 * 1. Forecast: new subscribers by exponential smoothing (deseasonalized),
 * last quarter's churn; subscribers billed this quarter and next quarter,
 * subscribers to staff for; commodity world prices.
 */
export function techForecast(plan: Plan): void {
  const { obs, config, memory, market, line } = plan;
  const cfg = techOf(plan);
  const a = config.ai.forecastSmoothing;
  const seasonality = config.products.markets[market.id]?.seasonality ?? [1, 1, 1, 1];
  const season = (turn: number) => seasonality[((turn % 4) + 4) % 4] ?? 1;

  const users = line.users ?? 0;
  const acquired = line.acquired ?? users * cfg.subscription.baseChurn;
  if (obs.turn > 0 && memory.demandForecast >= 0) {
    const observed = acquired / season(obs.turn - 1);
    memory.demandForecast += a * (observed - memory.demandForecast);
  } else if (memory.demandForecast < 0) {
    memory.demandForecast = acquired / season(obs.turn - 1);
  }
  const churn = line.churn ?? cfg.subscription.baseChurn;
  const next = users * (1 - churn) + memory.demandForecast * season(obs.turn);
  const after = next * (1 - churn) + memory.demandForecast * season(obs.turn + 1);
  plan.forecast = (users + next) / 2;
  plan.nextForecast = (next + after) / 2;
  plan.output = plan.forecast;
  plan.staffedOutput = Math.max(users, next, after);
  plan.perUnit = { [cfg.cloudId]: cloudPerUser(cfg, plan.company.processLevel) };
  forecastCommodityPrices(plan);
}

/**
 * 4. Staffing and R&D: developers to maintain the expected subscribers
 * (× ai.tech.staffingCover) plus rndShareOfRevenue of the expected revenue
 * in developers, split by rndProcessShare, plus a catch-up budget on product
 * releases when the product lags the frontier, within the EBITDA margin
 * (staffed for projects at full pace; this quarter's assignment within what
 * the projects absorb, never at the expense of maintenance); seniors at the
 * ratio the profile's quality calls for, support by subscribers, product
 * managers by developers, the other occupations as in the starting
 * structure; quality and product releases raised by a counter-launch.
 * Needs are spread over the regions with offices by seats.
 */
export function techStaffing(plan: Plan): void {
  const { obs, config, profile, company, market, line } = plan;
  const cfg = techOf(plan);
  updateWageBoosts(plan);
  const pool = (occupationId: Id) => obs.labor[laborPoolKey(company.hqRegionId, occupationId)];

  const T = config.ai.tech;
  const users = plan.staffedOutput * T.staffingCover;
  const maintainers = Math.ceil(users / cfg.usersPerDeveloper - 1e-9);
  const wage = Math.max(
    1,
    averageWage(company, cfg.developerOccupationId) ||
      (pool(cfg.developerOccupationId)?.marketWage ?? 1),
  );
  const revenue = plan.forecast * line.price;
  const gap = (market.techFrontier ?? 0) - (line.techLevel ?? 0);
  // Catching up is paid out of the operating margin, never on credit.
  const { pnl } = company.books.current;
  const margin = pnl.revenue > 0 ? pnl.ebitda / pnl.revenue : 0;
  const catchUp = Math.max(
    0,
    Math.min(
      T.maxRndShare - profile.rndShareOfRevenue,
      T.catchUpPerGap * Math.max(0, gap - T.gapTolerance),
      margin,
    ),
  );
  const planned = Math.floor((profile.rndShareOfRevenue * revenue) / wage);
  const product = Math.round(planned * (1 - profile.rndProcessShare));

  // What the current team can put on R&D without starving maintenance.
  const team = techTeam(config, cfg, company, 0);
  const efficiency = developerEfficiency(cfg, team);
  const maintainedNow = Math.ceil((line.users ?? 0) / cfg.usersPerDeveloper - 1e-9);
  let spare = Math.max(0, Math.floor(team.developers + 1e-9) - maintainedNow);
  const rndDevelopers: Record<RndType, number> = { process: 0, product: 0 };
  const split: Record<RndType, number> = {
    // A counter-launch adds developers on the product release.
    product:
      Math.round(product * (1 + plan.tactics.rndBoost)) + Math.floor((catchUp * revenue) / wage),
    process: planned - product,
  };
  for (const type of ['product', 'process'] as const) {
    const current = company.rnd.find((p) => p.type === type);
    if (!current && !canStartTechProject(cfg, type, company.processLevel)) {
      split[type] = 0;
      continue;
    }
    // Staffed for a project at full pace; this quarter's project may absorb less.
    const fresh = techProjectEffort(cfg, type, company.processLevel);
    split[type] = Math.min(split[type], maxDevelopersFor(cfg, fresh, 0, efficiency));
    const effort = current?.effort ?? fresh;
    const cap = maxDevelopersFor(cfg, effort, current?.progress ?? 0, efficiency);
    rndDevelopers[type] = Math.min(split[type], cap, spare);
    spare -= rndDevelopers[type];
  }

  const developers = maintainers + split.product + split.process;
  const q = cfg.quality;
  const seniorRatio = clamp(
    (plan.tactics.qualityTarget - q.base - cfg.rnd.process.qualityPerLevel * company.processLevel) /
      Math.max(1e-9, q.seniorWeight),
    0.5,
    q.maxSeniorRatio,
  );
  const start = cfg.startingCompany.staff;
  const startDevelopers = start[cfg.developerOccupationId] ?? 0;
  const byOccupation: Record<Id, number> = {};
  for (const [occupationId, occupation] of Object.entries(config.labor.occupations)) {
    if (!occupation.sectors.includes('tech')) continue;
    let need: number;
    if (occupationId === cfg.developerOccupationId) need = developers;
    else if (occupationId === cfg.seniorOccupationId) {
      need = Math.ceil(developers * cfg.seniorRatio * seniorRatio);
    } else if (occupationId === cfg.supportOccupationId) {
      need = Math.ceil(users / cfg.usersPerSupport - 1e-9);
    } else if (occupationId === cfg.productManagerOccupationId) {
      need = Math.ceil(developers * cfg.productManagerRatio);
    } else {
      need =
        startDevelopers > 0
          ? Math.ceil((developers * (start[occupationId] ?? 0)) / startDevelopers)
          : 0;
    }
    byOccupation[occupationId] = need;
  }

  // Spread over the regions with offices (in service or being fitted out), by seats.
  const seats: Record<Id, number> = {};
  for (const site of Object.values(company.sites)) {
    if (isOffice(site)) seats[site.regionId] = (seats[site.regionId] ?? 0) + (site.seats ?? 0);
  }
  if (Object.keys(seats).length === 0) seats[company.hqRegionId] = 1;
  const totalSeats = sum(Object.values(seats));
  const needs: Record<string, number> = {};
  for (const [regionId, s] of Object.entries(seats)) {
    for (const [occupationId, need] of Object.entries(byOccupation)) {
      needs[laborPoolKey(regionId, occupationId)] = Math.ceil((need * s) / totalSeats - 1e-9);
    }
  }
  staffTo(plan, needs);
  plan.tech = { rndDevelopers, headcount: sum(Object.values(byOccupation)) };
}

/**
 * 3. Price: full cost per billed subscriber × profile markup, like the
 * plants: cloud plus the wages (R&D developers excepted), offices,
 * depreciation and interest spread over at least costingUtilization of the
 * subscribers the maintenance team can serve (a shrinking base does not
 * raise the price: no death spiral), marketing and R&D taken out of the
 * revenue; blended geometrically with the rivals' average price ×
 * positioning; price war and predatory discounts; lowered by (base churn / own churn)^
 * churnPriceResponse when subscribers leave a dearer-than-average product
 * faster than usual; never below
 * the cloud cost floor; at most ai.maxPriceChange a quarter.
 */
export function techPricing(plan: Plan): void {
  const { obs, config, profile, company, market, line } = plan;
  const cfg = techOf(plan);
  const discount = priceWar(plan);
  const { priceLevel } = obs.macro;
  const cloud = sum(
    Object.entries(plan.perUnit).map(
      ([id, q]) =>
        q *
        (plan.memory.priceForecast[id] ?? obs.commodities[id]?.spotPrice ?? 0) *
        (1 + config.commodities.spotPremium),
    ),
  );
  plan.variableCost = cloud;
  const team = techTeam(config, cfg, company, 0);
  const rndDevelopers = sum(Object.values(plan.tech?.rndDevelopers ?? {}));
  const serviceable = Math.max(0, team.developers - rndDevelopers) * cfg.usersPerDeveloper;
  const volume = Math.max(1, plan.forecast, config.ai.costingUtilization * serviceable);
  const wages = sum(Object.values(company.workforce).map((s) => s.headcount * s.wage));
  const rndWages = rndDevelopers * averageWage(company, cfg.developerOccupationId);
  const offices = Object.values(company.sites).filter(
    (s) => isOffice(s) && s.status === 'operational',
  ).length;
  const upkeep = offices * cfg.office.upkeep * priceLevel;
  const { depreciation, interest } = company.books.current.pnl;
  const fullCost = cloud + (wages - rndWages + upkeep + depreciation + interest) / volume;
  const costPrice =
    (fullCost * (1 + profile.priceMarkup)) /
    Math.max(0.5, 1 - profile.marketingShareOfRevenue - profile.rndShareOfRevenue);
  plan.quarterlyCashCosts = wages + upkeep + interest + cloud * plan.forecast;

  const rivals = obs.competitors
    .filter((c) => c.status === 'active' || c.status === 'distressed')
    .flatMap((c) => c.products.filter((p) => p.marketId === market.id).map((p) => p.price));
  const ref = market.refPrice * priceLevel;
  const average = rivals.length > 0 ? sum(rivals) / rivals.length : ref;
  const w = profile.competitorPriceWeight;
  let target = Math.exp(
    (1 - w) * Math.log(costPrice) + w * Math.log(average * profile.startPriceIndex),
  );
  target *= 1 - discount;
  // Subscribers leaving faster than usual from a dearer product: the price comes down.
  const churn = line.churn ?? cfg.subscription.baseChurn;
  if (line.price > average) {
    target *= Math.min(
      1,
      (cfg.subscription.baseChurn / Math.max(1e-9, churn)) ** config.ai.tech.churnPriceResponse,
    );
  }

  const m = config.ai.maxPriceChange;
  const { min, max } = config.products.priceBounds;
  const floor = cloud * config.ai.priceFloorOverVariableCost;
  plan.price = clamp(
    Math.max(floor, clamp(target, line.price * (1 - m), line.price * (1 + m))),
    min * ref,
    max * ref,
  );
  plan.decisions.pricing[line.id] = { price: plan.price };
}

/**
 * 6. Capex: opens an office in the HQ region when the headcount needed
 * exceeds expandUtilization of the seats, cash and leverage permitting.
 */
export function techCapex(plan: Plan): void {
  const { obs, config, profile, company } = plan;
  const cfg = techOf(plan);
  const A = config.ai.capex;
  const offices = Object.values(company.sites).filter(isOffice);
  if (offices.some((s) => s.status !== 'operational')) return;
  if (offices.length >= cfg.office.maxOffices) return;
  const seats = sum(offices.map((s) => s.seats ?? 0));
  if ((plan.tech?.headcount ?? 0) <= A.expandUtilization * seats) return;
  if (ownLeverage(plan) > A.maxLeverage) return;
  const land = obs.regions[company.hqRegionId]?.landCostIndex ?? 1;
  const cost = officeCost(cfg, land, obs.macro.priceLevel);
  const cash = company.books.current.balance.cash;
  const buffer = A.cashAfterQuarters * (1 + profile.riskAversion) * plan.quarterlyCashCosts;
  if (cash + obs.self.borrowingCapacity - cost < buffer) return;
  plan.decisions.capex.push({ kind: 'build_site', regionId: company.hqRegionId });
  plan.spend.capex += cost;
}

/** 7b. R&D: the developers planned by techStaffing, on their projects (no cash budget). */
export function techRnd(plan: Plan): void {
  for (const type of ['product', 'process'] as const) {
    const developers = plan.tech?.rndDevelopers[type] ?? 0;
    if (developers > 0) plan.decisions.rnd.push({ type, budget: 0, developers });
  }
}
