import { operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import { ageModifiers } from '../../core/modifiers';
import type { System } from '../../core/system';
import type { EventDefinition } from '../../config/schema';
import type { Modifier } from '../../model/events';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';

/** Ids an event may target, in a stable order. */
function candidates(state: GameState, def: EventDefinition): Id[] {
  if (def.targetIds) return [...def.targetIds];
  switch (def.target) {
    case 'global':
      return [];
    case 'region':
      return Object.keys(state.regions).sort();
    case 'laborPool':
      return Object.keys(state.labor).sort();
    case 'commodity':
      return Object.keys(state.commodities).sort();
    case 'market':
      return Object.keys(state.productMarkets).sort();
    case 'company':
      return operatingCompanies(state).map((c) => c.id);
  }
}

function eligible(state: GameState, def: EventDefinition, turn: number): boolean {
  const { seasons, regimes, sectors } = def.conditions;
  if (seasons && !seasons.includes(turn % 4)) return false;
  if (regimes && !regimes.includes(state.macro.regime)) return false;
  if (sectors) {
    const active = new Set(operatingCompanies(state).map((c) => c.sector));
    if (!sectors.some((s) => active.has(s))) return false;
  }
  // An event does not stack on itself while its effects last.
  return !state.modifiers.some((m) => m.sourceId === def.id);
}

/**
 * Step 2: ages the active modifiers, then draws the events of the quarter
 * from config.events. Each event becomes one modifier per effect; systems
 * read them through applyModifiers.
 */
export const eventsSystem: System = {
  id: 'events',
  run(ctx) {
    const { draft, config, rng, turn } = ctx;
    draft.modifiers = ageModifiers(draft.modifiers);
    for (const def of config.events.definitions) {
      if (!eligible(draft, def, turn) || !rng.chance(def.probability)) continue;
      let target: Modifier['target'] = { kind: 'global' };
      if (def.target !== 'global') {
        const ids = candidates(draft, def);
        if (ids.length === 0) continue;
        target = { kind: def.target, id: rng.pick(ids) };
      }
      for (const effect of def.effects) {
        draft.modifiers.push({
          id: newId(draft.meta, 'mod'),
          sourceId: def.id,
          target: { ...target },
          key: effect.key,
          op: effect.op,
          value: effect.value,
          remaining: def.durationQuarters,
          decay: def.decay,
        });
      }
      const data: Record<string, string | number> = { eventId: def.id, targetKind: target.kind };
      if (target.id !== undefined) data.targetId = target.id;
      data.durationQuarters = def.durationQuarters;
      ctx.log({ kind: 'event', severity: 'warning', data });
    }
  },
};
