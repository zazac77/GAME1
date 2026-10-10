import type { HolderId, Id } from '../model/ids';
import type { GameState } from '../model/state';
import { controllingActor } from './control';

/**
 * The group a holder declares for: an actor for itself, a company for the
 * actor at the top of its chain of control (or itself when nobody controls it).
 */
export function disclosingGroup(
  state: GameState,
  holderId: HolderId,
  cache: Record<Id, HolderId> = {},
): HolderId {
  if (state.actors[holderId] || !state.companies[holderId]) return holderId;
  return (cache[holderId] ??= controllingActor(state, holderId) ?? holderId);
}

/** Share of a company's capital each holder group holds (public float excluded). */
export function groupStakes(
  state: GameState,
  targetId: Id,
  cache: Record<Id, HolderId> = {},
): Record<HolderId, number> {
  const register = state.stock.registry[targetId] ?? {};
  const shares = state.companies[targetId]?.sharesOutstanding ?? 0;
  const out: Record<HolderId, number> = {};
  if (shares <= 0) return out;
  for (const holderId of Object.keys(register).sort()) {
    const held = register[holderId] ?? 0;
    if (holderId === 'public' || held <= 0) continue;
    const group = disclosingGroup(state, holderId, cache);
    if (group === targetId) continue;
    out[group] = (out[group] ?? 0) + held / shares;
  }
  return out;
}

/** Highest disclosure threshold a stake reaches (0: none). */
export function disclosureLevel(state: GameState, stake: number): number {
  let level = 0;
  for (const t of state.config.stockMarket.disclosureThresholds) {
    if (stake >= t - 1e-9 && t > level) level = t;
  }
  return level;
}

/** Levels every holder group reaches in every listed company (only those above 0). */
export function declaredLevels(state: GameState): Record<Id, Record<HolderId, number>> {
  const cache: Record<Id, HolderId> = {};
  const out: Record<Id, Record<HolderId, number>> = {};
  for (const targetId of Object.keys(state.stock.registry).sort()) {
    const target = state.companies[targetId];
    if (!target?.listed) continue;
    const levels: Record<HolderId, number> = {};
    for (const [group, stake] of Object.entries(groupStakes(state, targetId, cache))) {
      const level = disclosureLevel(state, stake);
      if (level > 0) levels[group] = level;
    }
    if (Object.keys(levels).length > 0) out[targetId] = levels;
  }
  return out;
}
