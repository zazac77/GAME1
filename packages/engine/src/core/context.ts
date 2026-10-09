import type { GameConfig } from '../config/schema';
import type { CompanyDecisions } from '../model/decisions';
import type { GameEvent } from '../model/events';
import type { Id, Quarter } from '../model/ids';
import type { GameState } from '../model/state';
import { createRng, type Rng } from './rng';

/** Everything a system receives. Systems mutate `draft` in place. */
export interface TurnContext {
  /** Clone of the state being resolved. */
  readonly draft: GameState;
  readonly config: GameConfig;
  /** Seeded generator bound to draft.meta.rng: the only source of randomness. */
  readonly rng: Rng;
  /** Quarter being resolved. */
  readonly turn: Quarter;
  /** Decisions of every company (player and AI), by company id. */
  readonly decisions: Record<Id, CompanyDecisions>;
  /** Journal entries emitted during this turn. */
  readonly events: GameEvent[];
  log(event: Omit<GameEvent, 'turn'>): void;
}

export function createTurnContext(draft: GameState, decisions: CompanyDecisions[]): TurnContext {
  const turn = draft.meta.turn;
  const events: GameEvent[] = [];
  const byCompany: Record<Id, CompanyDecisions> = {};
  for (const d of decisions) byCompany[d.companyId] = d;
  return {
    draft,
    config: draft.config,
    rng: createRng(draft.meta.rng),
    turn,
    decisions: byCompany,
    events,
    log(event) {
      const entry: GameEvent = { turn, ...event };
      events.push(entry);
      draft.log.push(entry);
    },
  };
}
