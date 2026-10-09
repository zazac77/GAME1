import { laborPoolKey } from '../../core/keys';
import { clamp } from '../../core/math';
import type { HrDecision } from '../../model/decisions';
import type { Id, LaborPoolKey } from '../../model/ids';
import { agriConfigOf, plantConfig } from '../../sectors/config';
import type { Plan } from './plan';
import { lastEbitdaMargin } from './rivals';

/** Wage premium of the profile for an occupation (skilled talent gets skilledWagePremium on top). */
export function wagePremiumOf(plan: Plan, occupationId: Id): number {
  const { config, profile } = plan;
  const level = config.labor.occupations[occupationId]?.level ?? 1;
  return (
    profile.wagePremium +
    (level >= config.ai.wageOutbid.skilledLevel ? profile.skilledWagePremium : 0)
  );
}

/** Highest public job offer of an operating rival in a labor pool. */
function bestRivalOffer(
  plan: Plan,
  regionId: Id,
  occupationId: Id,
): { rivalId: Id; wage: number } | undefined {
  let best: { rivalId: Id; wage: number } | undefined;
  for (const c of plan.obs.competitors) {
    if (c.status !== 'active' && c.status !== 'distressed') continue;
    for (const o of c.jobOffers) {
      if (o.regionId !== regionId || o.occupationId !== occupationId) continue;
      if (!best || o.wage > best.wage) best = { rivalId: c.companyId, wage: o.wage };
    }
  }
  return best;
}

/**
 * Wage outbidding: a group that loses people faster than usual, or does not
 * get the hires it asked for, raises its boost by `step`; when a rival's
 * public job offer in the same pool beats the own offer, the boost goes at
 * once to that offer + step, with a grudge against the poacher (public
 * news, at most every cooldownQuarters per rival). Capped at the profile's wageOutbidMax; no raise while the last
 * EBITDA margin is below minMargin. Otherwise the boost fades by `decay`.
 */
export function updateWageBoosts(plan: Plan): void {
  const { obs, config, profile, company, memory } = plan;
  const W = config.ai.wageOutbid;
  const base = config.labor.attrition.baseRate;
  const margin = lastEbitdaMargin(plan);
  const affordable = margin === undefined || margin >= W.minMargin;
  const boosts: typeof memory.wageBoost = {};
  const poached: Record<Id, LaborPoolKey[]> = {};
  for (const key of Object.keys(company.workforce).sort() as LaborPoolKey[]) {
    const staff = company.workforce[key];
    if (!staff) continue;
    const f = staff.lastQuarter;
    const start = staff.headcount + f.quits + f.dismissed - f.hired;
    const quitRate = start > 0 ? f.quits / start : 0;
    const shortfall = f.requested > 0 ? 1 - f.hired / f.requested : 0;
    const pressure = quitRate > base * W.attritionTrigger || shortfall > W.hiringShortfallTrigger;
    const boost = memory.wageBoost[key] ?? 0;
    let next = boost - W.decay;
    let poacher: Id | undefined;
    if (pressure && affordable) {
      next = boost + W.step;
      const pool = obs.labor[key];
      const premium = wagePremiumOf(plan, staff.occupationId);
      const best = bestRivalOffer(plan, staff.regionId, staff.occupationId);
      if (pool && best && best.wage > pool.marketWage * (1 + premium + boost)) {
        next = Math.max(next, best.wage / pool.marketWage - 1 - premium + W.step);
        poacher = best.rivalId;
      }
    }
    next = clamp(next, 0, profile.wageOutbidMax);
    if (next > 0) boosts[key] = next;
    if (poacher && next > boost + 1e-9) (poached[poacher] ??= []).push(key);
  }
  memory.wageBoost = boosts;
  for (const rivalId of Object.keys(poached).sort()) {
    const rival = (memory.rivals[rivalId] ??= { grudge: 0, weakQuarters: 0 });
    if (rival.lastOutbidAt !== undefined && obs.turn - rival.lastOutbidAt < W.cooldownQuarters) {
      continue;
    }
    rival.lastOutbidAt = obs.turn;
    rival.grudge = Math.min(1, rival.grudge + W.poachGrudge);
    const staff = company.workforce[(poached[rivalId] ?? [])[0] as LaborPoolKey];
    plan.signals.push({
      kind: 'ai_wage_outbid',
      rivalId,
      data: { regionId: staff?.regionId ?? '', occupationId: staff?.occupationId ?? '' },
    });
  }
}

/**
 * 4. Human resources: headcounts derived from the production plan (operators
 * from the productivity, support staff from the sector ratios, engineers
 * from the quality aimed at, overhead from the starting structure, farm
 * staff from the hectares), hires
 * covering the expected attrition, dismissals beyond a tolerance. Wage offer
 * = market wage × (1 + profile premium + outbidding boost).
 */
export function hiring(plan: Plan): void {
  const { obs, config, company } = plan;
  const cfg = plantConfig(config, company.sector);
  const farm = agriConfigOf(config, company.sector)?.farm;
  const L = config.labor;
  updateWageBoosts(plan);

  // Staffing is sized on the larger of this and next quarter's needs, within the lines.
  const pendingCapacity = Object.values(company.sites)
    .flatMap((s) => Object.values(s.lines))
    .filter((l) => l.status !== 'operational' && (l.completesAt ?? Infinity) <= obs.turn + 1)
    .reduce((s, l) => s + l.capacity, 0);
  const lineCapacity = obs.self.sites.reduce((s, x) => s + x.capacity, 0) + pendingCapacity;
  plan.staffedOutput = Math.min(
    lineCapacity,
    Math.max(plan.output, plan.nextForecast * (1 + config.ai.targetCoverage)),
  );

  const regions: Record<Id, number> = {};
  for (const site of obs.self.sites) {
    regions[site.regionId] =
      (regions[site.regionId] ?? 0) + site.capacity + site.pendingLines * cfg.line.capacity;
  }
  const regionTotal = Object.values(regions).reduce((s, x) => s + x, 0);
  // Farm staff per hectare (farms in service or set up by next quarter).
  const hectares: Record<Id, number> = {};
  const farmRatios: Record<Id, number> = {};
  if (farm) {
    farmRatios[farm.farmhandOccupationId] = farm.farmhandsPerHectare;
    farmRatios[farm.agronomistOccupationId] = farm.agronomistsPerHectare;
    for (const site of Object.values(company.sites)) {
      if (site.kind !== 'farm') continue;
      if (site.status !== 'operational' && (site.completesAt ?? Infinity) > obs.turn + 1) continue;
      hectares[site.regionId] = (hectares[site.regionId] ?? 0) + (site.hectares ?? 0);
    }
  }
  const startOperators = cfg.startingCompany.staff[cfg.operatorOccupationId] ?? 0;
  const q = cfg.quality;
  const producing = Object.values(company.sites)
    .filter((s) => s.status === 'operational')
    .flatMap((s) => Object.values(s.lines))
    .filter((l) => l.status === 'operational');
  const techLevel =
    producing.length > 0
      ? producing.reduce((s, l) => s + l.techLevel, 0) / producing.length
      : cfg.line.initialTechLevel;
  // Engineers are also support staff (productivity): never below their target ratio.
  const engineerRatio = clamp(
    (plan.tactics.qualityTarget - q.base - q.techLevelWeight * (techLevel - 1)) /
      Math.max(1e-9, q.engineerWeight),
    1,
    Math.max(1, q.maxEngineerRatio),
  );

  const needs: Record<string, number> = {};
  for (const [regionId, capacity] of Object.entries(regions)) {
    const share = regionTotal > 0 ? capacity / regionTotal : 0;
    const productivity = obs.self.operatorProductivity[regionId] || cfg.operatorProductivity;
    const operators = Math.ceil((plan.staffedOutput * share) / Math.max(1e-9, productivity));
    const sector = company.sector;
    for (const [occupationId, occupation] of Object.entries(L.occupations)) {
      if (sector === 'holding' || !occupation.sectors.includes(sector)) continue;
      let need: number;
      if (farmRatios[occupationId] !== undefined) {
        need = Math.ceil((hectares[regionId] ?? 0) * farmRatios[occupationId] - 1e-9);
      } else if (occupationId === cfg.operatorOccupationId) need = operators;
      else if (occupationId === q.engineerOccupationId) {
        need = Math.ceil(operators * (cfg.supportRatios[occupationId] ?? 0) * engineerRatio);
      } else if (cfg.supportRatios[occupationId] !== undefined) {
        need = Math.ceil(operators * (cfg.supportRatios[occupationId] ?? 0));
      } else {
        const start = cfg.startingCompany.staff[occupationId] ?? 0;
        need = startOperators > 0 ? Math.ceil((operators * start) / startOperators) : 0;
      }
      needs[laborPoolKey(regionId, occupationId)] = need;
    }
  }
  staffTo(plan, needs);
}

/**
 * Hires and dismissals towards the headcount needed by labor pool: hires
 * cover the expected attrition, dismissals beyond a tolerance; staff left
 * in a pool without need (a region without site) is let go. Wage offer =
 * market wage × (1 + profile premium (skilled talent: more) + outbidding boost).
 */
export function staffTo(plan: Plan, needs: Record<string, number>): void {
  const { obs, config, company, memory } = plan;
  const L = config.labor;
  for (const key of Object.keys(company.workforce)) needs[key] ??= 0;

  for (const key of Object.keys(needs).sort()) {
    const pool = obs.labor[key as keyof typeof obs.labor];
    if (!pool) continue;
    const need = needs[key] ?? 0;
    const staff = company.workforce[key as keyof typeof company.workforce];
    const headcount = staff?.headcount ?? 0;
    const boost = memory.wageBoost[key as keyof typeof memory.wageBoost] ?? 0;
    const entry: HrDecision = {
      regionId: pool.regionId,
      occupationId: pool.occupationId,
      hire: 0,
      fire: 0,
      wageOffer: pool.marketWage * (1 + wagePremiumOf(plan, pool.occupationId) + boost),
    };
    const expectedQuits = Math.round(headcount * L.attrition.baseRate);
    if (need > 0 && headcount - expectedQuits < need) {
      entry.hire = need - headcount + expectedQuits;
    } else if (headcount > need * config.ai.hr.fireAbove) {
      entry.fire = headcount - Math.ceil(need * config.ai.hr.fireTo);
    }
    if (entry.hire > 0 || entry.fire > 0 || staff) plan.decisions.hr.push(entry);
  }
}
