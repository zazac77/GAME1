import { materialsPerUnit, plannedOutput, plannedPlantInputs, producePlant } from '../plant';
import type { SectorModule } from '../types';

export * from '../plant';

/** Manufacturing (household appliances): a plant sector without anything more. */
export const industryModule: SectorModule = {
  id: 'industry',
  materialsPerUnit,
  plannedOutput,
  plannedInputs: plannedPlantInputs,
  produce: producePlant,
};
