import { emptyDecisions } from '../core/decisions';
import { productMarketIdOf, techConfigOf } from '../sectors/config';
import type { Rng } from '../core/rng';
import type { AiMemory, Observation } from '../model/ai';
import type { ProductLine } from '../model/company';
import type { CompanyDecisions } from '../model/decisions';
import { capex } from './modules/capex';
import { marketingAndFinance } from './modules/finance';
import { forecast } from './modules/forecast';
import { hiring } from './modules/hiring';
import { listing } from './modules/listing';
import type { Plan, PlanSignal } from './modules/plan';
import { pricing } from './modules/pricing';
import { production } from './modules/production';
import { purchasing } from './modules/purchasing';
import { watchRivals } from './modules/rivals';
import { techCapex, techForecast, techPricing, techStaffing } from './modules/tech';
import { profileOf } from './profiles';

export type { PlanSignal } from './modules/plan';

/**
 * Plans the decisions of one company from its Observation only (never the
 * GameState) and the actor's memory: rival watch (grudges, rivals in
 * difficulty, counter-launches) → forecast → production → HR (wage
 * outbidding) → listing → price (price war) → purchasing → capex →
 * marketing, R&D and finance (tech: rival watch → subscriber forecast →
 * staffing and R&D developers → price → purchasing → offices → marketing and
 * finance). Heuristics with a little randomness (ripostes, counter-launches),
 * no optimizer. Every rival, player or AI, is watched the same way. The decisions then go
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
  const marketId = productMarketIdOf(obs.config, company.sector) ?? '';
  const line = Object.keys(company.productLines)
    .sort()
    .map((id) => company.productLines[id] as ProductLine)
    .find((l) => l.marketId === marketId);
  const market = obs.productMarkets[marketId];
  if (!line || !market) return { decisions, memory: nextMemory, signals: [] };

  const profile = profileOf(obs.config, obs.profileId, company.sector);
  const plan: Plan = {
    obs,
    config: obs.config,
    profile,
    memory: nextMemory,
    rng,
    company,
    line,
    market,
    decisions,
    signals: [],
    tactics: { qualityTarget: profile.qualityTarget, marketingBoost: 0, rndBoost: 0, prey: [] },
    forecast: 0,
    nextForecast: 0,
    output: 0,
    staffedOutput: 0,
    perUnit: {},
    variableCost: 0,
    quarterlyCashCosts: 0,
    price: line.price,
    expectedSales: 0,
    listingFees: 0,
    spend: { discretionary: 0, capex: 0, other: 0 },
  };
  watchRivals(plan);
  if (techConfigOf(obs.config, company.sector)) {
    // SaaS: subscribers instead of stock, developers instead of lines.
    techForecast(plan);
    techStaffing(plan);
    techPricing(plan);
    purchasing(plan);
    techCapex(plan);
    marketingAndFinance(plan);
    return { decisions, memory: nextMemory, signals: plan.signals };
  }
  forecast(plan);
  production(plan);
  hiring(plan);
  listing(plan);
  pricing(plan);
  purchasing(plan);
  capex(plan);
  marketingAndFinance(plan);
  return { decisions, memory: nextMemory, signals: plan.signals };
}
