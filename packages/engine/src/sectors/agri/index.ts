import { materialsPerUnit, plannedOutput, plannedPlantInputs, producePlant } from '../plant';
import type { SectorModule } from '../types';
import { fertilizerNeed, runFarms } from './farm';

/**
 * Agrifood (processed food): a plant sector with own farms harvesting in T3
 * under the regional weather, perishable goods (perishability step) and
 * retail listing (products step).
 */
export const agriModule: SectorModule = {
  id: 'agri',
  materialsPerUnit,
  plannedOutput,
  plannedInputs(state, company, decisions) {
    const out = plannedPlantInputs(state, company, decisions);
    const fertilizer = fertilizerNeed(state, company);
    const id = state.config.sectors.agri?.farm.fertilizerId;
    if (id && fertilizer > 0) out[id] = (out[id] ?? 0) + fertilizer;
    return out;
  },
  produce(ctx, company) {
    producePlant(ctx, company);
    runFarms(ctx, company);
  },
};
