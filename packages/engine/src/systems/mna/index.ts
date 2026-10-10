import type { TurnContext } from '../../core/context';
import { isOperating, operatingCompanies } from '../../core/companies';
import { controlledBy, controllingActor, groupHolding } from '../../core/control';
import { newId } from '../../core/ids';
import { sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { MnaAction } from '../../model/decisions';
import type { HolderId, Id, Money } from '../../model/ids';
import type { TenderOffer } from '../../model/stock';
import { currentSpread } from '../finance/credit';
import { maxSharesKeepingControl } from '../finance/equity';
import { holdings, revalueHoldings, type StakeTrades } from '../stockmarket/holdings';
import { instantiateListing, updateListings } from './listings';
import {
  askedPremium,
  blockSeller,
  boardPremium,
  canTarget,
  diligenceOnCompany,
  dueDiligenceCost,
  groupHead,
  listingPrice,
  openListing,
  referencePrice,
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

/** Cash moves of the step, by company, booked once every deal is settled. */
interface Flows {
  bought: Money;
  sold: Money;
  borrowed: Money;
  /** Value of the new shares given in exchange (equity issued in kind). */
  issued: Money;
  /** Stakes paid for (cash and shares) and sold, by target. */
  stakes: Record<Id, StakeTrades>;
}

type Bid = Extract<MnaAction, { kind: 'tender_offer' | 'private_purchase' }>;

/**
 * Step 12: takeovers. Every bid of the quarter is settled on the cash the
 * buyer has after closing its accounts: on each target, the best offer per
 * share (then the lowest buyer id) goes ahead. A listing becomes a company
 * of the buyer at its price; a block is bought if its holder gets the
 * premium it asks; a friendly tender offer needs the board's support, then
 * each holder tenders if the premium meets its own ask (the float by
 * tranches), and it succeeds only if the buyer's group ends in control
 * (squeeze-out above squeezeOutThreshold). Payment in cash, acquisition loan
 * and new shares of the buyer. A change of control starts an integration.
 * Then every company's holdings are revalued, and the listings renewed.
 */
export const mnaSystem: System = {
  id: 'mna',
  run(ctx) {
    const { draft, turn } = ctx;
    const flows: Record<Id, Flows> = {};
    const bids: { buyer: Company; bid: Bid }[] = [];
    for (const company of operatingCompanies(draft)) {
      for (const action of ctx.decisions[company.id]?.mna ?? []) {
        if (action.kind !== 'due_diligence') bids.push({ buyer: company, bid: action });
      }
    }
    const targets = [...new Set(bids.map((b) => b.bid.targetId))].sort();
    for (const targetId of targets) {
      const ranked = bids
        .filter((b) => b.bid.targetId === targetId)
        .sort(
          (a, b) =>
            (b.bid.pricePerShare ?? 0) - (a.bid.pricePerShare ?? 0) ||
            a.buyer.id.localeCompare(b.buyer.id),
        );
      ranked.forEach((b, i) => {
        if (i === 0) settleBid(ctx, b.buyer, b.bid, flows);
        else {
          ctx.log({
            kind: 'deal_failed',
            severity: 'info',
            companyId: b.buyer.id,
            data: { targetId, reason: 'outbid' },
          });
        }
      });
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

    updateListings(ctx);
    const max = draft.config.mna.dealHistory;
    const offers = draft.stock.tenderOffers;
    if (offers.length > max) offers.splice(0, offers.length - max);
  },
};

const flowsOf = (flows: Record<Id, Flows>, id: Id): Flows =>
  (flows[id] ??= { bought: 0, sold: 0, borrowed: 0, issued: 0, stakes: {} });

const stakeOf = (f: Flows, targetId: Id): StakeTrades =>
  (f.stakes[targetId] ??= { bought: 0, sold: 0 });

/** Cash the buyer still has in this step. */
function cashLeft(buyer: Company, f: Flows): Money {
  return buyer.books.current.balance.cash - f.bought + f.sold + f.borrowed;
}

/**
 * Pays `total`: stockShare of it in new shares of the buyer (listed, at its
 * opening price, within what keeps its controller in control), the rest in
 * cash, drawing on an acquisition loan up to `debtRoom` when the cash runs
 * short. Returns false (nothing done) if the buyer cannot pay.
 */
function pay(
  ctx: TurnContext,
  buyer: Company,
  total: Money,
  stockShare: number,
  debtRoom: Money,
  flows: Record<Id, Flows>,
): { ok: boolean; debtUsed: Money } {
  const { draft, config, turn } = ctx;
  const f = flowsOf(flows, buyer.id);
  const price = ctx.openingPrices[buyer.id] ?? draft.stock.quotes[buyer.id]?.referencePrice ?? 0;
  const newShares =
    stockShare > 0 && buyer.listed && price > 0 ? Math.floor((total * stockShare) / price) : 0;
  if (newShares > maxSharesKeepingControl(draft, buyer)) return { ok: false, debtUsed: 0 };
  const inShares = newShares * price;
  const cashPart = total - inShares;
  const need = Math.max(0, cashPart - Math.max(0, cashLeft(buyer, f)));
  if (need > debtRoom + 1e-6) return { ok: false, debtUsed: 0 };
  if (need > 0) {
    buyer.loans.push({
      id: newId(draft.meta, 'loan'),
      kind: 'term',
      principal: need,
      spread: currentSpread(config, buyer) + config.mna.financing.spreadPremium,
      maturity: turn + 1 + config.finance.loanTermQuarters,
    });
    f.borrowed += need;
  }
  f.bought += cashPart;
  f.issued += inShares;
  if (newShares > 0) {
    const register = (draft.stock.registry[buyer.id] ??= {});
    // The sellers sell the shares they receive on the market (they join the float).
    register.public = (register.public ?? 0) + newShares;
    buyer.sharesOutstanding += newShares;
  }
  return { ok: true, debtUsed: need };
}

/** Moves shares from sellers to the buyer; companies that sell are paid in cash. */
function transfer(
  ctx: TurnContext,
  target: Company,
  buyer: Company,
  sellers: Record<HolderId, number>,
  pricePerShare: Money,
  flows: Record<Id, Flows>,
): number {
  const register = (ctx.draft.stock.registry[target.id] ??= {});
  let moved = 0;
  for (const holderId of Object.keys(sellers).sort()) {
    const shares = Math.min(sellers[holderId] ?? 0, register[holderId] ?? 0);
    if (shares <= 0) continue;
    register[holderId] = (register[holderId] ?? 0) - shares;
    register[buyer.id] = (register[buyer.id] ?? 0) + shares;
    if (ctx.draft.companies[holderId]) {
      const f = flowsOf(flows, holderId);
      f.sold += shares * pricePerShare;
      stakeOf(f, target.id).sold += shares * pricePerShare;
    }
    moved += shares;
  }
  return moved;
}

function fail(ctx: TurnContext, buyer: Company, targetId: Id, reason: string): void {
  ctx.log({
    kind: 'deal_failed',
    severity: 'info',
    companyId: buyer.id,
    data: { targetId, reason },
  });
}

function settleBid(ctx: TurnContext, buyer: Company, bid: Bid, flows: Record<Id, Flows>): void {
  const { draft, turn } = ctx;
  if (!isOperating(buyer)) return;
  const stockShare = Math.min(1, Math.max(0, bid.stockShare ?? 0));
  const debtRoom = Math.max(0, bid.debt ?? 0);

  // ---- a listing: 100 % at its price --------------------------------------
  const listing = openListing(draft, bid.targetId);
  if (listing) {
    if (bid.kind !== 'private_purchase') return fail(ctx, buyer, listing.id, 'invalid');
    const price = listingPrice(draft, buyer.id, listing);
    if (!pay(ctx, buyer, price, stockShare, debtRoom, flows).ok) {
      return fail(ctx, buyer, listing.id, 'financing');
    }
    const company = instantiateListing(ctx, listing, buyer.id);
    buyer.participations[company.id] = { shares: company.sharesOutstanding, cost: price };
    stakeOf(flowsOf(flows, buyer.id), company.id).bought += price;
    draft.mna.listings = draft.mna.listings.filter((l) => l.id !== listing.id);
    startIntegration(ctx, company, buyer, listing.hiddenLiability);
    ctx.log({
      kind: 'takeover',
      severity: 'warning',
      companyId: buyer.id,
      data: { targetId: company.id, mode: 'listing', price, shares: company.sharesOutstanding },
    });
    return;
  }

  // ---- an existing company --------------------------------------------------
  const target = draft.companies[bid.targetId];
  if (!target || !canTarget(draft, buyer, target)) return fail(ctx, buyer, bid.targetId, 'invalid');
  const pricePerShare = bid.pricePerShare ?? 0;
  const reference = target.listed
    ? (ctx.openingPrices[target.id] ?? referencePrice(draft, target))
    : referencePrice(draft, target);
  const premium = reference > 0 ? pricePerShare / reference - 1 : 0;
  const register = draft.stock.registry[target.id] ?? {};
  const head = groupHead(draft, buyer.id);
  const group = new Set<HolderId>([head, buyer.id, ...controlledBy(draft, head)]);
  const controllerBefore = controllingActor(draft, target.id);
  const priorCarrying = holdings(draft, buyer)[target.id]?.carrying ?? 0;
  const threshold = draft.config.mna.controlThreshold * target.sharesOutstanding;
  const sellers: Record<HolderId, number> = {};

  if (bid.kind === 'private_purchase') {
    const seller = blockSeller(draft, target);
    if (!seller || group.has(seller)) return fail(ctx, buyer, target.id, 'invalid');
    const asked = askedPremium(draft, seller, target);
    if (asked === undefined || premium < asked) {
      ctx.log({
        kind: 'block_purchase_rejected',
        severity: 'info',
        companyId: buyer.id,
        data: { targetId: target.id, premium },
      });
      return;
    }
    sellers[seller] = register[seller] ?? 0;
  } else {
    if (!target.listed) return fail(ctx, buyer, target.id, 'invalid');
    const offer: TenderOffer = {
      id: newId(draft.meta, 'opa'),
      bidderId: buyer.id,
      targetId: target.id,
      pricePerShare,
      premium,
      stockShare,
      launchedAt: turn,
      expiresAt: turn,
      status: 'rejected',
      acquired: 0,
    };
    draft.stock.tenderOffers.push(offer);
    const board = boardPremium(draft, target);
    if (board === undefined || premium < board) {
      ctx.log({
        kind: 'tender_offer_rejected',
        severity: 'warning',
        companyId: buyer.id,
        data: { targetId: target.id, premium, pricePerShare },
      });
      return;
    }
    // Each holder outside the buyer's group decides; the float by tranches.
    const D = draft.config.stockMarket.tenderPremiumDist;
    for (const holderId of Object.keys(register).sort()) {
      const held = register[holderId] ?? 0;
      if (held <= 0 || group.has(holderId)) continue;
      if (holderId === 'public') {
        const size = Math.floor(held / D.tranches);
        let tendered = 0;
        for (let k = 0; k < D.tranches; k++) {
          const asked = Math.max(0, ctx.rng.normal(D.mean, D.std));
          const shares = k === D.tranches - 1 ? held - size * (D.tranches - 1) : size;
          if (premium >= asked) tendered += shares;
        }
        if (tendered > 0) sellers.public = tendered;
      } else if (holderId === controllerBefore) sellers[holderId] = held;
      else {
        const asked = askedPremium(draft, holderId, target);
        if (asked !== undefined && premium >= asked) sellers[holderId] = held;
      }
    }
    const after = groupHolding(draft, head, target.id) + sum(Object.values(sellers));
    if (after <= threshold) {
      offer.status = 'failed';
      return fail(ctx, buyer, target.id, 'no_control');
    }
    offer.status = 'succeeded';
  }

  const wanted = sum(Object.values(sellers));
  const total = wanted * pricePerShare;
  if (!pay(ctx, buyer, total, stockShare, debtRoom, flows).ok) {
    const offer = draft.stock.tenderOffers.at(-1);
    if (bid.kind === 'tender_offer' && offer?.targetId === target.id) offer.status = 'failed';
    return fail(ctx, buyer, target.id, 'financing');
  }
  let acquired = transfer(ctx, target, buyer, sellers, pricePerShare, flows);
  let paid = total;

  // Squeeze-out: above the threshold, the rest is bought in cash at the same price.
  if (
    bid.kind === 'tender_offer' &&
    groupHolding(draft, head, target.id) >=
      draft.config.mna.squeezeOutThreshold * target.sharesOutstanding
  ) {
    const rest: Record<HolderId, number> = {};
    for (const [holderId, held] of Object.entries(draft.stock.registry[target.id] ?? {})) {
      if (!group.has(holderId) && held > 0) rest[holderId] = held;
    }
    const restTotal = sum(Object.values(rest)) * pricePerShare;
    const debtUsed = flowsOf(flows, buyer.id).borrowed;
    if (
      restTotal > 0 &&
      pay(ctx, buyer, restTotal, 0, Math.max(0, debtRoom - debtUsed), flows).ok
    ) {
      acquired += transfer(ctx, target, buyer, rest, pricePerShare, flows);
      paid += restTotal;
      target.listed = false;
      draft.stock.quotes = Object.fromEntries(
        Object.entries(draft.stock.quotes).filter(([id]) => id !== target.id),
      );
      ctx.log({ kind: 'delisted', severity: 'critical', companyId: target.id });
    }
  }
  const offer = draft.stock.tenderOffers.at(-1);
  if (bid.kind === 'tender_offer' && offer?.targetId === target.id) offer.acquired = acquired;
  const quote = draft.stock.quotes[target.id];
  if (quote) {
    quote.price = Math.max(quote.price, pricePerShare);
    quote.referencePrice = quote.price;
  }

  const held = draft.stock.registry[target.id]?.[buyer.id] ?? 0;
  buyer.participations[target.id] = { shares: held, cost: priorCarrying + paid };
  stakeOf(flowsOf(flows, buyer.id), target.id).bought += paid;
  if (controllingActor(draft, target.id) !== controllerBefore) {
    startIntegration(ctx, target, buyer, 0);
  }
  ctx.log({
    kind: 'takeover',
    severity: 'warning',
    companyId: buyer.id,
    data: {
      targetId: target.id,
      mode: bid.kind === 'tender_offer' ? 'tender_offer' : 'block',
      price: paid,
      pricePerShare,
      premium,
      shares: acquired,
    },
  });
}

/**
 * A change of control: integration costs for `quarters` quarters, talent
 * departures and a productivity dip (modifiers on the company), and the
 * undeclared liability of a bought listing, booked in its first quarter.
 */
function startIntegration(
  ctx: TurnContext,
  company: Company,
  acquirer: Company,
  pendingCharge: Money,
): void {
  const { draft, turn } = ctx;
  const I = draft.config.mna.integration;
  draft.mna.integrations = draft.mna.integrations.filter((i) => i.companyId !== company.id);
  draft.mna.integrations.push({
    companyId: company.id,
    acquirerId: acquirer.id,
    startedAt: turn + 1,
    until: turn + 1 + I.quarters,
    pendingCharge,
  });
  if (I.quarters <= 0) return;
  // Modifiers age at the start of the next quarter: they act over `quarters` quarters.
  for (const [key, value] of [
    ['labor.attrition', I.attritionMultiplier],
    ['labor.productivity', I.productivityMultiplier],
  ] as const) {
    if (value === 1) continue;
    draft.modifiers.push({
      id: newId(draft.meta, 'mod'),
      sourceId: 'mna_integration',
      target: { kind: 'company', id: company.id },
      key,
      op: 'mul',
      value,
      remaining: I.quarters + 1,
      decay: 0,
    });
  }
}
