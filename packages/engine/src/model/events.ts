import type { Id, Quarter } from './ids';

export type ModifierTargetKind =
  'global' | 'region' | 'laborPool' | 'commodity' | 'market' | 'company';

/** Temporary effect (events, synergies), read by the systems through `key`. */
export interface Modifier {
  id: Id;
  /** Event definition (or synergy) that created it. */
  sourceId: Id;
  target: { kind: ModifierTargetKind; id?: Id };
  key: string;
  op: 'add' | 'mul';
  value: number;
  /** Quarters left, including the current one. */
  remaining: number;
  /** Share of the effect lost each quarter. */
  decay: number;
}

export interface ScheduledEffect {
  id: Id;
  at: Quarter;
  eventId: Id;
  target: { kind: ModifierTargetKind; id?: Id };
}

export type GameEventSeverity = 'info' | 'warning' | 'critical';

/** Journal entry. Rendered into French by the UI from `kind` and `data`. */
export interface GameEvent {
  turn: Quarter;
  kind: string;
  severity: GameEventSeverity;
  companyId?: Id;
  data?: Record<string, number | string | boolean>;
}

export interface TurnReport {
  /** The quarter that was resolved. */
  turn: Quarter;
  events: GameEvent[];
}
