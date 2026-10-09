import { sum } from '../../core/math';
import { valueEquity } from '../../core/valuation';
import type { CompetitorView } from '../../model/ai';
import type { MnaAction } from '../../model/decisions';
import type { Id, Money, SectorId } from '../../model/ids';
import type { AnnualFigures } from '../../model/mna';
import type { Plan } from './plan';

/** A deal the planner can see from its Observation. */
interface Candidate {
  targetId: Id;
  /** The bid, should it go ahead. */
  action: Extract<MnaAction, { kind: 'tender_offer' | 'private_purchase' }>;
  /** Price of the whole deal. */
  price: Money;
  /** Value of what is bought (valuation mid-point × share of the capital). */
  value: Money;
  /** Annual EBITDA the bank lends against. */
  ebitda: Money;
  /** Basis of the due diligence cost. */
  size: Money;
}

const annualOf = (c: CompetitorView): AnnualFigures | undefined => {
  const last = c.published.slice(-4);
  if (last.length === 0) return undefined;
  const scale = 4 / last.length;
  return {
    revenue: sum(last.map((s) => s.pnl.revenue)) * scale,
    ebitda: sum(last.map((s) => s.pnl.ebitda)) * scale,
  };
};

/** Every deal on offer: listings at their price, rivals at their board's premium (+ a margin). */
function candidates(plan: Plan): Candidate[] {
  const { obs, config } = plan;
  const rate = obs.macro.policyRate;
  const extra = config.ai.mna.extraPremium;
  const diligence = (id: Id) => obs.mna.diligence.find((d) => d.targetId === id);
  const value = (
    sector: SectorId | 'holding',
    figures: AnnualFigures,
    netDebt: Money,
    assets: Money,
  ) => valueEquity(config, rate, sector, figures, 0, netDebt, assets).mid;
  const out: Candidate[] = [];
  for (const l of obs.mna.listings) {
    const dd = diligence(l.id);
    const figures = dd?.figures ?? l.estimate;
    const price = Math.max(0, l.askingPrice - (dd?.hiddenLiability ?? 0));
    out.push({
      targetId: l.id,
      action: { kind: 'private_purchase', targetId: l.id },
      price,
      value: value(l.sector, figures, dd?.netDebt ?? l.netDebt, 0),
      ebitda: figures.ebitda,
      size: l.askingPrice,
    });
  }
  for (const c of obs.competitors) {
    const quote = obs.stock.quotes[c.companyId];
    const published = c.published.at(-1);
    if (c.askedPremium === undefined || !c.listed || !quote || !published) continue;
    if (c.status !== 'active' && c.status !== 'distressed') continue;
    if (obs.group.companies.includes(c.companyId)) continue;
    const dd = diligence(c.companyId);
    const figures = dd?.figures ?? annualOf(c);
    if (!figures) continue;
    const b = published.balance;
    const whole = value(c.sector, figures, dd?.netDebt ?? b.debt - b.cash, b.financialAssets);
    const pricePerShare = quote.referencePrice * (1 + c.askedPremium + extra);
    const shares = c.blockShares ?? Math.max(0, c.shares - (obs.stock.holdings[c.companyId] ?? 0));
    if (shares <= 0) continue;
    out.push({
      targetId: c.companyId,
      action:
        c.blockShares !== undefined
          ? { kind: 'private_purchase', targetId: c.companyId, pricePerShare }
          : { kind: 'tender_offer', targetId: c.companyId, pricePerShare },
      price: shares * pricePerShare,
      value: (whole * shares) / Math.max(1, c.shares),
      ebitda: figures.ebitda,
      size: quote.referencePrice * c.shares,
    });
  }
  return out;
}

/**
 * 9. Takeovers (group heads with some acquisitiveness): with probability
 * acquisitiveness per quarter (one draw per planning, used or not), outside
 * the cooldown and while the own leverage allows, the deal whose valuation
 * (× (1 + valueMargin)) best covers its price, and that the cash at hand
 * plus an acquisition loan and new shares (within the control of its group)
 * can pay, gets a due diligence. Next quarter, on
 * the figures it revealed, the bid goes ahead if the deal still holds
 * (rivals: the block of their controlling shareholder or a friendly tender
 * offer, at the premium their board asks plus extraPremium); else it is
 * dropped. The planner sees only public facts and its own due diligences.
 */
export function takeovers(plan: Plan): void {
  const { obs, config, profile, memory, company, decisions } = plan;
  const A = config.ai.mna;
  const roll = plan.rng.next();
  if (!obs.group.isHead || profile.acquisitiveness <= 0) {
    delete memory.deal;
    return;
  }
  const { balance } = company.books.current;
  const fin = decisions.finance;
  const available =
    balance.cash +
    (fin.borrow ?? 0) -
    (fin.repay ?? 0) -
    (fin.dividend ?? 0) -
    plan.spend.capex -
    plan.spend.discretionary -
    A.cashAfterQuarters * plan.quarterlyCashCosts;
  const lending = !company.credit.covenantBreached;
  // Paying in shares: priced at the opening price, within what keeps the group in control.
  const ownPrice = obs.stock.quotes[company.id]?.referencePrice ?? 0;
  const stockRoom = company.listed ? 0.95 * obs.self.sharesWithinControl * ownPrice : 0;
  const financing = (c: Candidate) => {
    const inShares = Math.min(A.stockShare * c.price, stockRoom);
    const debt = lending
      ? Math.min(
          A.debtShare * c.price,
          config.mna.financing.maxDebtToEbitda * Math.max(0, c.ebitda),
        )
      : 0;
    return {
      debt,
      stockShare: c.price > 0 ? inShares / c.price : 0,
      cash: Math.max(0, c.price - inShares - debt),
    };
  };
  const affordable = (c: Candidate) =>
    c.price > 0 &&
    c.price <= A.maxShareOfEquity * Math.max(0, balance.equity) &&
    financing(c).cash <= available;
  const worth = (c: Candidate) => (c.value * (1 + A.valueMargin)) / c.price;
  const all = candidates(plan);

  if (memory.deal) {
    const deal = memory.deal;
    const ready = obs.mna.diligence.some((d) => d.targetId === deal.targetId);
    const c = all.find((x) => x.targetId === deal.targetId);
    if (!ready && c && obs.turn - deal.since <= 1) return; // results next quarter
    delete memory.deal;
    memory.lastDealAt = obs.turn;
    if (!c || !ready || worth(c) < 1 || !affordable(c)) return;
    const { debt, stockShare } = financing(c);
    const bid = { ...c.action };
    if (debt > 0) bid.debt = debt;
    if (stockShare > 0) bid.stockShare = stockShare;
    decisions.mna.push(bid);
    return;
  }

  if (memory.lastDealAt !== undefined && obs.turn - memory.lastDealAt < A.cooldownQuarters) return;
  if (roll >= profile.acquisitiveness) return;
  const { ebitda } = annualOwn(plan);
  const netDebt = balance.debt - balance.cash;
  if (netDebt > 0 && (ebitda <= 0 || netDebt / ebitda > A.maxLeverage)) return;
  const best = all
    .filter((c) => worth(c) >= 1 && affordable(c))
    .sort((a, b) => worth(b) - worth(a) || a.targetId.localeCompare(b.targetId))[0];
  if (!best) return;
  const D = config.mna.dueDiligence;
  const cost = Math.max(D.minCost * obs.macro.priceLevel, D.costShareOfValue * best.size);
  if (cost > available - financing(best).cash) return;
  decisions.mna.push({ kind: 'due_diligence', targetId: best.targetId });
  memory.deal = { targetId: best.targetId, since: obs.turn };
}

/** The company's own annual EBITDA and net income (last four closed quarters). */
function annualOwn(plan: Plan): { ebitda: Money; netIncome: Money } {
  const last = plan.company.books.history.slice(-4);
  if (last.length === 0) return { ebitda: 0, netIncome: 0 };
  const scale = 4 / last.length;
  return {
    ebitda: sum(last.map((s) => s.pnl.ebitda)) * scale,
    netIncome: sum(last.map((s) => s.pnl.netIncome)) * scale,
  };
}

/**
 * 8b. Dividends of a listed company that does not need to borrow: payout ×
 * the last quarter's net income, when net debt / EBITDA is below
 * maxLeverage and the cash stays above minCashQuarters of cash costs.
 */
export function dividends(plan: Plan): void {
  const { config, company, decisions } = plan;
  const D = config.ai.dividends;
  if (!company.listed || D.payout <= 0 || decisions.finance.borrow) return;
  if (company.status !== 'active' || company.credit.covenantBreached) return;
  const { pnl, balance } = company.books.current;
  if (pnl.netIncome <= 0) return;
  const { ebitda } = annualOwn(plan);
  const netDebt = balance.debt - balance.cash;
  if (netDebt > 0 && (ebitda <= 0 || netDebt / ebitda > D.maxLeverage)) return;
  const dividend = D.payout * pnl.netIncome;
  const left =
    balance.cash -
    (decisions.finance.repay ?? 0) -
    plan.spend.capex -
    plan.spend.discretionary -
    dividend;
  if (left < D.minCashQuarters * plan.quarterlyCashCosts) return;
  decisions.finance.dividend = Math.min(dividend, Math.max(0, balance.equity));
}
