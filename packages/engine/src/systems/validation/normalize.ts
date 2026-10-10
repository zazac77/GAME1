import { indexedRefPrice, isOperating, trainees } from '../../core/companies';
import { emptyDecisions } from '../../core/decisions';
import { laborPoolKey } from '../../core/keys';
import { clamp, sum } from '../../core/math';
import type { Company, RndType } from '../../model/company';
import type {
  CapexOrder,
  CompanyDecisions,
  DealAction,
  DealFinancing,
  HrDecision,
  IntraGroupTransfer,
  ValidationIssue,
  ValidationIssueCode,
} from '../../model/decisions';
import { controlledBy, controllingActor, sameGroup } from '../../core/control';
import { groupHeadOf, owedTo } from '../../core/group';
import { canCreateHolding } from '../conglomerate/holding';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import { farmlandLeft, isFarm } from '../../sectors/agri/farm';
import { agriConfigOf, plantConfigOf, sectorProductLine, techConfigOf } from '../../sectors/config';
import { mainProductLine } from '../../sectors/plant';
import { rndLevel, rndMaxSpend, rndProjectCost } from '../../sectors/plant/rnd';
import { canStartTechProject, maxDevelopersFor, techProjectEffort } from '../../sectors/tech/rnd';
import {
  developerEfficiency,
  headcountByRegion,
  isOffice,
  techTeam,
} from '../../sectors/tech/team';
import { capexOrderCost } from '../capex';
import { borrowingCapacity } from '../finance/credit';
import {
  acquisitionDebtCapacity,
  blockSeller,
  canTarget,
  canWithdraw,
  dueDiligenceCost,
  groupHead,
  heldByGroup,
  listingPrice,
  minCompetingPrice,
  openListing,
  openOffers,
  pendingOrUsableDiligence,
} from '../mna/rules';
import {
  buybackPrice,
  ipoTerms,
  issuePrice,
  maxBuyback,
  maxDividend,
  maxNewShares,
} from '../finance/equity';

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
    const site = company.sites[siteId];
    if (site?.status !== 'operational' || isOffice(site)) flag(path, 'unknown_id');
    else if (!isNum(p?.targetOutput) || p.targetOutput < 0) {
      flag(`${path}.targetOutput`, 'invalid_value', p?.targetOutput);
    } else out.production[siteId] = { targetOutput: p.targetOutput };
  }

  // ---- human resources ----------------------------------------------------
  // Hiring needs a site in the region (in service or being built); in tech, a
  // free office seat (dismissals listed earlier free theirs).
  const tech = techConfigOf(config, company.sector);
  const siteRegions = new Set(Object.values(company.sites).map((s) => s.regionId));
  const seatsLeft: Record<Id, number> = {};
  if (tech) {
    // An office put up for sale this quarter seats nobody new.
    const selling = new Set(
      (input.capex ?? []).flatMap((o) => (o?.kind === 'sell_site' ? [o.siteId] : [])),
    );
    const headcounts = headcountByRegion(company);
    for (const site of Object.values(company.sites)) {
      if (isOffice(site) && !selling.has(site.id)) {
        seatsLeft[site.regionId] = (seatsLeft[site.regionId] ?? 0) + (site.seats ?? 0);
      }
    }
    for (const [regionId, headcount] of Object.entries(headcounts)) {
      seatsLeft[regionId] = (seatsLeft[regionId] ?? 0) - headcount;
    }
  }
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
        let max = Math.floor(share * pool.laborForce);
        if (tech) max = Math.min(max, Math.max(0, (seatsLeft[h.regionId] ?? 0) + entry.fire));
        entry.hire = bound(`${path}.hire`, Math.floor(h.hire), 0, max);
      }
    } else flag(`${path}.hire`, 'invalid_value', h.hire);
    if (tech) {
      seatsLeft[h.regionId] = (seatsLeft[h.regionId] ?? 0) + entry.fire - entry.hire;
    }

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
  if (tech) normalizeTechRnd(state, company, input, out, flag, bound);
  // Plant sectors: a cash budget per project.
  (tech ? [] : (input.rnd ?? [])).forEach((r, i) => {
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

  // ---- group: holding company, intra-group transfers (end of quarter) -----
  normalizeGroup(state, company, input, out, flag, bound);
  const fin = input.finance ?? {};

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

  // ---- equity: dividends, share issues, buybacks, public offering --------
  const equityCash = normalizeEquity(state, company, fin, out, flag, bound);

  // ---- capex: investments paid when ordered, from cash and new debt -----
  const capexBudget = Math.max(
    0,
    cash + (out.finance.borrow ?? 0) - (out.finance.repay ?? 0) + equityCash,
  );
  let capexSpent = 0;
  let siteCount = Object.values(company.sites).filter((s) =>
    tech ? isOffice(s) : s.kind === 'factory',
  ).length;
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
        if (!ind && !tech) return flag(path, 'not_available');
        const max = tech ? tech.office.maxOffices : (ind?.factory.maxSites ?? 0);
        if (siteCount >= max) return flag(path, 'limit');
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
        if (!site) return flag(path, 'unknown_id');
        if (soldSites.has(o.siteId)) return flag(path, 'duplicate');
        if (!ind || site.kind !== 'factory') return flag(path, 'invalid_state');
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
    if (target.id === company.id) return flag(path, 'invalid_value'); // own shares: finance.buyback
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
            // Mandatory offer: the market stops the group at the threshold (with maxMinorityStake).
            Math.max(
              0,
              Math.floor(
                Math.min(SM.maxMinorityStake, SM.mandatoryOfferThreshold) *
                  target.sharesOutstanding,
              ) - heldByGroup(state, company.id, target.id),
            ),
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

  // ---- takeovers: settled at the end of the quarter -----------------------
  const diligenceSpent = normalizeMna(
    state,
    company,
    input,
    out,
    flag,
    bound,
    Math.max(
      0,
      cash + (out.finance.borrow ?? 0) - (out.finance.repay ?? 0) + equityCash - capexSpent,
    ),
  );

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
      (out.finance.repay ?? 0) +
      equityCash -
      capexSpent -
      diligenceSpent +
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
    out.rnd = out.rnd.filter((r) => r.budget > 0 || (r.developers ?? 0) > 0);
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

type Flag = (path: string, code: ValidationIssueCode, submitted?: number, applied?: number) => void;
type Bound = (path: string, x: number, min: number, max: number) => number;

/**
 * Holding company (root companies only, not already a holding) and
 * intra-group transfers. A transfer is decided by one of its two companies
 * or by the head of their group; both must operate and belong to the same
 * group (outside it, a loan can only repay what is owed). Amounts are
 * bounded at settlement by the cash then available. A dividend goes to a
 * shareholder of the payer; a stake goes to a company the target does not
 * control, within the shares held.
 */
function normalizeGroup(
  state: GameState,
  company: Company,
  input: CompanyDecisions,
  out: CompanyDecisions,
  flag: Flag,
  bound: Bound,
): void {
  if (input.createHolding !== undefined && input.createHolding !== false) {
    const actor = Object.values(state.actors).find((a) => a.rootCompanyId === company.id);
    if (input.createHolding !== true) flag('createHolding', 'invalid_value');
    else if (!actor || !canCreateHolding(state, actor)) flag('createHolding', 'invalid_state');
    else out.createHolding = true;
  }
  const kept: IntraGroupTransfer[] = [];
  const pools = new Set<Id>();
  (Array.isArray(input.intraGroup) ? input.intraGroup : []).forEach((t, i) => {
    const path = `intraGroup[${i}]`;
    const kinds = ['dividend', 'loan', 'cash_pool', 'stake'];
    if (!kinds.includes(t?.kind)) return flag(`${path}.kind`, 'invalid_value');
    const from = state.companies[t.fromId];
    const to = state.companies[t.toId];
    if (!from || !to) return flag(path, 'unknown_id');
    if (from.id === to.id) return flag(path, 'invalid_value');
    if (!isOperating(from) || !isOperating(to)) return flag(path, 'invalid_state');
    const actorId = controllingActor(state, from.id);
    const head = actorId ? groupHeadOf(state, actorId) : undefined;
    if (company.id !== from.id && company.id !== to.id && company.id !== head) {
      return flag(path, 'not_controlled');
    }
    const inGroup = sameGroup(state, from.id, to.id);
    if (t.kind === 'stake') {
      const target = state.companies[t.targetId];
      if (!target) return flag(`${path}.targetId`, 'unknown_id');
      const held = state.stock.registry[target.id]?.[from.id] ?? 0;
      if (!inGroup || !sameGroup(state, from.id, target.id) || held <= 0) {
        return flag(path, 'invalid_state');
      }
      if (to.id === target.id || controlledBy(state, target.id).includes(to.id)) {
        return flag(path, 'invalid_state');
      }
      const transfer: IntraGroupTransfer = {
        kind: 'stake',
        fromId: from.id,
        toId: to.id,
        targetId: target.id,
      };
      if (t.shares !== undefined) {
        if (!isNum(t.shares) || t.shares <= 0) {
          return flag(`${path}.shares`, 'invalid_value', t.shares);
        }
        transfer.shares = bound(`${path}.shares`, Math.floor(t.shares), 1, held);
      }
      kept.push(transfer);
      return;
    }
    if (!isNum(t.amount) || t.amount < 0) return flag(`${path}.amount`, 'invalid_value', t.amount);
    let amount = t.amount;
    if (!inGroup) {
      const owed = owedTo(from, to.id);
      if (t.kind !== 'loan' || owed <= 0) return flag(path, 'invalid_state');
      amount = bound(`${path}.amount`, amount, 0, owed);
    }
    if (t.kind === 'dividend' && (state.stock.registry[from.id]?.[to.id] ?? 0) <= 0) {
      return flag(path, 'invalid_state');
    }
    if (t.kind === 'cash_pool') {
      if (pools.has(from.id)) return flag(path, 'duplicate');
      pools.add(from.id);
    } else if (amount <= 0) return;
    kept.push({ kind: t.kind, fromId: from.id, toId: to.id, amount });
  });
  if (kept.length > 0) out.intraGroup = kept;
}

/**
 * Takeovers: due diligences (one per target while its results are valid,
 * paid now), then at most one deal per quarter: a tender offer on a listed
 * company (friendly, or `hostile`; on a target under offer, competing: at
 * least the best open price × (1 + minOverbid), one open offer per group),
 * the block of a controlling shareholder (a listed one with the mandatory
 * offer on every other share; not while the target is under offer), a
 * listing, or a raise of the company's own open offer — outside the buyer's
 * group and never on the player's companies for an AI. Withdrawals (own open
 * offer, once outbid or after a poison pill) and tenders of the shares held
 * to an open offer are free. Payment: stockShare in new shares (listed
 * buyers), an acquisition loan within the bank's limit, and cash: a deal
 * whose cash part exceeds the cash at hand plus that loan is dropped (the
 * quarter's flows may still make it fail at settlement). Returns the cost of
 * the due diligences.
 */
function normalizeMna(
  state: GameState,
  company: Company,
  input: CompanyDecisions,
  out: CompanyDecisions,
  flag: Flag,
  bound: Bound,
  room: number,
): number {
  let spent = 0;
  let dealDone = false;
  const seen = new Set<Id>();
  const seenOffers = new Set<Id>();
  const financing = (
    a: DealFinancing,
    path: string,
    targetId: Id,
  ): { stockShare: number; debt: number } => {
    let stockShare = 0;
    if (a.stockShare !== undefined) {
      if (!isNum(a.stockShare)) flag(`${path}.stockShare`, 'invalid_value');
      else if (a.stockShare > 0 && !company.listed) flag(`${path}.stockShare`, 'invalid_state');
      else stockShare = bound(`${path}.stockShare`, a.stockShare, 0, 1);
    }
    let debt = 0;
    if (a.debt !== undefined) {
      if (!isNum(a.debt) || a.debt < 0) flag(`${path}.debt`, 'invalid_value', a.debt);
      else
        debt = bound(`${path}.debt`, a.debt, 0, acquisitionDebtCapacity(state, company, targetId));
    }
    return { stockShare, debt };
  };
  const tenderShares = (targetId: Id, target: Company) =>
    target.sharesOutstanding - heldByGroup(state, company.id, targetId);
  (input.mna ?? []).forEach((a, i) => {
    const path = `mna[${i}]`;
    if (a?.kind === 'withdraw_offer' || a?.kind === 'tender_shares' || a?.kind === 'raise_offer') {
      const offer = openOffers(state).find((o) => o.id === a.offerId);
      if (!offer) return flag(`${path}.offerId`, 'unknown_id');
      if (seenOffers.has(offer.id)) return flag(path, 'duplicate');
      const own = offer.bidderId === company.id;
      if (a.kind === 'tender_shares') {
        if (own || (state.stock.registry[offer.targetId]?.[company.id] ?? 0) <= 0) {
          return flag(path, 'invalid_state');
        }
        seenOffers.add(offer.id);
        out.mna.push({ kind: 'tender_shares', offerId: offer.id });
        return;
      }
      if (!own) return flag(path, 'invalid_state');
      if (a.kind === 'withdraw_offer') {
        if (!canWithdraw(state, offer)) return flag(path, 'invalid_state');
        seenOffers.add(offer.id);
        out.mna.push({ kind: 'withdraw_offer', offerId: offer.id });
        return;
      }
      if (dealDone) return flag(path, 'duplicate');
      if (!isNum(a.pricePerShare) || a.pricePerShare <= 0) {
        return flag(`${path}.pricePerShare`, 'invalid_value', a.pricePerShare);
      }
      const min = minCompetingPrice(state, offer.targetId);
      if (a.pricePerShare < min - 1e-9)
        return flag(`${path}.pricePerShare`, 'limit', a.pricePerShare, min);
      const target = state.companies[offer.targetId];
      if (!target) return flag(path, 'unknown_id');
      const { stockShare, debt } = financing(a, path, offer.targetId);
      const cashPart = tenderShares(target.id, target) * a.pricePerShare * (1 - stockShare);
      if (cashPart > room - spent + debt)
        return flag(path, 'budget', cashPart, room - spent + debt);
      const raise: CompanyDecisions['mna'][number] = {
        kind: 'raise_offer',
        offerId: offer.id,
        pricePerShare: a.pricePerShare,
      };
      if (a.stockShare !== undefined) raise.stockShare = stockShare;
      if (a.debt !== undefined) raise.debt = debt;
      seenOffers.add(offer.id);
      out.mna.push(raise);
      dealDone = true;
      return;
    }
    const targetId = typeof a?.targetId === 'string' ? a.targetId : '';
    const listing = openListing(state, targetId);
    const target = listing ? undefined : state.companies[targetId];
    if (!listing && !target) return flag(`${path}.targetId`, 'unknown_id');
    if (target && !canTarget(state, company, target)) return flag(path, 'invalid_state');
    if (a.kind === 'due_diligence') {
      if (seen.has(targetId) || pendingOrUsableDiligence(state, company.id, targetId)) {
        return flag(path, 'duplicate');
      }
      const cost = dueDiligenceCost(state, targetId);
      if (cost > room - spent) return flag(path, 'budget', cost, 0);
      seen.add(targetId);
      spent += cost;
      out.mna.push({ kind: 'due_diligence', targetId });
      return;
    }
    if (a.kind !== 'tender_offer' && a.kind !== 'private_purchase') {
      return flag(`${path}.kind`, 'invalid_value');
    }
    if (dealDone) return flag(path, 'duplicate');
    const { stockShare, debt } = financing(a, path, targetId);
    let total = 0;
    const deal = { kind: a.kind, targetId } as DealAction;
    if (listing) {
      if (a.kind !== 'private_purchase') return flag(`${path}.kind`, 'invalid_value');
      total = listingPrice(state, company.id, listing);
    } else if (target) {
      if (!isNum(a.pricePerShare) || a.pricePerShare <= 0) {
        return flag(`${path}.pricePerShare`, 'invalid_value', a.pricePerShare);
      }
      deal.pricePerShare = a.pricePerShare;
      const underOffer = openOffers(state, target.id);
      let shares: number;
      if (a.kind === 'tender_offer') {
        if (!target.listed) return flag(path, 'invalid_state');
        if (underOffer.length > 0) {
          const head = groupHead(state, company.id);
          if (underOffer.some((o) => groupHead(state, o.bidderId) === head)) {
            return flag(path, 'duplicate');
          }
          const min = minCompetingPrice(state, target.id);
          if (a.pricePerShare < min - 1e-9) {
            return flag(`${path}.pricePerShare`, 'limit', a.pricePerShare, min);
          }
        }
        if (a.hostile === true)
          (deal as Extract<DealAction, { kind: 'tender_offer' }>).hostile = true;
        shares = tenderShares(target.id, target);
      } else {
        if (underOffer.length > 0) return flag(path, 'invalid_state');
        const seller = blockSeller(state, target);
        if (!seller) return flag(path, 'invalid_state');
        // Listed: the mandatory offer covers every other share.
        shares = target.listed
          ? tenderShares(target.id, target)
          : (state.stock.registry[target.id]?.[seller] ?? 0);
      }
      total = shares * a.pricePerShare;
    }
    const cashPart = total * (1 - stockShare);
    if (cashPart > room - spent + debt) return flag(path, 'budget', cashPart, room - spent + debt);
    if (stockShare > 0) deal.stockShare = stockShare;
    if (debt > 0) deal.debt = debt;
    out.mna.push(deal);
    dealDone = true;
  });
  return spent;
}

/**
 * Dividend (within the cash and the equity; none while distressed or in
 * breach of covenant), share issue (listed, within maxNewShares) or buyback
 * (listed, from the float, paid in cash), public offering (unlisted, with
 * enough closed quarters). Returns the net cash these bring at the start of
 * the quarter (negative: they consume it).
 */
function normalizeEquity(
  state: GameState,
  company: Company,
  fin: CompanyDecisions['finance'],
  out: CompanyDecisions,
  flag: Flag,
  bound: Bound,
): number {
  const { config } = state;
  const capital = config.stockMarket.capital;
  let cash = Math.max(
    0,
    company.books.current.balance.cash + (out.finance.borrow ?? 0) - (out.finance.repay ?? 0),
  );
  let net = 0;
  if (fin.dividend !== undefined) {
    if (!isNum(fin.dividend) || fin.dividend < 0) {
      flag('finance.dividend', 'invalid_value', fin.dividend);
    } else if (fin.dividend > 0) {
      if (company.status === 'distressed' || company.credit.covenantBreached) {
        flag('finance.dividend', 'invalid_state');
      } else {
        const max = Math.min(cash, maxDividend(company));
        const dividend = bound('finance.dividend', fin.dividend, 0, max);
        if (dividend > 0) {
          out.finance.dividend = dividend;
          cash -= dividend;
          net -= dividend;
        }
      }
    }
  }
  const shares = (key: 'issueShares' | 'buyback'): number | undefined => {
    const x = fin[key];
    if (x === undefined || x === 0) return undefined;
    if (!isNum(x) || x < 0) {
      flag(`finance.${key}`, 'invalid_value', x);
      return undefined;
    }
    if (!company.listed) {
      flag(`finance.${key}`, 'invalid_state');
      return undefined;
    }
    return Math.floor(x);
  };
  const issue = shares('issueShares');
  if (issue !== undefined) {
    const n = bound('finance.issueShares', issue, 0, maxNewShares(state, company));
    if (n > 0) {
      out.finance.issueShares = n;
      const proceeds = n * issuePrice(state, company) * (1 - capital.issueFeeShare);
      cash += proceeds;
      net += proceeds;
    }
  }
  const buyback = shares('buyback');
  if (buyback !== undefined) {
    if (out.finance.issueShares) flag('finance.buyback', 'duplicate');
    else {
      const price = buybackPrice(state, company);
      const affordable = price > 0 ? Math.floor(cash / price) : 0;
      const n = bound(
        'finance.buyback',
        buyback,
        0,
        Math.min(maxBuyback(state, company), affordable),
      );
      if (n > 0) {
        out.finance.buyback = n;
        net -= n * price;
      }
    }
  }
  if (fin.ipo !== undefined && fin.ipo !== false) {
    const terms = fin.ipo === true ? ipoTerms(state, company) : undefined;
    if (fin.ipo !== true) flag('finance.ipo', 'invalid_value');
    else if (!terms) flag('finance.ipo', 'invalid_state');
    else {
      out.finance.ipo = true;
      net += terms.proceeds;
    }
  }
  return net;
}

/**
 * Tech R&D: projects are staffed with developers (whole people, among those
 * not in training nor dismissed this quarter), each project within what it
 * can absorb this quarter; no cash budget (the wages are the cost).
 */
function normalizeTechRnd(
  state: GameState,
  company: Company,
  input: CompanyDecisions,
  out: CompanyDecisions,
  flag: Flag,
  bound: Bound,
): void {
  const { config } = state;
  const tech = techConfigOf(config, company.sector);
  if (!tech) return;
  const line = sectorProductLine(config, company);
  const team = techTeam(config, tech, company, 0);
  const efficiency = developerEfficiency(tech, team);
  const dismissed = sum(
    out.hr.filter((h) => h.occupationId === tech.developerOccupationId).map((h) => h.fire),
  );
  let available = Math.max(0, Math.floor(team.developers + 1e-9) - dismissed);
  const seen = new Set<RndType>();
  (input.rnd ?? []).forEach((r, i) => {
    const path = `rnd[${i}]`;
    if (r?.type !== 'process' && r?.type !== 'product')
      return flag(`${path}.type`, 'invalid_value');
    if (!isNum(r.budget) || r.budget < 0) return flag(`${path}.budget`, 'invalid_value', r.budget);
    // Developers' wages are the cost: no cash budget.
    if (r.budget > 0) flag(`${path}.budget`, 'invalid_value', r.budget, 0);
    const current = company.rnd.find((p) => p.type === r.type);
    if (r.projectId !== undefined && r.projectId !== current?.id) {
      return flag(`${path}.projectId`, 'unknown_id');
    }
    if (seen.has(r.type)) return flag(path, 'duplicate');
    seen.add(r.type);
    if (r.type === 'product' && !line) return flag(path, 'unknown_id');
    const requested = r.developers ?? 0;
    if (!isNum(requested) || requested < 0) {
      return flag(`${path}.developers`, 'invalid_value', requested);
    }
    if (requested === 0) return;
    if (!current && !canStartTechProject(tech, r.type, company.processLevel)) {
      return flag(path, 'limit');
    }
    const effort = current?.effort ?? techProjectEffort(tech, r.type, company.processLevel);
    const max = Math.min(
      available,
      maxDevelopersFor(tech, effort, current?.progress ?? 0, efficiency),
    );
    const developers = bound(`${path}.developers`, Math.floor(requested), 0, max);
    if (developers <= 0) return;
    available -= developers;
    const entry: CompanyDecisions['rnd'][number] = { type: r.type, budget: 0, developers };
    if (current) entry.projectId = current.id;
    out.rnd.push(entry);
  });
}
