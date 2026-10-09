import type { CompanyDecisions } from '../model/decisions';
import type { TurnReport } from '../model/events';
import type { GameState } from '../model/state';
import { reportingSystem } from '../systems/reporting';
import { createTurnContext, type TurnContext } from './context';
import type { System, SystemId } from './system';

/** Placeholder for a step whose system arrives in a later lot. */
const pending = (id: SystemId): System => ({ id, run: () => {} });

/** Fixed resolution order (docs/ARCHITECTURE.md §7). */
export const PIPELINE: readonly System[] = [
  pending('ai'), // 0. AI decisions from Observation(S_t) (lot 1.3)
  pending('validation'), // 1. bound and normalize every decision
  pending('macro'), // 2. cycle, inflation, policy rate
  pending('events'), // 2. draw events, apply or expire modifiers
  pending('financePre'), // 3. loans, repayments, equity, dividends
  pending('capex'), // 4. construction, commissioning, disposals
  pending('labor'), // 5. dismissals, matching, attrition, training, wages
  pending('commodities'), // 6. contract deliveries, spot clearing, stocks
  pending('production'), // 7. capacity, output, quality (SectorModule)
  pending('products'), // 8. demand, logit shares, sales, brand
  pending('rnd'), // 9. projects, tech level, obsolescence
  pending('accounting'), // 10. statements, tax, cash, solvency
  pending('stockmarket'), // 11. fundamental, price, orders, registry
  pending('mna'), // 12. acquisitions, changes of control
  pending('conglomerate'), // 12. synergies, complexity, consolidation
  pending('victory'), // 13. end conditions
  reportingSystem, // 13. history, journal, next quarter
];

export function runPipeline(ctx: TurnContext, systems: readonly System[] = PIPELINE): void {
  for (const system of systems) system.run(ctx);
}

/**
 * Resolves one quarter. Pure at the boundary: the input state is never
 * mutated; systems work on a clone.
 */
export function resolveTurn(
  state: GameState,
  player: CompanyDecisions[],
): { state: GameState; report: TurnReport } {
  if (state.meta.status !== 'running') {
    throw new Error(`Cannot resolve a turn: the game is ${state.meta.status}`);
  }
  const draft = structuredClone(state);
  const ctx = createTurnContext(draft, structuredClone(player));
  runPipeline(ctx);
  return { state: draft, report: { turn: ctx.turn, events: ctx.events } };
}
