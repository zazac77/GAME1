import { isOperating } from '../core/companies';
import { controlledBy } from '../core/control';
import { effectiveShares, groupDebt, groupLoansGranted } from '../core/group';
import { sum } from '../core/math';
import { valueEquity } from '../core/valuation';
import type { Company } from '../model/company';
import type { HolderId, Id } from '../model/ids';
import type { AnnualFigures } from '../model/mna';
import type { GameState } from '../model/state';
import type {
  CapitalQuotes,
  DealQuote,
  GroupCompanyView,
  GroupLoanView,
  OfferView,
} from '../model/views';
import {
  buybackPrice,
  ipoTerms,
  issuePrice,
  maxBuyback,
  maxDividend,
  maxNewShares,
} from '../systems/finance/equity';
import {
  acquisitionDebtCapacity,
  blockSeller,
  boardPremium,
  canTarget,
  canWithdraw,
  contestable,
  dueDiligenceCost,
  heldByGroup,
  listingPrice,
  minCompetingPrice,
  openOffers,
  pendingOrUsableDiligence,
  usableDiligence,
} from '../systems/mna/rules';
import { publishedStatements, shareValue } from '../systems/stockmarket';

/** Equity transactions the company can make this quarter (as validation bounds them). */
export function capitalQuotes(state: GameState, company: Company): CapitalQuotes {
  const blocked = company.status === 'distressed' || company.credit.covenantBreached;
  const quotes: CapitalQuotes = {
    maxDividend: blocked ? 0 : maxDividend(company),
    issuePrice: company.listed ? issuePrice(state, company) : 0,
    maxIssue: company.listed ? maxNewShares(state, company) : 0,
    buybackPrice: company.listed ? buybackPrice(state, company) : 0,
    maxBuyback: company.listed ? maxBuyback(state, company) : 0,
  };
  const ipo = ipoTerms(state, company);
  if (ipo) quotes.ipo = ipo;
  return quotes;
}

/** Annual figures of the last four published quarters. */
function publishedAnnual(state: GameState, company: Company): AnnualFigures | undefined {
  const last = publishedStatements(state, company, state.meta.turn - 1).slice(-4);
  if (last.length === 0) return undefined;
  const scale = 4 / last.length;
  return {
    revenue: sum(last.map((s) => s.pnl.revenue)) * scale,
    ebitda: sum(last.map((s) => s.pnl.ebitda)) * scale,
  };
}

/**
 * What the viewed company could buy, valued on what it knows: its due
 * diligence if usable, else the public estimate of a listing or the
 * published accounts of a listed company. Unlisted companies of other
 * groups are valued only after a due diligence.
 */
export function dealQuotes(state: GameState, buyer: Company): DealQuote[] {
  const { config, macro } = state;
  const status = (targetId: Id): DealQuote['diligence'] =>
    usableDiligence(state, buyer.id, targetId)
      ? 'done'
      : pendingOrUsableDiligence(state, buyer.id, targetId)
        ? 'pending'
        : 'none';
  const out: DealQuote[] = [];
  for (const l of state.mna.listings.filter((x) => x.expiresAt > state.meta.turn)) {
    const dd = usableDiligence(state, buyer.id, l.id);
    const figures = dd ? { ...dd.figures } : { ...l.estimate };
    const netDebt = dd?.netDebt ?? l.netDebt;
    const quote: DealQuote = {
      targetId: l.id,
      kind: 'listing',
      name: l.name,
      sector: l.sector,
      figures,
      netDebt,
      diligence: status(l.id),
      valuation: valueEquity(config, macro.policyRate, l.sector, figures, 0, netDebt, 0),
      price: listingPrice(state, buyer.id, l),
      dueDiligenceCost: dueDiligenceCost(state, l.id),
      debtCapacity: acquisitionDebtCapacity(state, buyer, l.id),
    };
    if (dd) quote.hiddenLiability = dd.hiddenLiability;
    out.push(quote);
  }
  for (const id of Object.keys(state.companies).sort()) {
    const target = state.companies[id] as Company;
    if (!canTarget(state, buyer, target)) continue;
    const dd = usableDiligence(state, buyer.id, id);
    const published = publishedStatements(state, target, state.meta.turn - 1).at(-1);
    const figures = dd
      ? { ...dd.figures }
      : target.listed
        ? publishedAnnual(state, target)
        : undefined;
    if (!figures) continue;
    const b = published?.balance ?? target.books.current.balance;
    const netDebt = dd?.netDebt ?? b.debt - b.cash;
    const quote: DealQuote = {
      targetId: id,
      kind: 'company',
      name: target.name,
      sector: target.sector,
      figures,
      netDebt,
      diligence: status(id),
      valuation: valueEquity(
        config,
        macro.policyRate,
        target.sector,
        figures,
        0,
        netDebt,
        b.financialAssets + b.groupLoans,
      ),
      referencePrice: target.listed
        ? (state.stock.quotes[id]?.referencePrice ?? 0)
        : shareValue(state, target),
      dueDiligenceCost: dueDiligenceCost(state, id),
      debtCapacity: acquisitionDebtCapacity(state, buyer, id),
    };
    const asked = boardPremium(state, target);
    if (asked !== undefined) quote.askedPremium = asked;
    const seller = blockSeller(state, target);
    if (seller) quote.blockShares = state.stock.registry[id]?.[seller] ?? 0;
    const held = heldByGroup(state, buyer.id, id);
    quote.groupStake = held / Math.max(1, target.sharesOutstanding);
    if (target.listed) {
      quote.tenderShares = target.sharesOutstanding - held;
      quote.contestable = contestable(state, target);
    }
    if (openOffers(state, id).length > 0) quote.minCompetingPrice = minCompetingPrice(state, id);
    out.push(quote);
  }
  return out;
}

/** Companies of the actor's group: root first, then by id. */
export function groupView(state: GameState, actorId: Id): GroupCompanyView[] {
  const root = state.actors[actorId]?.rootCompanyId;
  const ids = controlledBy(state, actorId).sort((a, b) =>
    a === root ? -1 : b === root ? 1 : a.localeCompare(b),
  );
  const members = new Set<HolderId>([actorId, ...ids]);
  const shares = root ? effectiveShares(state, root, ids) : {};
  return ids.flatMap((id) => {
    const c = state.companies[id];
    if (!c) return [];
    const register = state.stock.registry[id] ?? {};
    const holders = Object.keys(register)
      .filter((h) => members.has(h))
      .sort((a, b) => (register[b] ?? 0) - (register[a] ?? 0) || a.localeCompare(b));
    const held = sum(holders.map((h) => register[h] ?? 0));
    const cost = sum(ids.map((h) => state.companies[h]?.participations[id]?.cost ?? 0));
    const { pnl, balance } = c.books.current;
    const groupShare = shares[id] ?? 0;
    const view: GroupCompanyView = {
      companyId: id,
      name: c.name,
      sector: c.sector,
      status: c.status,
      listed: c.listed,
      isRoot: id === root,
      parentId: holders[0] ?? actorId,
      stake: held / Math.max(1, c.sharesOutstanding),
      value: held * shareValue(state, c),
      revenue: pnl.revenue,
      ebitda: pnl.ebitda,
      netIncome: pnl.netIncome,
      cash: balance.cash,
      equity: balance.equity,
      debt: balance.debt,
      groupShare,
      contribution: groupShare * (pnl.netIncome - pnl.groupFinancial),
      groupLoans: groupLoansGranted(state, id),
      groupDebt: groupDebt(c),
      stakes: ids
        .filter((t) => t !== id && (state.stock.registry[t]?.[id] ?? 0) > 0)
        .map((t) => ({
          targetId: t,
          shares: state.stock.registry[t]?.[id] ?? 0,
          value: c.stakeValues[t] ?? 0,
        })),
    };
    if (id !== root) view.cost = cost;
    const integration = state.mna.integrations.find((i) => i.companyId === id);
    if (integration && isOperating(c)) view.integrationUntil = integration.until;
    return [view];
  });
}

/** Intra-group loans owed by the companies of the actor's group, or granted by them. */
export function groupLoansView(state: GameState, actorId: Id): GroupLoanView[] {
  const ids = new Set(controlledBy(state, actorId));
  const out: GroupLoanView[] = [];
  for (const id of Object.keys(state.companies).sort()) {
    for (const loan of state.companies[id]?.loans ?? []) {
      if (loan.kind !== 'group') continue;
      const lenderId = loan.lenderId ?? '';
      if (!ids.has(id) && !ids.has(lenderId)) continue;
      out.push({
        lenderId,
        borrowerId: id,
        principal: loan.principal,
        rate: Math.max(0, state.macro.policyRate + loan.spread),
      });
    }
  }
  return out;
}

/** Open tender offers and what the viewed company may do: raise or withdraw its own, tender its shares. */
export function offerViews(state: GameState, company: Company): OfferView[] {
  return openOffers(state).map((offer) => {
    const mine = offer.bidderId === company.id;
    return {
      offer: structuredClone(offer),
      mine,
      minRaise: minCompetingPrice(state, offer.targetId),
      canWithdraw: mine && canWithdraw(state, offer),
      held: mine ? 0 : (state.stock.registry[offer.targetId]?.[company.id] ?? 0),
      bestPrice: Math.max(...openOffers(state, offer.targetId).map((o) => o.pricePerShare)),
    };
  });
}
