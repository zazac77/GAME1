import type { SectorId } from '../config/schema';
import type { Company } from '../model/company';
import type { Id, Money } from '../model/ids';
import type { GameState } from '../model/state';
import { isOperating } from './companies';
import { controlledBy } from './control';
import { groupHeadOf } from './group';
import { sum } from './math';

/**
 * What belonging to a group brings and costs (lot 3.2), read from the
 * registry: a group is the head of an actor and the operating companies it
 * controls.
 */
export interface GroupProfile {
  headId: Id;
  actorId: Id;
  /** Operating companies of the group (holding companies excluded), by id. */
  members: Id[];
  /** Companies under the head (holding companies excluded). */
  subsidiaries: number;
  /** Sectors of the members, sorted. */
  sectors: SectorId[];
  /** Group brand: the members' brands weighted by their last quarter revenue. */
  brand: number;
  /** Managerial load and capacity, and the members' efficiency (1: no overload). */
  load: number;
  capacity: number;
  efficiency: number;
  /** Holding fees of a quarter, shared by the members by revenue. */
  holdingFee: Money;
  /** Share of the support functions' wages saved by every member. */
  supportSaving: number;
  /** Conglomerate discount on the sum of the parts of a holding company head (else 0). */
  discount: number;
}

const operatingMembers = (state: GameState, headId: Id): Company[] =>
  [headId, ...controlledBy(state, headId).filter((id) => id !== headId)]
    .map((id) => state.companies[id])
    .filter((c): c is Company => c !== undefined && isOperating(c) && c.sector !== 'holding')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const sectorsOf = (members: readonly Company[]): SectorId[] =>
  [...new Set(members.map((c) => c.sector as SectorId))].sort();

/** Conglomerate discount: perExtraSector × (sectors − 1), at most max. */
export function conglomerateDiscount(state: GameState, sectors: number): number {
  const D = state.config.conglomerate.discount;
  return Math.min(D.max, D.perExtraSector * Math.max(0, sectors - 1));
}

/** Conglomerate discount on the stakes of a holding company (0 for any other company). */
export function holdingDiscount(state: GameState, company: Company): number {
  if (company.sector !== 'holding') return 0;
  return conglomerateDiscount(state, sectorsOf(operatingMembers(state, company.id)).length);
}

/** The group headed by `headId` for the actor (undefined: no subsidiary). */
export function groupProfile(state: GameState, actorId: Id, headId: Id): GroupProfile | undefined {
  const head = state.companies[headId];
  if (!head || !isOperating(head)) return undefined;
  const C = state.config.conglomerate;
  const members = operatingMembers(state, headId);
  const subsidiaries = members.filter((c) => c.id !== headId).length;
  if (subsidiaries < 1) return undefined;
  const sectors = sectorsOf(members);
  const revenues = members.map((c) => Math.max(0, c.books.current.pnl.revenue));
  const total = sum(revenues);
  const brand =
    total > 0
      ? sum(members.map((c, i) => c.brand * (revenues[i] ?? 0))) / total
      : sum(members.map((c) => c.brand)) / members.length;
  const M = C.management;
  const isHolding = head.sector === 'holding';
  const load = members.length * M.companyLoad + Math.max(0, sectors.length - 1) * M.sectorLoad;
  const capacity = M.capacity + (isHolding ? M.holdingBonus : 0);
  const efficiency = Math.max(M.minEfficiency, 1 - M.lossPerUnit * Math.max(0, load - capacity));
  return {
    headId,
    actorId,
    members: members.map((c) => c.id),
    subsidiaries,
    sectors,
    brand,
    load,
    capacity,
    efficiency,
    holdingFee:
      C.holdingFee.base *
      state.macro.priceLevel *
      subsidiaries ** C.holdingFee.subsidiaryExponent *
      Math.max(1, sectors.length),
    supportSaving: C.synergies.supportMaxSaving * (1 - 1 / members.length),
    discount: isHolding ? conglomerateDiscount(state, sectors.length) : 0,
  };
}

/** Every group of the game, by member id (a company belongs to at most one group). */
export function groupsByMember(state: GameState): Record<Id, GroupProfile> {
  const out: Record<Id, GroupProfile> = {};
  // A group needs a company holding control of another one on its own (usually none).
  const threshold = state.config.mna.controlThreshold;
  const anyStake = Object.entries(state.stock.registry).some(([targetId, register]) => {
    const shares = state.companies[targetId]?.sharesOutstanding ?? 0;
    return Object.keys(register).some(
      (h) =>
        h !== targetId &&
        state.companies[h] !== undefined &&
        (register[h] ?? 0) > threshold * shares,
    );
  });
  if (!anyStake) return out;
  for (const actorId of Object.keys(state.actors).sort()) {
    const headId = groupHeadOf(state, actorId);
    const profile = headId ? groupProfile(state, actorId, headId) : undefined;
    if (!profile) continue;
    for (const id of profile.members) out[id] ??= profile;
  }
  return out;
}

/**
 * Brand customers see: a share of it is the group brand (sharedBrandWeight),
 * so a member's scandal spreads to the others.
 */
export function sharedBrand(
  state: GameState,
  company: Company,
  groups: Readonly<Record<Id, GroupProfile>>,
): number {
  const profile = groups[company.id];
  if (!profile || profile.members.length < 2) return company.brand;
  const w = state.config.conglomerate.synergies.sharedBrandWeight;
  return (1 - w) * company.brand + w * profile.brand;
}

/** Wages of a company's support functions (config.conglomerate.synergies.supportOccupationIds). */
export function supportWages(state: GameState, company: Company): Money {
  const ids = new Set(state.config.conglomerate.synergies.supportOccupationIds);
  return sum(
    Object.values(company.workforce)
      .filter((s) => ids.has(s.occupationId))
      .map((s) => s.headcount * s.wage),
  );
}

/** A member's share of the holding fees: by revenue (equal shares without any). */
export function feeShare(
  profile: GroupProfile,
  companyId: Id,
  revenueOf: (id: Id) => number,
): Money {
  const revenues = profile.members.map((id) => Math.max(0, revenueOf(id)));
  const total = sum(revenues);
  const i = profile.members.indexOf(companyId);
  if (i < 0) return 0;
  const weight = total > 0 ? (revenues[i] ?? 0) / total : 1 / profile.members.length;
  return profile.holdingFee * weight;
}

/**
 * Contracted volume of a commodity the other members of a company's group
 * count towards its volume discount (contracts in force at `turn`).
 */
export function pooledContractVolume(
  state: GameState,
  company: Company,
  commodityId: Id,
  groups: Readonly<Record<Id, GroupProfile>>,
  turn: number,
): number {
  const profile = groups[company.id];
  if (!profile) return 0;
  let volume = 0;
  for (const id of profile.members) {
    if (id === company.id) continue;
    for (const k of state.companies[id]?.contracts ?? []) {
      if (k.commodityId === commodityId && k.startsAt <= turn && turn < k.endsAt) {
        volume += k.qtyPerQuarter;
      }
    }
  }
  return volume * state.config.conglomerate.synergies.pooledPurchasingShare;
}
