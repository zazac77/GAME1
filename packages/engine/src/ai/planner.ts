import { emptyDecisions } from '../core/decisions';
import type { Rng } from '../core/rng';
import type { AiMemory, Observation } from '../model/ai';
import type { ProductLine } from '../model/company';
import type { CompanyDecisions } from '../model/decisions';
import { capex } from './modules/capex';
import { marketingAndFinance } from './modules/finance';
import { forecast } from './modules/forecast';
import { hiring } from './modules/hiring';
import type { Plan, PlanSignal } from './modules/plan';
import { pricing } from './modules/pricing';
import { production } from './modules/production';
import { purchasing } from './modules/purchasing';
import { profileOf } from './profiles';

export type { PlanSignal } from './modules/plan';

/**
 * Plans the decisions of one company from its Observation only (never the
 * GameState) and the actor's memory: forecast → production → HR → price →
 * purchasing → capex → marketing, R&D and finance. Heuristics with a little
 * randomness (price war ripostes), no optimizer. The decisions then go
 * through the same validation as the player's. Pure: returns a new memory.
 */
export function planDecisions(
  obs: Observation,
  memory: AiMemory,
  rng: Rng,
): { decisions: CompanyDecisions; memory: AiMemory; signals: PlanSignal[] } {
  const decisions = emptyDecisions(obs.companyId);
  const nextMemory = structuredClone(memory);
  const company = obs.self.company;
  const marketId = obs.config.sectors.industry.productMarketId;
  const line = Object.keys(company.productLines)
    .sort()
    .map((id) => company.productLines[id] as ProductLine)
    .find((l) => l.marketId === marketId);
  const market = obs.productMarkets[marketId];
  if (!line || !market) return { decisions, memory: nextMemory, signals: [] };

  const plan: Plan = {
    obs,
    config: obs.config,
    profile: profileOf(obs.config, obs.profileId),
    memory: nextMemory,
    rng,
    company,
    line,
    market,
    decisions,
    signals: [],
    forecast: 0,
    nextForecast: 0,
    output: 0,
    staffedOutput: 0,
    perUnit: {},
    variableCost: 0,
    quarterlyCashCosts: 0,
    price: line.price,
    expectedSales: 0,
    spend: { discretionary: 0, capex: 0, other: 0 },
  };
  forecast(plan);
  production(plan);
  hiring(plan);
  pricing(plan);
  purchasing(plan);
  capex(plan);
  marketingAndFinance(plan);
  return { decisions, memory: nextMemory, signals: plan.signals };
}
