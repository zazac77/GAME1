import type { TurnContext } from '../../core/context';
import { isOperating, operatingCompanies } from '../../core/companies';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { DealAction, MnaAction } from '../../model/decisions';
import type { Id } from '../../model/ids';
import type { TenderOffer } from '../../model/stock';
import { revalueHoldings } from '../stockmarket/holdings';
import { announceStakes, updateCampaigns } from './disclosure';
import { updateListings } from './listings';
import {
  buyBlock,
  buyListing,
  executeOffer,
  fail,
  flowsOf,
  launchOffer,
  newOffer,
  type Flows,
} from './offers';
import {
  boardPremium,
  canTarget,
  canWithdraw,
  diligenceOnCompany,
  dueDiligenceCost,
  groupHead,
  openListing,
  openOffers,
} from './rules';

export * from './rules';
export { drawListing, trailingFigures } from './listings';

/**
 * Step 3 (after the financing): due diligences ordered this quarter are paid
 * (results usable from the next quarter); companies being integrated pay
 * their integration costs, and an undeclared liability of a bought listing
 * hits its accounts in its first quarter.
 */
export const mnaPreSystem: System = {
  id: 'mnaPre',
  run(ctx) {
    const { draft, config, turn } = ctx;
    const M = config.mna;
    draft.mna.diligence = draft.mna.diligence.filter((d) => d.expiresAt > turn);
    for (const company of operatingCompanies(draft)) {
      for (const action of ctx.decisions[company.id]?.mna ?? []) {
        if (action.kind !== 'due_diligence') continue;
        const listing = openListing(draft, action.targetId);
        const target = draft.companies[action.targetId];
        if (!listing && !target) continue;
        const cost = dueDiligenceCost(draft, action.targetId, ctx.openingPriceLevel);
        ctx.ledger(company.id).other += cost;
        const found = listing
          ? {
              figures: { ...listing.actual },
              netDebt: listing.netDebt,
              hiddenLiability: listing.hiddenLiability,
            }
          : { ...diligenceOnCompany(target as Company), hiddenLiability: 0 };
        draft.mna.diligence.push({
          buyerId: company.id,
          targetId: action.targetId,
          orderedAt: turn,
          expiresAt: turn + 1 + M.dueDiligence.validQuarters,
          ...found,
        });
        ctx.log({
          kind: 'due_diligence',
          severity: 'info',
          companyId: company.id,
          data: { targetId: action.targetId, cost },
        });
      }
    }
    for (const integration of draft.mna.integrations) {
      const company = draft.companies[integration.companyId];
      if (!company || !isOperating(company)) continue;
      const ledger = ctx.ledger(company.id);
      if (turn < integration.until) {
        ledger.other += M.integration.costShareOfRevenue * company.books.current.pnl.revenue;
      }
      if (integration.pendingCharge > 0) {
        ledger.other += integration.pendingCharge;
        ctx.log({
          kind: 'hidden_liability',
          severity: 'warning',
          companyId: company.id,
          data: { amount: integration.pendingCharge, acquirerId: integration.acquirerId },
        });
        integration.pendingCharge = 0;
      }
    }
    draft.mna.integrations = draft.mna.integrations.filter((i) => {
      const done = i.until <= turn && i.pendingCharge <= 0;
      if (done && draft.companies[i.companyId]) {
        ctx.log({ kind: 'integration_completed', severity: 'info', companyId: i.companyId });
      }
      return !done;
    });
  },
};

/**
 * Step 12: takeovers, on the cash each buyer has after closing its accounts,
 * target by target (by id):
 * - withdrawals and raises of open offers, then the new bids. On a target
 *   under offer, a new tender offer competes (above the best open price by
 *   minOverbid) and a raise or a competing offer extends the contest by a
 *   quarter (at most maxQuarters after the first launch); a block purchase
 *   waits for the contest to end. Otherwise the best bid per share (then the
 *   lowest buyer id) goes ahead: a listing at its price; a block, if its
 *   holder gets its premium (listed: mandatory offer to the others); a
 *   friendly tender offer settled at once; a hostile one opened;
 * - open offers reaching their close: the best price wins, the others fail.
 *   The board backs it from its premium (× whiteKnightAskFactor for an offer
 *   competing with a hostile one); each holder tenders if its premium is
 *   met, the float by tranches. It succeeds only if the buyer's group ends in
 *   control (after a poison pill the board adopted against it).
 * Then every company's holdings are revalued, holdings crossing a disclosure
 * threshold are declared, activist campaigns updated and listings renewed.
 */
export const mnaSystem: System = {
  id: 'mna',
  run(ctx) {
    const { draft, turn } = ctx;
    const flows: Record<Id, Flows> = {};
    const actions: { buyer: Company; action: Exclude<MnaAction, { kind: 'due_diligence' }> }[] = [];
    for (const company of operatingCompanies(draft)) {
      for (const action of ctx.decisions[company.id]?.mna ?? []) {
        if (action.kind !== 'due_diligence') actions.push({ buyer: company, action });
      }
    }
    const offerById = (id: Id) => draft.stock.tenderOffers.find((o) => o.id === id);
    const targetOf = (a: (typeof actions)[number]['action']): Id | undefined =>
      'targetId' in a ? a.targetId : offerById(a.offerId)?.targetId;
    // Shares the companies tender to open offers, by offer.
    const tendered: Record<Id, Set<Id>> = {};
    for (const { buyer, action } of actions) {
      if (action.kind === 'tender_shares') (tendered[action.offerId] ??= new Set()).add(buyer.id);
    }
    const targets = [
      ...new Set([
        ...actions.flatMap((a) => targetOf(a.action) ?? []),
        ...openOffers(draft).map((o) => o.targetId),
      ]),
    ].sort();
    for (const targetId of targets) {
      contest(
        ctx,
        targetId,
        actions.filter((a) => targetOf(a.action) === targetId),
        tendered,
        flows,
      );
    }

    // Revalue every company that closed this quarter: deals, new prices, groups.
    for (const company of Object.keys(draft.companies)
      .sort()
      .map((id) => draft.companies[id] as Company)) {
      const statements = company.books.current;
      if (statements.quarter !== turn) continue;
      const f = flowsOf(flows, company.id);
      const b = statements.balance;
      // A loan sized to the shortfall lands the cash on 0 exactly (no float residue).
      const cash = Math.max(0, b.cash + f.sold - f.bought + f.borrowed) - b.cash;
      b.cash += cash;
      b.debt += f.borrowed;
      b.equity += f.issued;
      statements.cashFlow.investing += f.sold - f.bought;
      statements.cashFlow.financing += cash - (f.sold - f.bought);
      statements.cashFlow.netChange += cash;
      statements.shares = company.sharesOutstanding;
      // Gains on the stakes sold, impairments, revaluations.
      const { carrying, result, groupResult } = revalueHoldings(draft, company, f.stakes);
      b.financialAssets = carrying;
      b.equity += result;
      statements.pnl.financial += result;
      statements.pnl.groupFinancial += groupResult;
      statements.pnl.netIncome += result;
      const history = company.books.history;
      if (history.at(-1)?.quarter === turn) history[history.length - 1] = statements;
    }

    announceStakes(ctx);
    updateCampaigns(ctx);
    updateListings(ctx);
    // Closed offers: the last dealHistory are kept (open ones always).
    const max = draft.config.mna.dealHistory;
    const closed = draft.stock.tenderOffers.filter((o) => o.status !== 'open');
    const drop = new Set(closed.slice(0, Math.max(0, closed.length - max)));
    draft.stock.tenderOffers = draft.stock.tenderOffers.filter((o) => !drop.has(o));
  },
};

type Action = Exclude<MnaAction, { kind: 'due_diligence' }>;

/** Everything that happens on one target this quarter (see mnaSystem). */
function contest(
  ctx: TurnContext,
  targetId: Id,
  entries: { buyer: Company; action: Action }[],
  tendered: Record<Id, Set<Id>>,
  flows: Record<Id, Flows>,
): void {
  const { draft, turn } = ctx;
  const O = draft.config.mna.offers;
  const ownOpen = (buyer: Company, offerId: Id): TenderOffer | undefined =>
    openOffers(draft, targetId).find(
      (o) => o.id === offerId && o.bidderId === buyer.id && o.launchedAt < turn,
    );
  let extended = false;

  for (const { buyer, action } of entries) {
    if (action.kind !== 'withdraw_offer') continue;
    const offer = ownOpen(buyer, action.offerId);
    if (!offer || !canWithdraw(draft, offer)) continue;
    offer.status = 'withdrawn';
    offer.expiresAt = turn;
    ctx.log({
      kind: 'tender_offer_withdrawn',
      severity: 'info',
      companyId: buyer.id,
      data: { targetId, pricePerShare: offer.pricePerShare },
    });
  }
  for (const { buyer, action } of entries) {
    if (action.kind !== 'raise_offer') continue;
    const offer = ownOpen(buyer, action.offerId);
    if (!offer || !(action.pricePerShare > offer.pricePerShare)) continue;
    offer.pricePerShare = action.pricePerShare;
    offer.premium = offer.basePrice > 0 ? action.pricePerShare / offer.basePrice - 1 : 0;
    if (action.stockShare !== undefined)
      offer.stockShare = Math.min(1, Math.max(0, action.stockShare));
    if (action.debt !== undefined) offer.debt = Math.max(0, action.debt);
    offer.raises += 1;
    extended = true;
    ctx.log({
      kind: 'tender_offer_raised',
      severity: 'warning',
      companyId: buyer.id,
      data: { targetId, pricePerShare: offer.pricePerShare, premium: offer.premium },
    });
  }

  const bids = entries
    .filter(
      (e): e is { buyer: Company; action: DealAction } =>
        e.action.kind === 'tender_offer' || e.action.kind === 'private_purchase',
    )
    .sort(
      (a, b) =>
        (b.action.pricePerShare ?? 0) - (a.action.pricePerShare ?? 0) ||
        a.buyer.id.localeCompare(b.buyer.id),
    );
  const open = openOffers(draft, targetId);
  if (open.length > 0) {
    // A contest under way: tender offers compete, blocks wait.
    for (const { buyer, action } of bids) {
      const target = draft.companies[targetId];
      const best = Math.max(...openOffers(draft, targetId).map((o) => o.pricePerShare));
      if (
        action.kind !== 'tender_offer' ||
        !target ||
        !canTarget(draft, buyer, target) ||
        action.pricePerShare < best * (1 + O.minOverbid) - 1e-9 ||
        openOffers(draft, targetId).some(
          (o) => groupHead(draft, o.bidderId) === groupHead(draft, buyer.id),
        )
      ) {
        fail(ctx, buyer, targetId, 'under_offer');
        continue;
      }
      const offer = newOffer(ctx, buyer, target, action, open[0]?.basePrice);
      offer.status = 'open';
      offer.hostile = action.hostile === true;
      offer.expiresAt = turn + O.periodQuarters;
      draft.stock.tenderOffers.push(offer);
      extended = true;
      ctx.log({
        kind: 'competing_offer',
        severity: 'warning',
        companyId: buyer.id,
        data: { targetId, pricePerShare: offer.pricePerShare, premium: offer.premium },
      });
    }
  } else {
    bids.forEach(({ buyer, action }, i) => {
      if (i > 0) return fail(ctx, buyer, targetId, 'outbid');
      if (!isOperating(buyer)) return;
      const listing = openListing(draft, targetId);
      if (listing) return buyListing(ctx, buyer, listing, action, flows);
      const target = draft.companies[targetId];
      if (!target || !canTarget(draft, buyer, target)) return fail(ctx, buyer, targetId, 'invalid');
      if (action.kind === 'private_purchase') return buyBlock(ctx, buyer, target, action, flows);
      launchOffer(ctx, buyer, target, action, flows);
    });
  }

  const contested = openOffers(draft, targetId);
  if (contested.length === 0) return;
  const cap = Math.min(...contested.map((o) => o.launchedAt)) + O.maxQuarters;
  if (extended) {
    for (const o of contested) o.expiresAt = Math.min(Math.max(o.expiresAt, turn + 1), cap);
  }
  if (contested.some((o) => o.expiresAt > turn)) return;

  // The close: the best price wins.
  const ranked = [...contested].sort(
    (a, b) =>
      b.pricePerShare - a.pricePerShare || a.launchedAt - b.launchedAt || a.id.localeCompare(b.id),
  );
  const hostile = ranked.some((o) => o.hostile);
  ranked.forEach((offer, i) => {
    if (i === 0) return;
    offer.status = 'failed';
    offer.expiresAt = turn;
    fail(ctx, offer.bidderId, targetId, 'outbid');
  });
  const winner = ranked[0] as TenderOffer;
  const target = draft.companies[targetId];
  const board = target ? boardPremium(draft, target) : undefined;
  const factor = hostile && !winner.hostile ? O.whiteKnightAskFactor : 1;
  const backs = board !== undefined && winner.premium >= board * factor;
  executeOffer(ctx, winner, backs, tendered[winner.id] ?? new Set(), flows);
}
