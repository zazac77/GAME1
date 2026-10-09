import type { CompanyDecisions } from '../model/decisions';
import type { TurnReport } from '../model/events';
import type { GameState } from '../model/state';
import { accountingSystem } from '../systems/accounting';
import { aiSystem } from '../systems/ai';
import { capexSystem } from '../systems/capex';
import { commoditiesSystem } from '../systems/commodities';
import { eventsSystem } from '../systems/events';
import { financePreSystem } from '../systems/finance';
import { laborSystem } from '../systems/labor';
import { macroSystem } from '../systems/macro';
import { mnaPreSystem, mnaSystem } from '../systems/mna';
import { perishabilitySystem } from '../systems/perishability';
import { productionSystem } from '../systems/production';
import { productsSystem } from '../systems/products';
import { reportingSystem } from '../systems/reporting';
import { rndSystem } from '../systems/rnd';
import { stockMarketSystem } from '../systems/stockmarket';
import { filterControlled, validationSystem } from '../systems/validation';
import { weatherSystem } from '../systems/weather';
import { buildTurnReport } from '../views/report';
import { createTurnContext, type TurnContext } from './context';
import type { System, SystemId } from './system';

/** Placeholder for a step whose system arrives in a later lot. */
const pending = (id: SystemId): System => ({ id, run: () => {} });

/** Fixed resolution order (docs/ARCHITECTURE.md §7). */
export const PIPELINE: readonly System[] = [
  aiSystem, // 0. AI decisions from Observation(S_t)
  validationSystem, // 1. bound and normalize every decision
  macroSystem, // 2. cycle, inflation, policy rate
  eventsSystem, // 2. draw events, apply or expire modifiers
  weatherSystem, // 2. regional weather (crop yields)
  financePreSystem, // 3. loans, repayments, dividends, share issues, buybacks, offerings
  mnaPreSystem, // 3. due diligences, integration costs
  capexSystem, // 4. commissioning, construction, disposals
  laborSystem, // 5. dismissals, matching, attrition, training, wages
  commoditiesSystem, // 6. contract deliveries, spot clearing, stocks
  productionSystem, // 7. capacity, output, quality (SectorModule)
  productsSystem, // 8. listing, demand, logit shares, sales, brand
  perishabilitySystem, // 8. perishable stocks lose a share of their units
  rndSystem, // 9. obsolescence, projects, R&D levels
  accountingSystem, // 10. statements, tax, cash, solvency
  stockMarketSystem, // 11. fundamental, price, orders, registry, index
  mnaSystem, // 12. takeovers, changes of control, holdings, listings
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
  // The player only decides for the companies it controls.
  const { kept, issues } = filterControlled(draft, draft.meta.playerActorId, player);
  const ctx = createTurnContext(draft, structuredClone(kept));
  runPipeline(ctx);
  return { state: draft, report: buildTurnReport(state, draft, ctx, issues) };
}
