import type { TurnContext } from '../../core/context';
import { isOperating } from '../../core/companies';
import { controlledBy, controllingActor, groupHolding } from '../../core/control';
import { newId } from '../../core/ids';
import { sum } from '../../core/math';
import type { Company } from '../../model/company';
import type { DealAction } from '../../model/decisions';
import type { HolderId, Id, Money } from '../../model/ids';
import type { TargetListing } from '../../model/mna';
import type { TenderOffer } from '../../model/stock';
import { profileOf } from '../../ai/profiles';
import { currentSpread } from '../finance/credit';
import { maxSharesKeepingControl } from '../finance/equity';
import { holdings, type StakeTrades } from '../stockmarket/holdings';
import { instantiateListing } from './listings';
import {
  acquisitionDebtCapacity,
  askedPremium,
  blockSeller,
  boardPremium,
  boardProfile,
  groupHead,
  listingPrice,
  referencePrice,
} from './rules';

/** Cash moves of the step, by company, booked once every deal is settled. */
export interface Flows {
  bought: Money;
  sold: Money;
  borrowed: Money;
  /** Value of the new shares given in exchange (equity issued in kind). */
  issued: Money;
  /** Stakes paid for (cash and shares) and sold, by target. */
  stakes: Record<Id, StakeTrades>;
}

export const flowsOf = (flows: Record<Id, Flows>, id: Id): Flows =>
  (flows[id] ??= { bought: 0, sold: 0, borrowed: 0, issued: 0, stakes: {} });

const stakeOf = (f: Flows, targetId: Id): StakeTrades =>
  (f.stakes[targetId] ??= { bought: 0, sold: 0 });

/** Cash the buyer still has in this step. */
function cashLeft(buyer: Company, f: Flows): Money {
  return buyer.books.current.balance.cash - f.bought + f.sold + f.borrowed;
}

export function fail(ctx: TurnContext, buyer: Company | Id, targetId: Id, reason: string): void {
  ctx.log({
    kind: 'deal_failed',
    severity: 'info',
    companyId: typeof buyer === 'string' ? buyer : buyer.id,
    data: { targetId, reason },
  });
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
): boolean {
  const { draft, config, turn } = ctx;
  const f = flowsOf(flows, buyer.id);
  const price = ctx.openingPrices[buyer.id] ?? draft.stock.quotes[buyer.id]?.referencePrice ?? 0;
  const newShares =
    stockShare > 0 && buyer.listed && price > 0 ? Math.floor((total * stockShare) / price) : 0;
  if (newShares > maxSharesKeepingControl(draft, buyer)) return false;
  const inShares = newShares * price;
  const cashPart = total - inShares;
  const need = Math.max(0, cashPart - Math.max(0, cashLeft(buyer, f)));
  if (need > debtRoom + 1e-6) return false;
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
  return true;
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

/** The buyer's group: the actor at its head (or the buyer), the buyer and what the head controls. */
function groupOf(ctx: TurnContext, buyer: Company): { head: HolderId; members: Set<HolderId> } {
  const head = groupHead(ctx.draft, buyer.id);
  return { head, members: new Set<HolderId>([head, buyer.id, ...controlledBy(ctx.draft, head)]) };
}

/**
 * Holders outside the buyer's group that sell at `premium`: the controlling
 * shareholder when the board backs the offer; any other holder whose own
 * premium is met (the player's companies only if they tendered, `tendered`);
 * the float by tranches, each asking a premium drawn from tenderPremiumDist
 * (+ oppositionPremium when the board fights the offer).
 */
function tenderers(
  ctx: TurnContext,
  target: Company,
  members: Set<HolderId>,
  premium: number,
  boardBacks: boolean,
  tendered: ReadonlySet<Id> = new Set(),
  skip: ReadonlySet<HolderId> = new Set(),
): Record<HolderId, number> {
  const { draft } = ctx;
  const register = draft.stock.registry[target.id] ?? {};
  const controller = controllingActor(draft, target.id);
  const D = draft.config.stockMarket.tenderPremiumDist;
  const opposition = boardBacks ? 0 : draft.config.mna.offers.oppositionPremium;
  const sellers: Record<HolderId, number> = {};
  for (const holderId of Object.keys(register).sort()) {
    const held = register[holderId] ?? 0;
    if (held <= 0 || members.has(holderId) || skip.has(holderId)) continue;
    if (holderId === 'public') {
      const size = Math.floor(held / D.tranches);
      let shares = 0;
      for (let k = 0; k < D.tranches; k++) {
        const asked = Math.max(0, ctx.rng.normal(D.mean, D.std)) + opposition;
        const tranche = k === D.tranches - 1 ? held - size * (D.tranches - 1) : size;
        if (premium >= asked) shares += tranche;
      }
      if (shares > 0) sellers.public = shares;
    } else if (boardBacks && holderId === controller) sellers[holderId] = held;
    else if (tendered.has(holderId)) sellers[holderId] = held;
    else {
      const asked = askedPremium(draft, holderId, target);
      if (asked !== undefined && premium >= asked) sellers[holderId] = held;
    }
  }
  return sellers;
}

/**
 * Poison pill triggered: every holder outside the bidder's group gets
 * pillShareRatio new shares per share held, for free. The price, the fundamental,
 * the price history, open offers and the share counts of the published
 * accounts are adjusted as for a split; equity and cash do not move.
 */
function triggerPill(
  ctx: TurnContext,
  target: Company,
  members: Set<HolderId>,
): { added: number; factor: number } {
  const { draft, turn } = ctx;
  const register = draft.stock.registry[target.id] ?? {};
  const ratio = draft.config.mna.offers.pillShareRatio;
  const before = target.sharesOutstanding;
  let added = 0;
  for (const holderId of Object.keys(register).sort()) {
    const held = register[holderId] ?? 0;
    if (held <= 0 || members.has(holderId)) continue;
    const extra = Math.floor(held * ratio);
    if (extra <= 0) continue;
    register[holderId] = held + extra;
    added += extra;
    const p = draft.companies[holderId]?.participations[target.id];
    if (p) p.shares += extra;
  }
  if (added <= 0) return { added: 0, factor: 1 };
  target.sharesOutstanding += added;
  const f = before / target.sharesOutstanding;
  const quote = draft.stock.quotes[target.id];
  if (quote) {
    quote.price *= f;
    quote.referencePrice *= f;
    quote.fundamental *= f;
    quote.history = quote.history.map((p) => p * f);
  }
  for (const o of draft.stock.tenderOffers) {
    if (o.status !== 'open' || o.targetId !== target.id) continue;
    o.pricePerShare *= f;
    o.basePrice *= f;
  }
  for (const s of target.books.history) {
    if (s.quarter < turn) s.shares = Math.round(s.shares / f);
  }
  return { added, factor: f };
}

/** What a settled deal leaves behind: cost basis, price, integration, the takeover news. */
function closeDeal(
  ctx: TurnContext,
  buyer: Company,
  target: Company,
  data: {
    mode: 'tender_offer' | 'block';
    paid: Money;
    pricePerShare: Money;
    premium: number;
    acquired: number;
    priorCarrying: Money;
    controllerBefore: Id | undefined;
    mandatory?: number;
    hostile?: boolean;
    /** The price does not fall below this (the offer price, diluted by a poison pill). */
    priceFloor?: Money;
  },
  flows: Record<Id, Flows>,
): void {
  const { draft } = ctx;
  const quote = draft.stock.quotes[target.id];
  if (quote) {
    quote.price = Math.max(quote.price, data.priceFloor ?? data.pricePerShare);
    quote.referencePrice = quote.price;
  }
  const held = draft.stock.registry[target.id]?.[buyer.id] ?? 0;
  buyer.participations[target.id] = { shares: held, cost: data.priorCarrying + data.paid };
  stakeOf(flowsOf(flows, buyer.id), target.id).bought += data.paid;
  if (controllingActor(draft, target.id) !== data.controllerBefore) {
    startIntegration(ctx, target, buyer, 0);
  }
  const news: Record<string, number | string | boolean> = {
    targetId: target.id,
    mode: data.mode,
    price: data.paid,
    pricePerShare: data.pricePerShare,
    premium: data.premium,
    shares: data.acquired,
  };
  if (data.mandatory) news.mandatory = data.mandatory;
  if (data.hostile) news.hostile = true;
  ctx.log({ kind: 'takeover', severity: 'warning', companyId: buyer.id, data: news });
}

/** Above squeezeOutThreshold, the rest is bought in cash at the same price and the target delisted. */
function squeezeOut(
  ctx: TurnContext,
  buyer: Company,
  target: Company,
  members: Set<HolderId>,
  head: HolderId,
  pricePerShare: Money,
  debtRoom: Money,
  flows: Record<Id, Flows>,
): { acquired: number; paid: Money } {
  const { draft } = ctx;
  const out = { acquired: 0, paid: 0 };
  if (
    !target.listed ||
    groupHolding(draft, head, target.id) <
      draft.config.mna.squeezeOutThreshold * target.sharesOutstanding
  ) {
    return out;
  }
  const rest: Record<HolderId, number> = {};
  for (const [holderId, held] of Object.entries(draft.stock.registry[target.id] ?? {})) {
    if (!members.has(holderId) && held > 0) rest[holderId] = held;
  }
  const restTotal = sum(Object.values(rest)) * pricePerShare;
  const room = Math.max(0, debtRoom - flowsOf(flows, buyer.id).borrowed);
  if (restTotal > 0 && pay(ctx, buyer, restTotal, 0, room, flows)) {
    out.acquired = transfer(ctx, target, buyer, rest, pricePerShare, flows);
    out.paid = restTotal;
    target.listed = false;
    draft.stock.quotes = Object.fromEntries(
      Object.entries(draft.stock.quotes).filter(([id]) => id !== target.id),
    );
    // Offers still open on it lapse.
    for (const o of draft.stock.tenderOffers) {
      if (o.status === 'open' && o.targetId === target.id) o.status = 'failed';
    }
    ctx.log({ kind: 'delisted', severity: 'critical', companyId: target.id });
  }
  return out;
}

/** 100 % of a listing at its price. */
export function buyListing(
  ctx: TurnContext,
  buyer: Company,
  listing: TargetListing,
  bid: DealAction,
  flows: Record<Id, Flows>,
): void {
  const { draft } = ctx;
  if (bid.kind !== 'private_purchase') return fail(ctx, buyer, listing.id, 'invalid');
  const price = listingPrice(draft, buyer.id, listing);
  const stockShare = Math.min(1, Math.max(0, bid.stockShare ?? 0));
  if (!pay(ctx, buyer, price, stockShare, Math.max(0, bid.debt ?? 0), flows)) {
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
}

/**
 * The block of the target's controlling shareholder, if it gets the
 * premium it asks. A listed target: mandatory offer at the same price to
 * every other shareholder (each tenders if its own premium is met, the float
 * by tranches), paid with the block; squeeze-out above squeezeOutThreshold.
 */
export function buyBlock(
  ctx: TurnContext,
  buyer: Company,
  target: Company,
  bid: DealAction,
  flows: Record<Id, Flows>,
): void {
  const { draft } = ctx;
  const pricePerShare = bid.pricePerShare ?? 0;
  const reference = premiumBase(ctx, target);
  const premium = reference > 0 ? pricePerShare / reference - 1 : 0;
  const { head, members } = groupOf(ctx, buyer);
  const seller = blockSeller(draft, target);
  if (!seller || members.has(seller)) return fail(ctx, buyer, target.id, 'invalid');
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
  const controllerBefore = controllingActor(draft, target.id);
  const priorCarrying = holdings(draft, buyer)[target.id]?.carrying ?? 0;
  const register = draft.stock.registry[target.id] ?? {};
  const sellers: Record<HolderId, number> = { [seller]: register[seller] ?? 0 };
  let mandatory = 0;
  if (target.listed) {
    const others = tenderers(ctx, target, members, premium, true, new Set(), new Set([seller]));
    mandatory = sum(Object.values(others));
    Object.assign(sellers, others);
  }
  const total = sum(Object.values(sellers)) * pricePerShare;
  const stockShare = Math.min(1, Math.max(0, bid.stockShare ?? 0));
  const debtRoom = Math.max(0, bid.debt ?? 0);
  if (!pay(ctx, buyer, total, stockShare, debtRoom, flows)) {
    return fail(ctx, buyer, target.id, 'financing');
  }
  let acquired = transfer(ctx, target, buyer, sellers, pricePerShare, flows);
  let paid = total;
  const squeezed = squeezeOut(ctx, buyer, target, members, head, pricePerShare, debtRoom, flows);
  acquired += squeezed.acquired;
  paid += squeezed.paid;
  closeDeal(
    ctx,
    buyer,
    target,
    {
      mode: 'block',
      paid,
      pricePerShare,
      premium,
      acquired,
      priorCarrying,
      controllerBefore,
      mandatory,
    },
    flows,
  );
}

/** Price a premium is measured on: the target's price at the start of the quarter (else its value). */
function premiumBase(ctx: TurnContext, target: Company): Money {
  const quote = ctx.draft.stock.quotes[target.id];
  return target.listed && quote
    ? (ctx.openingPrices[target.id] ?? quote.referencePrice)
    : referencePrice(ctx.draft, target);
}

/** A new offer record (not yet in stock.tenderOffers). */
export function newOffer(
  ctx: TurnContext,
  buyer: Company,
  target: Company,
  bid: Extract<DealAction, { kind: 'tender_offer' }>,
  basePrice?: Money,
): TenderOffer {
  const base = basePrice ?? premiumBase(ctx, target);
  return {
    id: newId(ctx.draft.meta, 'opa'),
    bidderId: buyer.id,
    targetId: target.id,
    pricePerShare: bid.pricePerShare,
    premium: base > 0 ? bid.pricePerShare / base - 1 : 0,
    basePrice: base,
    stockShare: Math.min(1, Math.max(0, bid.stockShare ?? 0)),
    debt: Math.max(0, bid.debt ?? 0),
    hostile: false,
    launchedAt: ctx.turn,
    expiresAt: ctx.turn,
    status: 'rejected',
    acquired: 0,
    raises: 0,
    defenses: { pill: false, whiteKnight: false },
  };
}

/**
 * A new tender offer on a target nobody bids for yet: settled at once if the
 * board backs it (friendly); else opened for periodQuarters if `hostile` (an
 * AI board may adopt a poison pill, and looks for a white knight), or
 * rejected.
 */
export function launchOffer(
  ctx: TurnContext,
  buyer: Company,
  target: Company,
  bid: Extract<DealAction, { kind: 'tender_offer' }>,
  flows: Record<Id, Flows>,
): void {
  const { draft, turn } = ctx;
  if (!target.listed) return fail(ctx, buyer, target.id, 'invalid');
  const offer = newOffer(ctx, buyer, target, bid);
  draft.stock.tenderOffers.push(offer);
  const board = boardPremium(draft, target);
  if (board !== undefined && offer.premium >= board) {
    executeOffer(ctx, offer, true, new Set(), flows);
    return;
  }
  if (!bid.hostile) {
    ctx.log({
      kind: 'tender_offer_rejected',
      severity: 'warning',
      companyId: buyer.id,
      data: { targetId: target.id, premium: offer.premium, pricePerShare: offer.pricePerShare },
    });
    return;
  }
  offer.hostile = true;
  offer.status = 'open';
  offer.expiresAt = turn + draft.config.mna.offers.periodQuarters;
  const profileId = boardProfile(draft, target);
  if (profileId) {
    // The AI board fights: a poison pill (by its profile) and a white knight sought.
    const pill = profileOf(draft.config, profileId, target.sector).poisonPill;
    offer.defenses = { pill: ctx.rng.next() < pill, whiteKnight: true };
  }
  ctx.log({
    kind: 'hostile_offer',
    severity: 'critical',
    companyId: buyer.id,
    data: {
      targetId: target.id,
      pricePerShare: offer.pricePerShare,
      premium: offer.premium,
      pill: offer.defenses.pill,
      whiteKnight: offer.defenses.whiteKnight,
    },
  });
}

/**
 * Settles an offer: the holders that tender (tenderers), all-or-nothing on
 * the bidder's group ending above the control threshold — after the poison
 * pill when the board still fights an offer it adopted one against (the
 * pill is then triggered: the holders that kept their shares are diluted
 * by the new ones); payment; squeeze-out.
 */
export function executeOffer(
  ctx: TurnContext,
  offer: TenderOffer,
  boardBacks: boolean,
  tendered: ReadonlySet<Id>,
  flows: Record<Id, Flows>,
): void {
  const { draft } = ctx;
  const buyer = draft.companies[offer.bidderId];
  const target = draft.companies[offer.targetId];
  offer.expiresAt = ctx.turn;
  if (!buyer || !target || !isOperating(buyer) || !isOperating(target) || !target.listed) {
    offer.status = 'failed';
    return fail(ctx, offer.bidderId, offer.targetId, 'invalid');
  }
  const { head, members } = groupOf(ctx, buyer);
  const controllerBefore = controllingActor(draft, target.id);
  const priorCarrying = holdings(draft, buyer)[target.id]?.carrying ?? 0;
  const N = target.sharesOutstanding;
  const sellers = tenderers(ctx, target, members, offer.premium, boardBacks, tendered);
  const after = groupHolding(draft, head, target.id) + sum(Object.values(sellers));
  const pill = !boardBacks && offer.defenses.pill;
  // With the pill, those who keep their shares get pillShareRatio more each.
  const diluted = pill ? N + Math.floor((N - after) * draft.config.mna.offers.pillShareRatio) : N;
  if (after <= draft.config.mna.controlThreshold * diluted) {
    offer.status = 'failed';
    return fail(
      ctx,
      buyer,
      target.id,
      pill && after > draft.config.mna.controlThreshold * N ? 'pill' : 'no_control',
    );
  }
  const total = sum(Object.values(sellers)) * offer.pricePerShare;
  const debtRoom = Math.min(offer.debt, acquisitionDebtCapacity(draft, buyer, target.id));
  if (!pay(ctx, buyer, total, offer.stockShare, debtRoom, flows)) {
    offer.status = 'failed';
    return fail(ctx, buyer, target.id, 'financing');
  }
  offer.status = 'succeeded';
  let acquired = transfer(ctx, target, buyer, sellers, offer.pricePerShare, flows);
  let paid = total;
  let factor = 1;
  if (pill) {
    const { added, factor: f } = triggerPill(ctx, target, members);
    factor = f;
    ctx.log({
      kind: 'poison_pill',
      severity: 'warning',
      companyId: target.id,
      data: { bidderId: buyer.id, newShares: added },
    });
  }
  const squeezed = squeezeOut(
    ctx,
    buyer,
    target,
    members,
    head,
    offer.pricePerShare,
    debtRoom,
    flows,
  );
  acquired += squeezed.acquired;
  paid += squeezed.paid;
  offer.acquired = acquired;
  closeDeal(
    ctx,
    buyer,
    target,
    {
      mode: 'tender_offer',
      paid,
      pricePerShare: offer.pricePerShare,
      premium: offer.premium,
      acquired,
      priorCarrying,
      controllerBefore,
      hostile: !boardBacks,
      priceFloor: offer.pricePerShare * factor,
    },
    flows,
  );
}

/**
 * A change of control: integration costs for `quarters` quarters, talent
 * departures and a productivity dip (modifiers on the company), and the
 * undeclared liability of a bought listing, booked in its first quarter.
 */
export function startIntegration(
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
