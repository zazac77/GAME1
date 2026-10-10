import type { AiProfileConfig, GameConfig } from '../../config/schema';
import type { Rng } from '../../core/rng';
import type { AiMemory, Observation } from '../../model/ai';
import type { Company, ProductLine, RndType } from '../../model/company';
import type { CompanyDecisions } from '../../model/decisions';
import type { Id, Money } from '../../model/ids';
import type { ProductMarket } from '../../model/markets';

/** Something worth a journal entry: every competitive move of the AI is public news. */
export interface PlanSignal {
  kind:
    | 'ai_price_war'
    | 'ai_price_truce'
    | 'ai_wage_outbid'
    | 'ai_counter_launch'
    | 'ai_targets_rival'
    | 'ai_hostile_offer'
    | 'ai_counter_bid'
    | 'ai_white_knight'
    | 'ai_preempt'
    | 'ai_defense_buyback';
  rivalId: Id;
  data?: Record<string, string | number | boolean>;
}

/** This quarter's competitive stance, set by the rival watch and the price war. */
export interface Tactics {
  /** Quality aimed at (the profile's, raised by a counter-launch). */
  qualityTarget: number;
  /** Shares added to the marketing and to the product R&D. */
  marketingBoost: number;
  rndBoost: number;
  /** Watched rivals in difficulty selling in the own market. */
  prey: Id[];
}

/** Working state of one planning, filled module after module. */
export interface Plan {
  obs: Observation;
  config: GameConfig;
  profile: AiProfileConfig;
  /** Copy of the memory, updated in place by the modules. */
  memory: AiMemory;
  rng: Rng;
  company: Company;
  line: ProductLine;
  market: ProductMarket;
  decisions: CompanyDecisions;
  signals: PlanSignal[];
  tactics: Tactics;
  /** Expected demand this quarter and next quarter (units). */
  forecast: number;
  nextForecast: number;
  /** Units to produce this quarter. */
  output: number;
  /** Operators-driven output the staffing is sized for. */
  staffedOutput: number;
  /** Commodity units per finished unit at the current quality. */
  perUnit: Record<Id, number>;
  /** Variable cost per unit (materials at expected prices, logistics). */
  variableCost: Money;
  /** Expected cash costs of a quarter (wages, materials, maintenance, interest). */
  quarterlyCashCosts: Money;
  price: Money;
  expectedSales: number;
  /** Retail listing fees of the quarter (agri). */
  listingFees: Money;
  /** Cash committed by the plan this quarter, by kind (for the finance module). */
  spend: { discretionary: Money; capex: Money; other: Money };
  /** Tech: developers put on each kind of R&D project, and the headcount the plan needs. */
  tech?: { rndDevelopers: Record<RndType, number>; headcount: number };
}
