import { normalQuantile, sum } from '../../core/math';
import { valueEquity } from '../../core/valuation';
import type { CompetitorView } from '../../model/ai';
import type { DealAction, MnaAction } from '../../model/decisions';
import type { Id, Money, SectorId } from '../../model/ids';
import type { AnnualFigures } from '../../model/mna';
import type { TenderOffer } from '../../model/stock';
import type { Plan } from './plan';

/** A deal the planner can see from its Observation. */
interface Candidate {
  targetId: Id;
  /** The bid, should it go ahead. */
  action: DealAction;
  /** Price of the whole deal (every share it may have to buy). */
  price: Money;
  /** Value of what is bought (valuation mid-point × share of the capital). */
  value: Money;
  /** Annual EBITDA the bank lends against. */
  ebitda: Money;
  /** Basis of the due diligence cost. */
  size: Money;
  /** A rival group declared a stake in it, or an activist wants it sold (pre-emption). */
  preempt: boolean;
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

const isOpen = (o: TenderOffer) => o.status === 'open';

/** Equity value of a rival (valuation mid-point), on its due diligence or published accounts. */
function rivalValue(plan: Plan, c: CompetitorView): { whole: Money; ebitda: Money } | undefined {
  const { obs, config } = plan;
  const published = c.published.at(-1);
  if (!published) return undefined;
  const dd = obs.mna.diligence.find((d) => d.targetId === c.companyId);
  const figures = dd?.figures ?? annualOf(c);
  if (!figures) return undefined;
  const b = published.balance;
  const whole = valueEquity(
    config,
    obs.macro.policyRate,
    c.sector,
    figures,
    0,
    dd?.netDebt ?? b.debt - b.cash,
    b.financialAssets + b.groupLoans,
  ).mid;
  return { whole, ebitda: figures.ebitda };
}

/** Shares of a rival the planner's company does not hold (what an offer must buy). */
const sharesToBuy = (plan: Plan, c: CompetitorView): number =>
  Math.max(0, c.shares - (plan.obs.stock.holdings[c.companyId] ?? 0));

/**
 * Premium of a hostile offer on a company nobody controls: the float
 * tranches expected to tender (tenderPremiumDist, + the board's opposition)
 * must bring the own stake above the control threshold × (1 + hostileSafety).
 * Undefined when even the whole float would not do.
 */
function hostilePremium(plan: Plan, c: CompetitorView): number | undefined {
  const { obs, config } = plan;
  const float = obs.stock.float[c.companyId] ?? 0;
  const own = obs.stock.holdings[c.companyId] ?? 0;
  const needed = config.mna.controlThreshold * c.shares * (1 + config.ai.mna.hostileSafety) - own;
  if (float <= 0) return undefined;
  const q = needed / float;
  if (q >= 0.999) return undefined;
  const D = config.stockMarket.tenderPremiumDist;
  const opposition = config.mna.offers.oppositionPremium;
  return Math.max(0, opposition + D.mean + D.std * normalQuantile(Math.max(0.001, q)));
}

/**
 * Every deal on offer: listings at their price; rivals at their board's
 * premium (+ extraPremium) — a block (with the mandatory offer on every
 * other share of a listed one) or a friendly tender offer — or, on a rival
 * nobody controls whose board asks more, a hostile tender offer.
 */
function candidates(plan: Plan): Candidate[] {
  const { obs, config } = plan;
  const A = config.ai.mna;
  const diligence = (id: Id) => obs.mna.diligence.find((d) => d.targetId === id);
  const value = (
    sector: SectorId | 'holding',
    figures: AnnualFigures,
    netDebt: Money,
    assets: Money,
  ) => valueEquity(config, obs.macro.policyRate, sector, figures, 0, netDebt, assets).mid;
  const ownGroup = new Set<Id>([obs.companyId, ...obs.group.companies]);
  if (obs.group.actorId) ownGroup.add(obs.group.actorId);
  const preempted = (c: CompetitorView) =>
    Object.entries(obs.stock.declared[c.companyId] ?? {}).some(
      ([holder, level]) =>
        !ownGroup.has(holder) &&
        holder !== c.actorId &&
        holder !== c.controllerId &&
        level >= A.preemptThreshold,
    ) || obs.stock.campaigns.some((x) => x.targetId === c.companyId && x.demand === 'sale');
  const underOffer = new Set(obs.mna.tenderOffers.filter(isOpen).map((o) => o.targetId));
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
      preempt: false,
    });
  }
  for (const c of obs.competitors) {
    const quote = obs.stock.quotes[c.companyId];
    if (c.askedPremium === undefined || !c.listed || !quote) continue;
    if (c.status !== 'active' && c.status !== 'distressed') continue;
    if (ownGroup.has(c.companyId) || underOffer.has(c.companyId)) continue;
    const v = rivalValue(plan, c);
    if (!v) continue;
    const shares = sharesToBuy(plan, c);
    if (shares <= 0) continue;
    let premium = c.askedPremium + A.extraPremium;
    let hostile = false;
    if (c.blockShares === undefined && c.controllerId === undefined) {
      const h = hostilePremium(plan, c);
      if (h !== undefined && h <= A.hostileMaxPremium && h < c.askedPremium) {
        premium = h;
        hostile = true;
      }
    }
    const pricePerShare = quote.referencePrice * (1 + premium);
    const action: DealAction =
      c.blockShares !== undefined
        ? { kind: 'private_purchase', targetId: c.companyId, pricePerShare }
        : hostile
          ? { kind: 'tender_offer', targetId: c.companyId, pricePerShare, hostile: true }
          : { kind: 'tender_offer', targetId: c.companyId, pricePerShare };
    out.push({
      targetId: c.companyId,
      action,
      price: shares * pricePerShare,
      value: (v.whole * shares) / Math.max(1, c.shares),
      ebitda: v.ebitda,
      size: quote.referencePrice * c.shares,
      preempt: preempted(c),
    });
  }
  return out;
}

/** What the planner can spend on a deal and how it would pay for one. */
function means(plan: Plan) {
  const { obs, config, company, decisions } = plan;
  const A = config.ai.mna;
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
  const financing = (price: Money, ebitda: Money) => {
    const inShares = Math.min(A.stockShare * price, stockRoom);
    const debt = lending
      ? Math.min(A.debtShare * price, config.mna.financing.maxDebtToEbitda * Math.max(0, ebitda))
      : 0;
    return {
      debt,
      stockShare: price > 0 ? inShares / price : 0,
      cash: Math.max(0, price - inShares - debt),
    };
  };
  const affordable = (price: Money, ebitda: Money) =>
    price > 0 &&
    price <= A.maxShareOfEquity * Math.max(0, balance.equity) &&
    financing(price, ebitda).cash <= available;
  return { available, financing, affordable };
}

/** Adds the financing to a bid. */
function financed<T extends DealAction | Extract<MnaAction, { kind: 'raise_offer' }>>(
  bid: T,
  f: { debt: Money; stockShare: number },
): T {
  const out = { ...bid };
  if (f.debt > 0) out.debt = f.debt;
  if (f.stockShare > 0) out.stockShare = f.stockShare;
  return out;
}

/**
 * 9. Takeovers (group heads with some acquisitiveness), from public facts and
 * the own due diligences only:
 * - an open offer of its own: outbid, it raises to the best price ×
 *   (1 + counterBidStep) while the deal is still worth it (at most
 *   maxCounterBids times), else withdraws; it withdraws after a poison pill;
 * - a hostile offer on a rival whose board looks for a white knight: with
 *   probability acquisitiveness, a competing friendly offer if the target is
 *   worth it (published accounts, no time for a due diligence);
 * - a deal prepared last quarter: the bid goes ahead if the due diligence
 *   confirms it;
 * - otherwise, with probability acquisitiveness per quarter (one draw per
 *   planning, used or not), outside the cooldown and while the own leverage
 *   allows, the deal whose valuation (× (1 + valueMargin)) best covers its
 *   price and that it can pay gets a due diligence — a target where a rival
 *   group declared preemptThreshold (or that an activist wants sold) is
 *   looked at first, outside the draw and the cooldown, with
 *   preemptValueMargin more.
 */
export function takeovers(plan: Plan): void {
  const { obs, config, profile, memory, company, decisions } = plan;
  const A = config.ai.mna;
  const roll = plan.rng.next();
  if (!obs.group.isHead || profile.acquisitiveness <= 0) {
    delete memory.deal;
    return;
  }
  const { available, financing, affordable } = means(plan);
  const worth = (value: Money, price: Money, extra = 0) =>
    (value * (1 + A.valueMargin + extra)) / price;
  const open = obs.mna.tenderOffers.filter(isOpen);
  const rivalOf = (id: Id) => obs.competitors.find((c) => c.companyId === id);

  // ---- own open offer: counter-bid or withdraw --------------------------------
  const mine = open.find((o) => o.bidderId === company.id);
  if (mine) {
    const others = open.filter((o) => o.targetId === mine.targetId && o.id !== mine.id);
    const best = others.reduce<TenderOffer | undefined>(
      (b, o) => (!b || o.pricePerShare > b.pricePerShare ? o : b),
      undefined,
    );
    const c = rivalOf(mine.targetId);
    const v = c && rivalValue(plan, c);
    if (best && best.pricePerShare >= mine.pricePerShare && c && v) {
      const price = best.pricePerShare * (1 + A.counterBidStep);
      const shares = sharesToBuy(plan, c);
      const total = shares * price;
      const value = (v.whole * shares) / Math.max(1, c.shares);
      if (
        mine.raises < A.maxCounterBids &&
        worth(value, total) >= 1 &&
        affordable(total, v.ebitda)
      ) {
        const raise: Extract<MnaAction, { kind: 'raise_offer' }> = {
          kind: 'raise_offer',
          offerId: mine.id,
          pricePerShare: price,
        };
        decisions.mna.push(financed(raise, financing(total, v.ebitda)));
        plan.signals.push({
          kind: 'ai_counter_bid',
          rivalId: best.bidderId,
          data: { targetId: mine.targetId, pricePerShare: price },
        });
        return;
      }
      decisions.mna.push({ kind: 'withdraw_offer', offerId: mine.id });
      return;
    }
    if (mine.defenses.pill) decisions.mna.push({ kind: 'withdraw_offer', offerId: mine.id });
    return;
  }

  // ---- white knight ------------------------------------------------------------
  const cooled =
    memory.lastDealAt === undefined || obs.turn - memory.lastDealAt >= A.cooldownQuarters;
  const sought = open.filter(
    (o) =>
      o.hostile &&
      o.defenses.whiteKnight &&
      !obs.group.companies.includes(o.targetId) &&
      !obs.group.companies.includes(o.bidderId),
  );
  if (sought.length > 0 && cooled && roll < profile.acquisitiveness) {
    for (const o of sought) {
      const c = rivalOf(o.targetId);
      const quote = obs.stock.quotes[o.targetId];
      const v = c && rivalValue(plan, c);
      if (!c || !quote || !v || c.askedPremium === undefined) continue;
      const best = Math.max(
        ...open.filter((x) => x.targetId === o.targetId).map((x) => x.pricePerShare),
      );
      const price = Math.max(
        best * (1 + config.mna.offers.minOverbid + A.knightMargin),
        quote.referencePrice * (1 + c.askedPremium * config.mna.offers.whiteKnightAskFactor),
      );
      const shares = sharesToBuy(plan, c);
      const total = shares * price;
      const value = (v.whole * shares) / Math.max(1, c.shares);
      if (worth(value, total) < 1 || !affordable(total, v.ebitda)) continue;
      const knight: DealAction = {
        kind: 'tender_offer',
        targetId: o.targetId,
        pricePerShare: price,
      };
      decisions.mna.push(financed(knight, financing(total, v.ebitda)));
      plan.signals.push({
        kind: 'ai_white_knight',
        rivalId: o.bidderId,
        data: { targetId: o.targetId, pricePerShare: price },
      });
      delete memory.deal;
      memory.lastDealAt = obs.turn;
      return;
    }
  }

  const all = candidates(plan);
  const extra = (c: Candidate) => (c.preempt ? A.preemptValueMargin : 0);

  // ---- a deal prepared last quarter ------------------------------------------
  if (memory.deal) {
    const deal = memory.deal;
    const ready = obs.mna.diligence.some((d) => d.targetId === deal.targetId);
    const c = all.find((x) => x.targetId === deal.targetId);
    if (!ready && c && obs.turn - deal.since <= 1) return; // results next quarter
    delete memory.deal;
    memory.lastDealAt = obs.turn;
    if (!c || !ready || worth(c.value, c.price, extra(c)) < 1 || !affordable(c.price, c.ebitda)) {
      return;
    }
    decisions.mna.push(financed(c.action, financing(c.price, c.ebitda)));
    if (c.action.kind === 'tender_offer' && c.action.hostile) {
      plan.signals.push({
        kind: 'ai_hostile_offer',
        rivalId: c.targetId,
        data: { pricePerShare: c.action.pricePerShare ?? 0 },
      });
    }
    return;
  }

  // ---- a new deal ------------------------------------------------------------------
  const { ebitda } = annualOwn(plan);
  const { balance } = company.books.current;
  const netDebt = balance.debt - balance.cash;
  if (netDebt > 0 && (ebitda <= 0 || netDebt / ebitda > A.maxLeverage)) return;
  const viable = all
    .filter((c) => worth(c.value, c.price, extra(c)) >= 1 && affordable(c.price, c.ebitda))
    .sort(
      (a, b) =>
        Number(b.preempt) - Number(a.preempt) ||
        worth(b.value, b.price, extra(b)) - worth(a.value, a.price, extra(a)) ||
        a.targetId.localeCompare(b.targetId),
    );
  const best = viable[0];
  if (!best) return;
  if (!best.preempt && (!cooled || roll >= profile.acquisitiveness)) return;
  const D = config.mna.dueDiligence;
  const cost = Math.max(D.minCost * obs.macro.priceLevel, D.costShareOfValue * best.size);
  if (cost > available - financing(best.price, best.ebitda).cash) return;
  decisions.mna.push({ kind: 'due_diligence', targetId: best.targetId });
  memory.deal = { targetId: best.targetId, since: obs.turn };
  if (best.preempt) plan.signals.push({ kind: 'ai_preempt', rivalId: best.targetId });
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
 * the last quarter's net income (campaignPayout while an activist fund
 * campaigns for a payout), when net debt / EBITDA is below maxLeverage and
 * the cash stays above minCashQuarters of cash costs.
 */
export function dividends(plan: Plan): void {
  const { obs, config, company, decisions } = plan;
  const D = config.ai.dividends;
  const campaign = obs.stock.campaigns.some(
    (c) => c.targetId === company.id && c.demand === 'payout',
  );
  const payout = campaign ? Math.max(D.payout, D.campaignPayout) : D.payout;
  if (!company.listed || payout <= 0 || decisions.finance.borrow) return;
  if (company.status !== 'active' || company.credit.covenantBreached) return;
  const { pnl, balance } = company.books.current;
  if (pnl.netIncome <= 0) return;
  const { ebitda } = annualOwn(plan);
  const netDebt = balance.debt - balance.cash;
  if (netDebt > 0 && (ebitda <= 0 || netDebt / ebitda > D.maxLeverage)) return;
  const dividend = payout * pnl.netIncome;
  const left =
    balance.cash -
    (decisions.finance.repay ?? 0) -
    plan.spend.capex -
    plan.spend.discretionary -
    dividend;
  if (left < D.minCashQuarters * plan.quarterlyCashCosts) return;
  decisions.finance.dividend = Math.min(dividend, Math.max(0, balance.equity));
}

/**
 * 8c. Defense of a listed company nobody controls: when an outside group
 * (not its founder) declared at least buybackTrigger of its capital, or a
 * hostile offer is open on it, it buys its own shares back — within
 * maxBuybackShare of its capital and maxFloatPerQuarter of the float — with
 * the cash above minCashQuarters of cash costs (founder's stake up, float
 * down).
 */
export function defend(plan: Plan): void {
  const { obs, config, company, decisions } = plan;
  const D = config.ai.defense;
  if (!company.listed || company.status !== 'active' || obs.group.actorId !== undefined) return;
  if (decisions.finance.issueShares || decisions.finance.borrow) return;
  const declared = obs.stock.declared[company.id] ?? {};
  const raider =
    Object.keys(declared)
      .sort()
      .find((h) => h !== obs.actorId && (declared[h] ?? 0) >= D.buybackTrigger) ??
    obs.mna.tenderOffers.find((o) => isOpen(o) && o.targetId === company.id && o.hostile)?.bidderId;
  if (!raider) return;
  const SM = config.stockMarket;
  const price =
    (obs.stock.quotes[company.id]?.referencePrice ?? 0) * (1 + SM.capital.buybackPremium);
  if (price <= 0) return;
  const { balance } = company.books.current;
  const cash =
    balance.cash -
    (decisions.finance.repay ?? 0) -
    (decisions.finance.dividend ?? 0) -
    plan.spend.capex -
    plan.spend.discretionary -
    D.minCashQuarters * plan.quarterlyCashCosts;
  const float = obs.stock.float[company.id] ?? 0;
  const shares = Math.floor(
    Math.min(
      SM.capital.maxBuybackShare * company.sharesOutstanding,
      SM.maxFloatPerQuarter * float,
      Math.max(0, cash) / price,
    ),
  );
  if (shares <= 0) return;
  decisions.finance.buyback = shares;
  plan.signals.push({ kind: 'ai_defense_buyback', rivalId: raider, data: { shares } });
}
