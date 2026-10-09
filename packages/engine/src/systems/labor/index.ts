import type { TurnContext } from '../../core/context';
import {
  emptyFlows,
  newStaff,
  operatingCompanies,
  stochasticRound,
  trainees,
} from '../../core/companies';
import { laborPoolKey } from '../../core/keys';
import { clamp, sum } from '../../core/math';
import { applyModifiers } from '../../core/modifiers';
import type { System } from '../../core/system';
import type { Company, Staff } from '../../model/company';
import type { Id, LaborPoolKey } from '../../model/ids';
import { simulatedEmployment, unemployed } from './pools';

/**
 * Splits `total` integer hires between requests, proportionally to the
 * weights and never above a request (water-filling, then largest remainder).
 */
export function allocateHires(total: number, requests: number[], weights: number[]): number[] {
  const alloc = requests.map(() => 0);
  let remaining = total;
  let active = requests
    .map((_, i) => i)
    .filter((i) => (requests[i] ?? 0) > 0 && (weights[i] ?? 0) > 0);
  while (remaining > 1e-9 && active.length > 0) {
    const w = sum(active.map((i) => weights[i] ?? 0));
    const capped = active.filter(
      (i) => (alloc[i] ?? 0) + (remaining * (weights[i] ?? 0)) / w >= (requests[i] ?? 0),
    );
    if (capped.length === 0) {
      for (const i of active) alloc[i] = (alloc[i] ?? 0) + (remaining * (weights[i] ?? 0)) / w;
      remaining = 0;
    } else {
      for (const i of capped) {
        remaining -= (requests[i] ?? 0) - (alloc[i] ?? 0);
        alloc[i] = requests[i] ?? 0;
      }
      active = active.filter((i) => !capped.includes(i));
    }
  }
  const ints = alloc.map((a) => Math.floor(a + 1e-9));
  let left = Math.round(total - sum(ints));
  const order = alloc
    .map((a, i) => ({ i, r: a - (ints[i] ?? 0) }))
    .filter(({ i }) => (ints[i] ?? 0) < (requests[i] ?? 0) && (weights[i] ?? 0) > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    ints[i] = (ints[i] ?? 0) + 1;
    left -= 1;
  }
  return ints;
}

/** Trainees whose training ends move to their new occupation (and labor pool). */
function completeTrainings(ctx: TurnContext, company: Company): void {
  const { draft, turn } = ctx;
  for (const staff of Object.values(company.workforce)) {
    const done = staff.inTraining.filter((b) => b.doneAt <= turn);
    if (done.length === 0) continue;
    staff.inTraining = staff.inTraining.filter((b) => b.doneAt > turn);
    for (const batch of done) {
      if (batch.count <= 0) continue;
      const fromPool = draft.labor[laborPoolKey(staff.regionId, staff.occupationId)];
      const toKey = laborPoolKey(staff.regionId, batch.toOccupationId);
      const toPool = draft.labor[toKey];
      if (!fromPool || !toPool) continue;
      staff.headcount -= batch.count;
      fromPool.laborForce -= batch.count;
      toPool.laborForce += batch.count;
      // A trained employee asks for the wage of the new occupation.
      const target = (company.workforce[toKey] ??= newStaff(
        staff.regionId,
        batch.toOccupationId,
        toPool.marketWage,
      ));
      const wage = Math.max(target.wage, toPool.marketWage);
      target.wage =
        (target.headcount * target.wage + batch.count * wage) / (target.headcount + batch.count);
      target.headcount += batch.count;
      ctx.log({
        kind: 'training_completed',
        severity: 'info',
        companyId: company.id,
        data: { count: batch.count, toOccupationId: batch.toOccupationId },
      });
    }
  }
}

/**
 * Step 5: dismissals → matching of hires → attrition → training → outside
 * economy, labor force and market wages. Reads labor.attrition,
 * labor.wageGrowth (region, laborPool, company targets).
 */
export const laborSystem: System = {
  id: 'labor',
  run(ctx) {
    const { draft, config, rng, turn } = ctx;
    const L = config.labor;
    const companies = operatingCompanies(draft);
    const hired: Record<Id, Partial<Record<LaborPoolKey, number>>> = {};

    // 0. Last quarter's recruits are up to speed; finished trainings move up.
    for (const company of companies) {
      hired[company.id] = {};
      for (const staff of Object.values(company.workforce)) {
        staff.rampingUp = 0;
        staff.lastQuarter = emptyFlows();
      }
      completeTrainings(ctx, company);
    }

    // 1. Wages, then dismissals (severance, employer brand).
    for (const company of companies) {
      const headcountBefore = sum(Object.values(company.workforce).map((s) => s.headcount));
      let fired = 0;
      for (const h of ctx.decisions[company.id]?.hr ?? []) {
        const key = laborPoolKey(h.regionId, h.occupationId);
        let staff = company.workforce[key];
        if (!staff) {
          if (h.hire <= 0) continue;
          staff = company.workforce[key] = newStaff(h.regionId, h.occupationId, h.wageOffer);
        }
        staff.wage = h.wageOffer;
        staff.lastQuarter.requested = h.hire;
        if (h.hire > 0) staff.lastQuarter.offered = h.wageOffer;
        const f = Math.min(h.fire, staff.headcount - trainees(staff));
        if (f <= 0) continue;
        staff.headcount -= f;
        staff.lastQuarter.dismissed = f;
        fired += f;
        ctx.ledger(company.id).other += f * staff.wage * L.severanceQuarters;
      }
      if (fired > 0 && headcountBefore > 0) {
        const penalty = L.dismissalBrandPenalty * ((100 * fired) / headcountBefore);
        company.employerBrand = clamp(company.employerBrand - penalty, 0, 100);
        ctx.log({
          kind: 'dismissals',
          severity: 'info',
          companyId: company.id,
          data: { count: fired },
        });
      }
    }

    // 2. Matching, pool by pool: hires = min(V, U, μ·U^α·V^(1−α)), sim share V_sim/V.
    for (const key of Object.keys(draft.labor).sort() as LaborPoolKey[]) {
      const pool = draft.labor[key];
      if (!pool) continue;
      const requests: { company: Company; hire: number; wage: number }[] = [];
      for (const company of companies) {
        const h = ctx.decisions[company.id]?.hr.find(
          (x) => laborPoolKey(x.regionId, x.occupationId) === key,
        );
        if (h && h.hire > 0) requests.push({ company, hire: h.hire, wage: h.wageOffer });
      }
      const U = Math.max(0, unemployed(draft, key));
      const vSim = sum(requests.map((r) => r.hire));
      const V = vSim + pool.outsideEmployment * L.outside.vacancyRate;
      pool.tension = V / Math.max(U, 1);
      if (vSim <= 0 || U <= 0) continue;
      const { efficiency: mu, alpha } = L.matching;
      const matches = Math.floor(
        Math.min(vSim, U, (mu * U ** alpha * V ** (1 - alpha) * vSim) / V),
      );
      const weights = requests.map(
        (r) =>
          r.hire *
          (r.wage / pool.marketWage) ** L.wageOfferElasticity *
          (Math.max(1, r.company.employerBrand) / 50) ** L.employerBrand.hiringElasticity,
      );
      const hires = allocateHires(
        matches,
        requests.map((r) => r.hire),
        weights,
      );
      requests.forEach((r, i) => {
        const n = hires[i] ?? 0;
        const staff = r.company.workforce[key];
        if (n <= 0 || !staff) return;
        staff.headcount += n;
        staff.rampingUp += n;
        staff.lastQuarter.hired = n;
        (hired[r.company.id] ??= {})[key] = n;
        ctx.ledger(r.company.id).other += n * staff.wage * L.hiringCost;
      });
    }

    // 3. Attrition (this quarter's recruits stay; trainees leave less).
    for (const company of companies) {
      for (const key of Object.keys(company.workforce).sort() as LaborPoolKey[]) {
        const staff = company.workforce[key] as Staff;
        const pool = draft.labor[key];
        if (!pool || staff.headcount <= 0) continue;
        const modifier = applyModifiers(draft.modifiers, 'labor.attrition', 1, [
          { kind: 'region', id: staff.regionId },
          { kind: 'laborPool', id: key },
          { kind: 'company', id: company.id },
        ]);
        const rate = clamp(
          L.attrition.baseRate *
            (pool.marketWage / staff.wage) ** L.attrition.wageSensitivity *
            (1 + (L.attrition.brandSensitivity * (50 - company.employerBrand)) / 50) *
            modifier,
          0,
          1,
        );
        const eligible = staff.headcount - trainees(staff) - (hired[company.id]?.[key] ?? 0);
        const leavers = Math.min(
          Math.max(0, eligible),
          stochasticRound(eligible * rate, rng.next()),
        );
        staff.headcount -= Math.max(0, leavers);
        staff.lastQuarter.quits += Math.max(0, leavers);
        const traineeRate = rate * (1 - L.training.attritionReduction);
        for (const batch of staff.inTraining) {
          const l = Math.min(batch.count, stochasticRound(batch.count * traineeRate, rng.next()));
          batch.count -= l;
          staff.headcount -= l;
          staff.lastQuarter.quits += l;
        }
        staff.inTraining = staff.inTraining.filter((b) => b.count > 0);
      }
    }

    // 4. New trainings.
    for (const company of companies) {
      for (const h of ctx.decisions[company.id]?.hr ?? []) {
        if (!h.train) continue;
        const staff = company.workforce[laborPoolKey(h.regionId, h.occupationId)];
        if (!staff) continue;
        // Only established staff: this quarter's recruits are still ramping up.
        const count = Math.min(h.train.count, staff.headcount - trainees(staff) - staff.rampingUp);
        if (count <= 0) continue;
        staff.inTraining.push({
          toOccupationId: h.train.toOccupationId,
          count,
          doneAt: turn + L.training.quarters,
        });
        ctx.ledger(company.id).other += count * L.training.costPerPerson * draft.macro.priceLevel;
      }
    }

    // 5. Pools: graduates (lagged wage premium), outside economy, market wages.
    const relativeLaggedWage: Partial<Record<LaborPoolKey, number>> = {};
    for (const [key, pool] of Object.entries(draft.labor) as [
      LaborPoolKey,
      (typeof draft.labor)[LaborPoolKey],
    ][]) {
      const base =
        (L.occupations[pool.occupationId]?.baseWage ?? 1) *
        (draft.regions[pool.regionId]?.wageIndex ?? 1);
      relativeLaggedWage[key] = (pool.wageHistory[0] ?? pool.marketWage) / base;
    }
    const regionMean: Record<Id, number> = {};
    for (const regionId of Object.keys(draft.regions)) {
      const values = Object.keys(L.occupations).map(
        (o) => relativeLaggedWage[laborPoolKey(regionId, o)] ?? 1,
      );
      regionMean[regionId] = values.length > 0 ? sum(values) / values.length : 1;
    }
    const unemploymentTarget =
      L.initialUnemploymentRate * draft.macro.demandIndex ** -L.outside.cycleSensitivity;
    for (const key of Object.keys(draft.labor).sort() as LaborPoolKey[]) {
      const pool = draft.labor[key];
      if (!pool) continue;
      const sim = simulatedEmployment(draft, key);
      const premium = (relativeLaggedWage[key] ?? 1) / (regionMean[pool.regionId] ?? 1);
      const inflow =
        L.graduates.baseRate * pool.laborForce * (premium ** L.graduates.wagePremiumElasticity - 1);
      pool.laborForce = Math.max(pool.laborForce + inflow, pool.outsideEmployment + sim);
      const target = Math.max(0, pool.laborForce * (1 - unemploymentTarget) - sim);
      pool.outsideEmployment = clamp(
        pool.outsideEmployment + L.outside.adjustSpeed * (target - pool.outsideEmployment),
        0,
        pool.laborForce - sim,
      );

      const growth =
        draft.macro.inflation / 4 +
        L.wageAdjustSpeed *
          clamp(pool.tension - L.targetTension, -L.wageAdjustMaxGap, L.wageAdjustMaxGap);
      const shock = applyModifiers(draft.modifiers, 'labor.wageGrowth', 0, [
        { kind: 'region', id: pool.regionId },
        { kind: 'laborPool', id: key },
      ]);
      pool.marketWage *= Math.max(0, 1 + growth + shock);
      pool.wageHistory.push(pool.marketWage);
      if (pool.wageHistory.length > L.graduates.lagQuarters) {
        pool.wageHistory.splice(0, pool.wageHistory.length - L.graduates.lagQuarters);
      }
    }

    // 6. Wage bill and employer brand.
    for (const company of companies) {
      const groups = Object.entries(company.workforce) as [LaborPoolKey, Staff][];
      const headcount = sum(groups.map(([, s]) => s.headcount));
      ctx.ledger(company.id).wages += sum(groups.map(([, s]) => s.headcount * s.wage));
      if (headcount > 0) {
        const relativeWage =
          sum(
            groups.map(([k, s]) => s.headcount * (s.wage / (draft.labor[k]?.marketWage ?? s.wage))),
          ) / headcount;
        const target = 50 + L.employerBrand.wagePremiumWeight * (relativeWage - 1);
        company.employerBrand = clamp(
          company.employerBrand + L.employerBrand.recovery * (target - company.employerBrand),
          0,
          100,
        );
      }
    }
  },
};
