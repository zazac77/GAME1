import { groupHeadOf } from '../core/group';
import { sum } from '../core/math';
import { groupProfile, supportWages } from '../core/synergies';
import type { Company } from '../model/company';
import type { Id } from '../model/ids';
import type { GameState } from '../model/state';
import type { GroupSynergiesView } from '../model/views';

/** Synergies and complexity costs of an actor's group (undefined: no subsidiary). */
export function synergiesView(state: GameState, actorId: Id): GroupSynergiesView | undefined {
  const headId = groupHeadOf(state, actorId);
  const profile = headId ? groupProfile(state, actorId, headId) : undefined;
  if (!profile) return undefined;
  const members = profile.members.map((id) => state.companies[id] as Company);
  const turn = state.meta.turn;
  const pooled: Record<Id, number> = {};
  for (const c of members) {
    for (const k of c.contracts) {
      if (k.startsAt <= turn && turn < k.endsAt) {
        pooled[k.commodityId] = (pooled[k.commodityId] ?? 0) + k.qtyPerQuarter;
      }
    }
  }
  return {
    headId: profile.headId,
    members: [...profile.members],
    subsidiaries: profile.subsidiaries,
    sectors: [...profile.sectors],
    brand: profile.brand,
    sharedBrandWeight:
      profile.members.length > 1 ? state.config.conglomerate.synergies.sharedBrandWeight : 0,
    load: profile.load,
    capacity: profile.capacity,
    efficiency: profile.efficiency,
    holdingFee: profile.holdingFee,
    supportSaving: profile.supportSaving,
    supportSavingAmount: profile.supportSaving * sum(members.map((c) => supportWages(state, c))),
    discount: profile.discount,
    pooledContracts: Object.fromEntries(
      Object.entries(pooled).sort(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
}
