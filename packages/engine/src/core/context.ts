import type { GameConfig } from '../config/schema';
import type { CompanyDecisions, ValidationIssue } from '../model/decisions';
import type { GameEvent } from '../model/events';
import type { Id, Money, Quarter } from '../model/ids';
import type { GameState } from '../model/state';
import { createRng, type Rng } from './rng';

/**
 * Flows of one company during the quarter being resolved. Systems add to it;
 * accounting turns it into statements. Not part of GameState.
 */
export interface TurnLedger {
  revenue: Money;
  /** Book cost of the finished goods sold. */
  cogs: Money;
  wages: Money;
  marketing: Money;
  rnd: Money;
  storage: Money;
  /** Hiring, severance, training, maintenance, logistics, take-or-pay penalties. */
  other: Money;
  /** Materials paid for (cash out), capitalized into inventory. */
  purchases: Money;
  /** Proceeds of asset sales (investing). */
  disposals: Money;
  /** Capital expenditure (investing). */
  capex: Money;
  borrowed: Money;
  /** Voluntary repayments of term loans. */
  repaid: Money;
  unitsProduced: number;
  unitsSold: number;
}

export const emptyLedger = (): TurnLedger => ({
  revenue: 0,
  cogs: 0,
  wages: 0,
  marketing: 0,
  rnd: 0,
  storage: 0,
  other: 0,
  purchases: 0,
  disposals: 0,
  capex: 0,
  borrowed: 0,
  repaid: 0,
  unitsProduced: 0,
  unitsSold: 0,
});

/** Everything a system receives. Systems mutate `draft` in place. */
export interface TurnContext {
  /** Clone of the state being resolved. */
  readonly draft: GameState;
  readonly config: GameConfig;
  /** Seeded generator bound to draft.meta.rng: the only source of randomness. */
  readonly rng: Rng;
  /** Quarter being resolved. */
  readonly turn: Quarter;
  /**
   * Decisions of every company (player and AI), by company id. After the
   * validation step, every active company has normalized decisions.
   */
  readonly decisions: Record<Id, CompanyDecisions>;
  /** Changes made by validation to the submitted decisions. */
  readonly issues: ValidationIssue[];
  /** Journal entries emitted during this turn. */
  readonly events: GameEvent[];
  log(event: Omit<GameEvent, 'turn'>): void;
  /** Flows of a company for this quarter (created on first use). */
  ledger(companyId: Id): TurnLedger;
}

export function createTurnContext(draft: GameState, decisions: CompanyDecisions[]): TurnContext {
  const turn = draft.meta.turn;
  const events: GameEvent[] = [];
  const byCompany: Record<Id, CompanyDecisions> = {};
  for (const d of decisions) byCompany[d.companyId] = d;
  const ledgers: Record<Id, TurnLedger> = {};
  return {
    draft,
    config: draft.config,
    rng: createRng(draft.meta.rng),
    turn,
    decisions: byCompany,
    issues: [],
    events,
    log(event) {
      const entry: GameEvent = { turn, ...event };
      events.push(entry);
      draft.log.push(entry);
    },
    ledger(companyId) {
      return (ledgers[companyId] ??= emptyLedger());
    },
  };
}
