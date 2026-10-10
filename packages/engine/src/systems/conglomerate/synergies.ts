import type { TurnContext } from '../../core/context';
import { newId } from '../../core/ids';
import { feeShare, groupsByMember, supportWages, type GroupProfile } from '../../core/synergies';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { GameState } from '../../model/state';

/** Source of the modifiers of an overloaded group. */
export const OVERLOAD_SOURCE = 'conglomerate_overload';

/** The groups of the game, each once, by head id. */
export function groupProfiles(state: GameState): GroupProfile[] {
  const seen = new Set<string>();
  const out: GroupProfile[] = [];
  for (const profile of Object.values(groupsByMember(state))) {
    if (seen.has(profile.headId)) continue;
    seen.add(profile.headId);
    out.push(profile);
  }
  return out.sort((a, b) => (a.headId < b.headId ? -1 : 1));
}

/**
 * Step 10, before the accounts (lot 3.2), for each group of the start of the
 * quarter: shared support functions (the wages of the support occupations of
 * every member fall by supportSaving) and the holding fees, shared by the
 * members by revenue of the quarter.
 */
export const conglomeratePreSystem: System = {
  id: 'conglomeratePre',
  run(ctx) {
    const { draft } = ctx;
    for (const profile of groupProfiles(draft)) {
      for (const id of profile.members) {
        const company = draft.companies[id] as Company;
        const ledger = ctx.ledger(id);
        ledger.wages -= profile.supportSaving * supportWages(draft, company);
        ledger.other += feeShare(profile, id, (m) => ctx.ledger(m).revenue);
      }
    }
  },
};

/**
 * Step 12, once the groups of the next quarter are known: the members of an
 * overloaded group (managerial load above the capacity) get their efficiency
 * malus for the next quarter (operator productivity × efficiency, attrition
 * × (1 + attritionWeight × (1 − efficiency))); a holding company head shows
 * the group brand.
 */
export function applyGroupEffects(ctx: TurnContext): void {
  const { draft } = ctx;
  const M = draft.config.conglomerate.management;
  draft.modifiers = draft.modifiers.filter((m) => m.sourceId !== OVERLOAD_SOURCE);
  for (const profile of groupProfiles(draft)) {
    const head = draft.companies[profile.headId];
    if (head?.sector === 'holding') head.brand = profile.brand;
    if (profile.efficiency >= 1) continue;
    for (const id of profile.members) {
      // Modifiers age at the start of the next quarter: they act over that quarter only.
      for (const [key, value] of [
        ['labor.productivity', profile.efficiency],
        ['labor.attrition', 1 + M.attritionWeight * (1 - profile.efficiency)],
      ] as const) {
        draft.modifiers.push({
          id: newId(draft.meta, 'mod'),
          sourceId: OVERLOAD_SOURCE,
          target: { kind: 'company', id },
          key,
          op: 'mul',
          value,
          remaining: 2,
          decay: 0,
        });
      }
    }
  }
}
