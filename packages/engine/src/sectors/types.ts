import type { TurnContext } from '../core/context';
import type { Company, ProductLine } from '../model/company';
import type { CompanyDecisions } from '../model/decisions';
import type { Id, SectorId } from '../model/ids';
import type { GameState } from '../model/state';

/**
 * What a sector implements; the generic systems (labor, commodities,
 * products, accounting) delegate to it what is specific to the sector.
 */
export interface SectorModule {
  id: SectorId;
  /** Commodity units consumed per unit of the product line (quality included). */
  materialsPerUnit(state: GameState, company: Company, line: ProductLine): Record<Id, number>;
  /** Units the company expects to make this quarter (before material limits). */
  plannedOutput(
    state: GameState,
    company: Company,
    decisions: CompanyDecisions | undefined,
  ): number;
  /**
   * Step 7: quality, output, consumption of materials (and of non-storable
   * inputs bought at consumption), finished goods, line aging.
   */
  produce(ctx: TurnContext, company: Company): void;
}
