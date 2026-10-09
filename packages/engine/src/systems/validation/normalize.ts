import { indexedRefPrice, isOperating, operationalSites, trainees } from '../../core/companies';
import { laborPoolKey } from '../../core/keys';
import { clamp, sum } from '../../core/math';
import type { Company } from '../../model/company';
import type {
  CompanyDecisions,
  HrDecision,
  ValidationIssue,
  ValidationIssueCode,
} from '../../model/decisions';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import { borrowingCapacity } from '../finance/credit';

/** Decisions that change nothing: keep prices, produce at full capacity, buy nothing. */
export const emptyDecisions = (companyId: Id): CompanyDecisions => ({
  companyId,
  pricing: {},
  production: {},
  hr: [],
  purchasing: { spot: [], newContracts: [] },
  capex: [],
  marketing: {},
  rnd: [],
  finance: {},
  stockOrders: [],
  mna: [],
});

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Bounds and normalizes the decisions of one company against the state at
 * the start of the quarter. Identical for the player and the AI. Never
 * mutates its inputs.
 */
export function normalizeDecisions(
  state: GameState,
  company: Company,
  input: CompanyDecisions | undefined,
): { decisions: CompanyDecisions; issues: ValidationIssue[] } {
  const { config } = state;
  const out = emptyDecisions(company.id);
  const issues: ValidationIssue[] = [];
  const flag = (path: string, code: ValidationIssueCode, submitted?: number, applied?: number) => {
    const issue: ValidationIssue = { companyId: company.id, path, code };
    if (submitted !== undefined && Number.isFinite(submitted)) issue.submitted = submitted;
    if (applied !== undefined) issue.applied = applied;
    issues.push(issue);
  };
  /** Keeps x within [min, max], flagging the change. */
  const bound = (path: string, x: number, min: number, max: number): number => {
    const y = clamp(x, min, max);
    if (y !== x) flag(path, 'clamped', x, y);
    return y;
  };
  if (!input) return { decisions: out, issues };
  if (!isOperating(company)) {
    flag('', 'inactive_company');
    return { decisions: out, issues };
  }

  // ---- pricing ------------------------------------------------------------
  for (const [lineId, p] of Object.entries(input.pricing ?? {})) {
    const path = `pricing.${lineId}`;
    const line = company.productLines[lineId];
    if (!line) {
      flag(path, 'unknown_id');
      continue;
    }
    const ref = indexedRefPrice(state, line.marketId);
    const entry: CompanyDecisions['pricing'][Id] = { price: line.price };
    if (isNum(p?.price) && p.price > 0) {
      const { min, max } = config.products.priceBounds;
      entry.price = bound(`${path}.price`, p.price, min * ref, max * ref);
    } else {
      flag(`${path}.price`, 'invalid_value', p?.price);
    }
    if (p?.qualityTarget !== undefined) {
      if (isNum(p.qualityTarget)) {
        entry.qualityTarget = bound(`${path}.qualityTarget`, p.qualityTarget, 0, 100);
      } else flag(`${path}.qualityTarget`, 'invalid_value');
    }
    out.pricing[lineId] = entry;
  }

  // ---- production ---------------------------------------------------------
  for (const [siteId, p] of Object.entries(input.production ?? {})) {
    const path = `production.${siteId}`;
    if (company.sites[siteId]?.status !== 'operational') flag(path, 'unknown_id');
    else if (!isNum(p?.targetOutput) || p.targetOutput < 0) {
      flag(`${path}.targetOutput`, 'invalid_value', p?.targetOutput);
    } else out.production[siteId] = { targetOutput: p.targetOutput };
  }

  // ---- human resources ----------------------------------------------------
  const siteRegions = new Set(operationalSites(company).map((s) => s.regionId));
  const seenPools = new Set<string>();
  (input.hr ?? []).forEach((h, i) => {
    const path = `hr[${i}]`;
    const key = laborPoolKey(h?.regionId, h?.occupationId);
    const pool = state.labor[key];
    const occupation = config.labor.occupations[h?.occupationId];
    if (!pool || !occupation) return flag(path, 'unknown_id');
    if (seenPools.has(key)) return flag(path, 'duplicate');
    seenPools.add(key);
    const staff = company.workforce[key];
    const headcount = staff?.headcount ?? 0;
    const inTraining = staff ? trainees(staff) : 0;
    const entry: HrDecision = {
      regionId: h.regionId,
      occupationId: h.occupationId,
      hire: 0,
      fire: 0,
      wageOffer: staff?.wage ?? pool.marketWage,
    };
    const { min, max } = config.labor.wageOfferBounds;
    if (isNum(h.wageOffer) && h.wageOffer > 0) {
      entry.wageOffer = bound(
        `${path}.wageOffer`,
        h.wageOffer,
        min * pool.marketWage,
        max * pool.marketWage,
      );
    } else flag(`${path}.wageOffer`, 'invalid_value', h.wageOffer);

    if (isNum(h.fire) && h.fire >= 0) {
      entry.fire = bound(`${path}.fire`, Math.floor(h.fire), 0, headcount - inTraining);
    } else flag(`${path}.fire`, 'invalid_value', h.fire);

    if (isNum(h.hire) && h.hire >= 0) {
      if (h.hire > 0 && !siteRegions.has(h.regionId)) flag(`${path}.hire`, 'unknown_id');
      else {
        const share = config.labor.maxHiringShareByLevel[occupation.level - 1] ?? 1;
        entry.hire = bound(
          `${path}.hire`,
          Math.floor(h.hire),
          0,
          Math.floor(share * pool.laborForce),
        );
      }
    } else flag(`${path}.hire`, 'invalid_value', h.hire);

    if (h.train) {
      const target = config.labor.occupations[h.train.toOccupationId];
      if (!target || target.level <= occupation.level) flag(`${path}.train`, 'invalid_value');
      else if (!isNum(h.train.count) || h.train.count < 0) {
        flag(`${path}.train.count`, 'invalid_value', h.train.count);
      } else {
        const count = bound(
          `${path}.train.count`,
          Math.floor(h.train.count),
          0,
          headcount - inTraining - entry.fire,
        );
        if (count > 0) entry.train = { toOccupationId: h.train.toOccupationId, count };
      }
    }
    if (entry.hire > 0 || entry.fire > 0 || entry.train || staff) out.hr.push(entry);
  });

  // ---- purchasing ---------------------------------------------------------
  (input.purchasing?.spot ?? []).forEach((o, i) => {
    const path = `purchasing.spot[${i}]`;
    const market = config.commodities.markets[o?.commodityId];
    if (!market) return flag(path, 'unknown_id');
    if (!market.storable) return flag(path, 'invalid_value'); // bought at consumption
    if (!isNum(o.qty) || o.qty < 0) return flag(`${path}.qty`, 'invalid_value', o.qty);
    if (o.qty === 0) return;
    const order: CompanyDecisions['purchasing']['spot'][number] = {
      commodityId: o.commodityId,
      qty: o.qty,
    };
    if (o.limitPrice !== undefined) {
      if (isNum(o.limitPrice) && o.limitPrice > 0) order.limitPrice = o.limitPrice;
      else flag(`${path}.limitPrice`, 'invalid_value', o.limitPrice);
    }
    out.purchasing.spot.push(order);
  });
  (input.purchasing?.newContracts ?? []).forEach((c, i) => {
    const path = `purchasing.newContracts[${i}]`;
    if (!config.commodities.markets[c?.commodityId]) return flag(path, 'unknown_id');
    if (!isNum(c.qtyPerQuarter) || c.qtyPerQuarter <= 0) {
      return flag(`${path}.qtyPerQuarter`, 'invalid_value', c.qtyPerQuarter);
    }
    if (!isNum(c.quarters)) return flag(`${path}.quarters`, 'invalid_value');
    const { min, max } = config.commodities.contractQuarters;
    const quarters = bound(`${path}.quarters`, Math.round(c.quarters), min, max);
    out.purchasing.newContracts.push({
      commodityId: c.commodityId,
      qtyPerQuarter: c.qtyPerQuarter,
      quarters,
    });
  });

  // ---- marketing ----------------------------------------------------------
  for (const [lineId, budget] of Object.entries(input.marketing ?? {})) {
    if (!company.productLines[lineId]) flag(`marketing.${lineId}`, 'unknown_id');
    else if (!isNum(budget) || budget < 0) flag(`marketing.${lineId}`, 'invalid_value', budget);
    else if (budget > 0) out.marketing[lineId] = budget;
  }

  // ---- features of later lots --------------------------------------------
  if ((input.capex ?? []).length > 0) flag('capex', 'not_available');
  if ((input.rnd ?? []).length > 0) flag('rnd', 'not_available');
  if ((input.stockOrders ?? []).length > 0) flag('stockOrders', 'not_available');
  if ((input.mna ?? []).length > 0) flag('mna', 'not_available');
  if ((input.intraGroup ?? []).length > 0) flag('intraGroup', 'not_available');
  const fin = input.finance ?? {};
  for (const key of ['dividend', 'issueShares', 'buyback', 'ipo'] as const) {
    if (fin[key]) flag(`finance.${key}`, 'not_available');
  }

  // ---- debt ---------------------------------------------------------------
  const { cash, revenue } = {
    cash: company.books.current.balance.cash,
    revenue: company.books.current.pnl.revenue,
  };
  if (fin.borrow !== undefined) {
    if (!isNum(fin.borrow) || fin.borrow < 0) flag('finance.borrow', 'invalid_value', fin.borrow);
    else {
      const borrow = bound('finance.borrow', fin.borrow, 0, borrowingCapacity(config, company));
      if (borrow > 0) out.finance.borrow = borrow;
    }
  }
  if (fin.repay !== undefined) {
    if (!isNum(fin.repay) || fin.repay < 0) flag('finance.repay', 'invalid_value', fin.repay);
    else {
      const termDebt = sum(company.loans.filter((l) => l.kind === 'term').map((l) => l.principal));
      const repay = bound(
        'finance.repay',
        fin.repay,
        0,
        Math.min(termDebt, Math.max(0, cash + (out.finance.borrow ?? 0))),
      );
      if (repay > 0) out.finance.repay = repay;
    }
  }

  // ---- budget: discretionary spending within the available liquidity -----
  const spotCost = (o: CompanyDecisions['purchasing']['spot'][number]): number => {
    const market = state.commodities[o.commodityId];
    return o.qty * (market?.spotPrice ?? 0) * (1 + config.commodities.spotPremium);
  };
  const wageOf = (h: HrDecision) => h.wageOffer;
  const spending =
    sum(out.purchasing.spot.map(spotCost)) +
    sum(Object.values(out.marketing)) +
    sum(out.hr.map((h) => h.hire * wageOf(h) * config.labor.hiringCost)) +
    sum(out.hr.map((h) => (h.train?.count ?? 0) * config.labor.training.costPerPerson));
  const liquidity = Math.max(
    0,
    cash +
      (out.finance.borrow ?? 0) -
      (out.finance.repay ?? 0) +
      config.finance.spendingOverdraftShareOfRevenue * revenue,
  );
  if (spending > liquidity) {
    const f = spending > 0 ? liquidity / spending : 0;
    flag('', 'budget', spending, liquidity);
    for (const o of out.purchasing.spot) o.qty *= f;
    out.purchasing.spot = out.purchasing.spot.filter((o) => o.qty > 0);
    for (const lineId of Object.keys(out.marketing)) {
      out.marketing[lineId] = (out.marketing[lineId] ?? 0) * f;
    }
    for (const h of out.hr) {
      h.hire = Math.floor(h.hire * f);
      if (h.train) {
        const count = Math.floor(h.train.count * f);
        if (count > 0) h.train = { ...h.train, count };
        else delete h.train;
      }
    }
  }

  return { decisions: out, issues };
}
