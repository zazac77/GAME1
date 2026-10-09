import type { TurnContext } from './context';

export type SystemId =
  | 'ai'
  | 'validation'
  | 'macro'
  | 'events'
  | 'weather'
  | 'financePre'
  | 'capex'
  | 'labor'
  | 'commodities'
  | 'production'
  | 'products'
  | 'perishability'
  | 'rnd'
  | 'accounting'
  | 'stockmarket'
  | 'mna'
  | 'conglomerate'
  | 'victory'
  | 'reporting';

/** One step of the turn pipeline. Mutates ctx.draft. */
export interface System {
  id: SystemId;
  run(ctx: TurnContext): void;
}
