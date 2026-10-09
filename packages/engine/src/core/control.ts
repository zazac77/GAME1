import type { Company } from '../model/company';
import type { AiProfileId, HolderId, Id } from '../model/ids';
import type { GameState } from '../model/state';

/**
 * Companies a holder (an actor or a company) controls: those of which it
 * holds, with the companies it already controls, more than the control
 * threshold (docs/ARCHITECTURE.md §5: control is read from the registry,
 * directly or through a chain of control). Sorted ids.
 */
export function controlledBy(state: GameState, holderId: HolderId): Id[] {
  const threshold = state.config.mna.controlThreshold;
  const group = new Set<Id>();
  const ids = Object.keys(state.stock.registry).sort();
  for (let changed = true; changed;) {
    changed = false;
    for (const id of ids) {
      if (group.has(id) || id === holderId) continue;
      const register = state.stock.registry[id] ?? {};
      const shares = state.companies[id]?.sharesOutstanding ?? 0;
      let held = register[holderId] ?? 0;
      for (const member of group) held += register[member] ?? 0;
      if (shares > 0 && held > threshold * shares) {
        group.add(id);
        changed = true;
      }
    }
  }
  return [...group].sort();
}

/** The actor at the top of the company's chain of control (undefined: nobody controls it). */
export function controllingActor(state: GameState, companyId: Id): Id | undefined {
  for (const actorId of Object.keys(state.actors).sort()) {
    if (controlledBy(state, actorId).includes(companyId)) return actorId;
  }
  return undefined;
}

/** Whether two companies belong to the same group (the same actor controls both). */
export function sameGroup(state: GameState, a: Id, b: Id): boolean {
  const actor = controllingActor(state, a);
  return actor !== undefined && actor === controllingActor(state, b);
}

/** Shares of a company held by a holder and the companies it controls. */
export function groupHolding(state: GameState, holderId: HolderId, companyId: Id): number {
  const register = state.stock.registry[companyId] ?? {};
  const members = [holderId, ...controlledBy(state, holderId)];
  return members.reduce((s, m) => s + (m === companyId ? 0 : (register[m] ?? 0)), 0);
}

/** The holder with more than the control threshold of the company on its own, if any. */
export function directController(state: GameState, companyId: Id): HolderId | undefined {
  const register = state.stock.registry[companyId] ?? {};
  const shares = state.companies[companyId]?.sharesOutstanding ?? 0;
  const threshold = state.config.mna.controlThreshold;
  return Object.keys(register)
    .sort()
    .find((h) => h !== 'public' && (register[h] ?? 0) > threshold * shares);
}

/**
 * Profile of the management running a company when nobody submits decisions
 * for it: its founder's (the AI actor whose root company it is, still in
 * place after a takeover), the profile of a bought listing, else the
 * delegated management of config.mna. Undefined for the player's own root
 * company (the player decides, unless on autopilot).
 */
export function managementProfile(state: GameState, company: Company): AiProfileId | undefined {
  const founder = Object.values(state.actors).find((a) => a.rootCompanyId === company.id);
  if (founder?.profileId) return founder.profileId;
  if (founder && founder.id === state.meta.playerActorId) return undefined;
  return company.managementProfileId ?? state.config.mna.delegatedProfileId;
}
