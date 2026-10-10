import { profileOf } from '../../ai/profiles';
import { isOperating } from '../../core/companies';
import { controllingActor, groupHolding, managementProfile, sameGroup } from '../../core/control';
import type { Company } from '../../model/company';
import type { AiProfileId, HolderId, Id, Money } from '../../model/ids';
import type { DueDiligence, TargetListing } from '../../model/mna';
import type { GameState } from '../../model/state';
import type { TenderOffer } from '../../model/stock';
import { trailingAnnual } from '../finance/credit';
import { shareValue } from '../stockmarket/holdings';

/** Price of reference of a target: its quote at the start of the quarter, else its private value. */
export function referencePrice(state: GameState, company: Company): Money {
  const quote = state.stock.quotes[company.id];
  return company.listed && quote ? quote.referencePrice : shareValue(state, company);
}

/**
 * Profile deciding for a holder whether to sell: an AI actor's own, the
 * profile of the actor controlling a company (else its management's).
 * Undefined when the player decides: the player's companies sell only
 * the shares they tender to an open offer (tender_shares).
 */
function holderProfile(state: GameState, holderId: HolderId): AiProfileId | undefined {
  const player = state.meta.playerActorId;
  const actor = state.actors[holderId];
  if (actor) {
    if (actor.id === player) return undefined;
    return actor.profileId ?? state.config.mna.delegatedProfileId;
  }
  const company = state.companies[holderId];
  if (!company) return undefined;
  const controller = controllingActor(state, company.id);
  if (controller === player) return undefined;
  const owner = controller ? state.actors[controller] : undefined;
  return owner?.profileId ?? managementProfile(state, company);
}

/** Whether a holder is the activist fund (its actor, or a company that actor controls). */
export function isFundHolder(state: GameState, holderId: HolderId): boolean {
  const actorId = state.actors[holderId] ? holderId : controllingActor(state, holderId);
  return actorId !== undefined && state.actors[actorId]?.kind === 'fund';
}

/** Premium a holder asks to sell its shares of the target (undefined: it will not sell). */
export function askedPremium(
  state: GameState,
  holderId: HolderId,
  target: Company,
): number | undefined {
  if (isFundHolder(state, holderId)) return state.config.stockMarket.activist.tenderPremium;
  const profileId = holderProfile(state, holderId);
  if (!profileId) return undefined;
  const ask = profileOf(state.config, profileId, target.sector).sellPremium;
  return target.status === 'distressed' ? ask * state.config.mna.distressedSellFactor : ask;
}

/**
 * Premium the target's board needs to back a friendly offer: that of the
 * actor controlling it, or of its management when nobody controls it.
 * Undefined when the player controls it.
 */
export function boardPremium(state: GameState, target: Company): number | undefined {
  const controller = controllingActor(state, target.id);
  if (controller) return askedPremium(state, controller, target);
  const profileId = managementProfile(state, target);
  if (!profileId) return undefined;
  const ask = profileOf(state.config, profileId, target.sector).sellPremium;
  return target.status === 'distressed' ? ask * state.config.mna.distressedSellFactor : ask;
}

/**
 * Profile of the target's board when the AI runs it (its controlling
 * actor's, else its management's); undefined when the player decides.
 */
export function boardProfile(state: GameState, target: Company): AiProfileId | undefined {
  const controller = controllingActor(state, target.id);
  if (controller) return holderProfile(state, controller);
  return managementProfile(state, target);
}

/** A listed company no holder group controls: a hostile offer can take it over. */
export const contestable = (state: GameState, target: Company): boolean =>
  target.listed &&
  isOperating(target) &&
  !blockSeller(state, target) &&
  controllingActor(state, target.id) === undefined;

/** Offers still open (on one target if given), oldest first. */
export const openOffers = (state: GameState, targetId?: Id): TenderOffer[] =>
  state.stock.tenderOffers.filter(
    (o) => o.status === 'open' && (targetId === undefined || o.targetId === targetId),
  );

/** Lowest price of a competing offer, or of a raise, on a target under offer (0: no offer open). */
export function minCompetingPrice(state: GameState, targetId: Id): Money {
  const best = Math.max(0, ...openOffers(state, targetId).map((o) => o.pricePerShare));
  return best * (1 + state.config.mna.offers.minOverbid);
}

/** A bidder may withdraw its open offer once outbid, or after a poison pill. */
export function canWithdraw(state: GameState, offer: TenderOffer): boolean {
  const others = openOffers(state, offer.targetId);
  return others.some(
    (o) => o.defenses.pill || (o.id !== offer.id && o.pricePerShare >= offer.pricePerShare),
  );
}

/** The holder with more than the control threshold of the target on its own (its block). */
export function blockSeller(state: GameState, target: Company): HolderId | undefined {
  const register = state.stock.registry[target.id] ?? {};
  const threshold = state.config.mna.controlThreshold * target.sharesOutstanding;
  return Object.keys(register)
    .sort()
    .find((h) => h !== 'public' && (register[h] ?? 0) > threshold);
}

/** The holder a company buys for: the actor at the top of its group, else itself. */
export const groupHead = (state: GameState, companyId: Id): HolderId =>
  controllingActor(state, companyId) ?? companyId;

/** Shares of the target the buyer's group holds. */
export const heldByGroup = (state: GameState, buyerId: Id, targetId: Id): number =>
  groupHolding(state, groupHead(state, buyerId), targetId);

/**
 * Whether a company may bid for a target: operating, outside the buyer's
 * group, not the activist fund, and not controlled by the player when the
 * buyer is not the player's (the player's group holds control: no offer can
 * succeed without the player).
 */
export function canTarget(state: GameState, buyer: Company, target: Company): boolean {
  if (!isOperating(target) || target.id === buyer.id) return false;
  if (sameGroup(state, buyer.id, target.id)) return false;
  const player = state.meta.playerActorId;
  const controller = controllingActor(state, target.id);
  // The activist fund is not for sale.
  if (controller !== undefined && state.actors[controller]?.kind === 'fund') return false;
  return controller !== player || controllingActor(state, buyer.id) === player;
}

/** A listing still for sale this quarter. */
export const openListing = (state: GameState, id: Id): TargetListing | undefined =>
  state.mna.listings.find((l) => l.id === id && l.expiresAt > state.meta.turn);

/** Results of a due diligence the buyer can use this quarter. */
export function usableDiligence(
  state: GameState,
  buyerId: Id,
  targetId: Id,
  turn = state.meta.turn,
): DueDiligence | undefined {
  return state.mna.diligence.find(
    (d) =>
      d.buyerId === buyerId && d.targetId === targetId && d.orderedAt < turn && turn < d.expiresAt,
  );
}

/** A due diligence of the buyer on the target, ordered and not expired (results pending or usable). */
export const pendingOrUsableDiligence = (state: GameState, buyerId: Id, targetId: Id) =>
  state.mna.diligence.find(
    (d) => d.buyerId === buyerId && d.targetId === targetId && state.meta.turn < d.expiresAt,
  );

/**
 * Cost of a due diligence: a share of the target's value, with a floor at
 * the price level of the start of the quarter (as quoted to the decisions).
 */
export function dueDiligenceCost(
  state: GameState,
  targetId: Id,
  priceLevel = state.macro.priceLevel,
): Money {
  const D = state.config.mna.dueDiligence;
  const floor = D.minCost * priceLevel;
  const listing = openListing(state, targetId);
  if (listing) return Math.max(floor, D.costShareOfValue * listing.askingPrice);
  const target = state.companies[targetId];
  if (!target) return floor;
  return Math.max(
    floor,
    D.costShareOfValue * referencePrice(state, target) * target.sharesOutstanding,
  );
}

/** Price of a listing for a buyer: asking price, less the liability its due diligence revealed. */
export function listingPrice(state: GameState, buyerId: Id, listing: TargetListing): Money {
  const dd = usableDiligence(state, buyerId, listing.id);
  return Math.max(0, listing.askingPrice - (dd?.hiddenLiability ?? 0));
}

/**
 * Annual EBITDA of a target as the buyer knows it: its due diligence, else
 * the published accounts (listed) or the public estimate (listing).
 */
export function knownEbitda(state: GameState, buyerId: Id, targetId: Id): Money {
  const dd = usableDiligence(state, buyerId, targetId);
  if (dd) return dd.figures.ebitda;
  const listing = openListing(state, targetId);
  if (listing) return listing.estimate.ebitda;
  const target = state.companies[targetId];
  if (!target?.listed) return 0;
  const lag = state.config.stockMarket.publicationLagQuarters;
  const published = target.books.history.filter((s) => s.quarter <= state.meta.turn - 1 - lag);
  const last = published.slice(-4);
  return last.length > 0 ? (last.reduce((s, x) => s + x.pnl.ebitda, 0) * 4) / last.length : 0;
}

/** Acquisition loan the bank grants for this target (none in breach of covenant). */
export function acquisitionDebtCapacity(state: GameState, buyer: Company, targetId: Id): Money {
  if (buyer.credit.covenantBreached) return 0;
  return (
    state.config.mna.financing.maxDebtToEbitda * Math.max(0, knownEbitda(state, buyer.id, targetId))
  );
}

/** What a due diligence establishes on an existing company (trailing figures, no lag). */
export function diligenceOnCompany(target: Company): Pick<DueDiligence, 'figures' | 'netDebt'> {
  const annual = trailingAnnual(target);
  const last = target.books.history.slice(-4);
  const revenue =
    last.length > 0 ? (last.reduce((s, x) => s + x.pnl.revenue, 0) * 4) / last.length : 0;
  const b = target.books.current.balance;
  return { figures: { revenue, ebitda: annual.ebitda }, netDebt: b.debt - b.cash };
}
