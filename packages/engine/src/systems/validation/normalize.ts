import { indexedRefPrice, isOperating, trainees } from '../../core/companies';
import { emptyDecisions } from '../../core/decisions';
import { laborPoolKey } from '../../core/keys';
import { clamp, sum } from '../../core/math';
import type { Company, RndType } from '../../model/company';
import type {
  CapexOrder,
  CompanyDecisions,
  HrDecision,
  ValidationIssue,
  ValidationIssueCode,
} from '../../model/decisions';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import { farmlandLeft, isFarm } from '../../sectors/agri/farm';
import { agriConfigOf, plantConfigOf } from '../../sectors/config';
import { mainProductLine } from '../../sectors/plant';
import { rndLevel, rndMaxSpend, rndProjectCost } from '../../sectors/plant/rnd';
import { capexOrderCost } from '../capex';
import { borrowingCapacity } from '../finance/credit';

export { emptyDecisions } from '../../core/decisions';

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
  // Hiring needs a factory in the region (in service or being built).
  const siteRegions = new Set(Object.values(company.sites).map((s) => s.regionId));
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

  // ---- retail listing (agri) ----------------------------------------------
  const agri = agriConfigOf(config, company.sector);
  for (const [lineId, fees] of Object.entries(input.listing ?? {})) {
    const line = company.productLines[lineId];
    if (!line) flag(`listing.${lineId}`, 'unknown_id');
    else if (!agri || line.distribution === undefined) flag(`listing.${lineId}`, 'invalid_value');
    else if (!isNum(fees) || fees < 0) flag(`listing.${lineId}`, 'invalid_value', fees);
    else if (fees > 0) out.listing[lineId] = fees;
  }

  // ---- R&D: one project per type at a time, spending capped per quarter ---
  const ind = plantConfigOf(config, company.sector);
  const mainLine = mainProductLine(state, company);
  const seenRnd = new Set<RndType>();
  (input.rnd ?? []).forEach((r, i) => {
    const path = `rnd[${i}]`;
    if (r?.type !== 'process' && r?.type !== 'product')
      return flag(`${path}.type`, 'invalid_value');
    if (!isNum(r.budget) || r.budget < 0) {
      return flag(`${path}.budget`, 'invalid_value', r.budget);
    }
    const current = company.rnd.find((p) => p.type === r.type);
    if (r.projectId !== undefined && r.projectId !== current?.id) {
      return flag(`${path}.projectId`, 'unknown_id');
    }
    if (seenRnd.has(r.type)) return flag(path, 'duplicate');
    if (!ind) return flag(path, 'not_available');
    seenRnd.add(r.type);
    if (r.type === 'product' && !mainLine) return flag(path, 'unknown_id');
    if (r.budget === 0) return;
    let cost = current?.cost ?? 0;
    if (!current) {
      const level = rndLevel(company, r.type, mainLine);
      if (level >= ind.rnd.maxLevel) return flag(path, 'limit');
      cost = rndProjectCost(ind, r.type, level, state.macro.priceLevel);
    }
    const max = rndMaxSpend(ind, cost, current?.progress ?? 0);
    const budget = bound(`${path}.budget`, r.budget, 0, max);
    if (budget <= 0) return;
    const entry: CompanyDecisions['rnd'][number] = { type: r.type, budget };
    if (current) entry.projectId = current.id;
    out.rnd.push(entry);
  });

  // ---- features of later lots --------------------------------------------
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

  // ---- capex: investments paid when ordered, from cash and new debt -----
  const capexBudget = Math.max(0, cash + (out.finance.borrow ?? 0) - (out.finance.repay ?? 0));
  let capexSpent = 0;
  let siteCount = Object.values(company.sites).filter((s) => s.kind === 'factory').length;
  let farmCount = Object.values(company.sites).filter(isFarm).length;
  const landOrdered: Record<Id, number> = {};
  const lineCount: Record<Id, number> = {};
  for (const [siteId, site] of Object.entries(company.sites)) {
    lineCount[siteId] = Object.keys(site.lines).length;
  }
  const soldSites = new Set<Id>();
  const extendedSites = new Set<Id>();
  const touchedLines = new Set<Id>();
  (input.capex ?? []).forEach((o, i) => {
    const path = `capex[${i}]`;
    let order: CapexOrder;
    switch (o?.kind) {
      case 'build_site': {
        if (!state.regions[o.regionId]) return flag(path, 'unknown_id');
        if (!ind) return flag(path, 'not_available');
        if (siteCount >= ind.factory.maxSites) return flag(path, 'limit');
        order = { kind: 'build_site', regionId: o.regionId };
        break;
      }
      case 'buy_farm': {
        if (!state.regions[o.regionId]) return flag(path, 'unknown_id');
        if (!agri) return flag(path, 'not_available');
        const F = agri.farm;
        if (farmCount >= F.maxFarms) return flag(path, 'limit');
        const left = farmlandLeft(state, o.regionId) - (landOrdered[o.regionId] ?? 0);
        if (left < F.hectares) return flag(path, 'limit');
        order = { kind: 'buy_farm', regionId: o.regionId };
        break;
      }
      case 'add_line': {
        const site = company.sites[o.siteId];
        if (!site || !ind) return flag(path, 'unknown_id');
        if (soldSites.has(o.siteId)) return flag(path, 'duplicate');
        if (site.kind !== 'factory') return flag(path, 'invalid_state');
        if ((lineCount[o.siteId] ?? 0) >= ind.factory.maxLines) return flag(path, 'limit');
        order = { kind: 'add_line', siteId: o.siteId };
        break;
      }
      case 'modernize_line':
      case 'sell_line': {
        const line = company.sites[o.siteId]?.lines[o.lineId];
        if (!line) return flag(path, 'unknown_id');
        if (touchedLines.has(o.lineId) || soldSites.has(o.siteId)) return flag(path, 'duplicate');
        if (line.status !== 'operational') return flag(path, 'invalid_state');
        if (o.kind === 'modernize_line' && line.techLevel >= (ind?.line.maxTechLevel ?? 0)) {
          return flag(path, 'limit');
        }
        order = { kind: o.kind, siteId: o.siteId, lineId: o.lineId };
        break;
      }
      case 'sell_site': {
        const site = company.sites[o.siteId];
        if (!site) return flag(path, 'unknown_id');
        const busy =
          soldSites.has(site.id) ||
          extendedSites.has(site.id) ||
          Object.keys(site.lines).some((l) => touchedLines.has(l));
        if (busy) return flag(path, 'duplicate');
        if (site.status !== 'operational') return flag(path, 'invalid_state');
        order = { kind: 'sell_site', siteId: o.siteId };
        break;
      }
      default:
        return flag(path, 'invalid_value');
    }
    const cost = capexOrderCost(state, company, order);
    if (capexSpent + cost > capexBudget) return flag(path, 'budget', cost, 0);
    capexSpent += cost;
    if (order.kind === 'build_site') siteCount += 1;
    if (order.kind === 'buy_farm') {
      farmCount += 1;
      landOrdered[order.regionId] = (landOrdered[order.regionId] ?? 0) + (agri?.farm.hectares ?? 0);
    }
    if (order.kind === 'add_line') {
      lineCount[order.siteId] = (lineCount[order.siteId] ?? 0) + 1;
      extendedSites.add(order.siteId);
    }
    if (order.kind === 'modernize_line' || order.kind === 'sell_line')
      touchedLines.add(order.lineId);
    if (order.kind === 'sell_site') soldSites.add(order.siteId);
    out.capex.push(order);
  });

  // ---- stock orders: minority stakes, executed at the end of the quarter -
  const SM = config.stockMarket;
  const seenTargets = new Set<Id>();
  (input.stockOrders ?? []).forEach((o, i) => {
    const path = `stockOrders[${i}]`;
    const target = state.companies[o?.targetId];
    const quote = state.stock.quotes[o?.targetId];
    const register = state.stock.registry[o?.targetId];
    if (!target || !quote || !register) return flag(path, 'unknown_id');
    if (target.id === company.id) return flag(path, 'invalid_value'); // buybacks: phase 2
    if (!target.listed || !isOperating(target)) return flag(path, 'invalid_state');
    if (o.side !== 'buy' && o.side !== 'sell') return flag(`${path}.side`, 'invalid_value');
    if (seenTargets.has(target.id)) return flag(path, 'duplicate');
    if (!isNum(o.shares) || o.shares < 0) return flag(`${path}.shares`, 'invalid_value', o.shares);
    seenTargets.add(target.id);
    const float = register.public ?? 0;
    const held = register[company.id] ?? 0;
    // Liquidity: at most maxFloatPerQuarter of the float per holder and per quarter.
    const tradable = Math.floor(SM.maxFloatPerQuarter * float);
    const max =
      o.side === 'buy'
        ? Math.min(
            tradable,
            float,
            Math.max(0, Math.floor(SM.maxMinorityStake * target.sharesOutstanding) - held),
            Math.floor(Math.max(0, cash) / quote.price),
          )
        : Math.min(tradable, held);
    const shares = bound(`${path}.shares`, Math.floor(o.shares), 0, max);
    if (shares <= 0) return;
    const order: CompanyDecisions['stockOrders'][number] = {
      targetId: target.id,
      side: o.side,
      shares,
    };
    if (o.limitPrice !== undefined) {
      if (isNum(o.limitPrice) && o.limitPrice > 0) order.limitPrice = o.limitPrice;
      else flag(`${path}.limitPrice`, 'invalid_value', o.limitPrice);
    }
    out.stockOrders.push(order);
  });

  // ---- budget: discretionary spending within the available liquidity -----
  const spotCost = (o: CompanyDecisions['purchasing']['spot'][number]): number => {
    const market = state.commodities[o.commodityId];
    return o.qty * (market?.spotPrice ?? 0) * (1 + config.commodities.spotPremium);
  };
  const wageOf = (h: HrDecision) => h.wageOffer;
  const spending =
    sum(out.purchasing.spot.map(spotCost)) +
    sum(Object.values(out.marketing)) +
    sum(Object.values(out.listing)) +
    sum(out.rnd.map((r) => r.budget)) +
    sum(out.hr.map((h) => h.hire * wageOf(h) * config.labor.hiringCost)) +
    sum(out.hr.map((h) => (h.train?.count ?? 0) * config.labor.training.costPerPerson));
  const liquidity = Math.max(
    0,
    cash +
      (out.finance.borrow ?? 0) -
      (out.finance.repay ?? 0) -
      capexSpent +
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
    for (const lineId of Object.keys(out.listing)) {
      out.listing[lineId] = (out.listing[lineId] ?? 0) * f;
    }
    for (const r of out.rnd) r.budget *= f;
    out.rnd = out.rnd.filter((r) => r.budget > 0);
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
