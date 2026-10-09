import type { AiProfileConfig, GameConfig } from '../../config/schema';
import type { Rng } from '../../core/rng';
import type { AiMemory, Observation } from '../../model/ai';
import type { Company, ProductLine } from '../../model/company';
import type { CompanyDecisions } from '../../model/decisions';
import type { Id, Money } from '../../model/ids';
import type { ProductMarket } from '../../model/markets';

/** Something worth a journal entry (a riposte is public news). */
export interface PlanSignal {
  kind: 'ai_price_war';
  rivalId: Id;
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
}
