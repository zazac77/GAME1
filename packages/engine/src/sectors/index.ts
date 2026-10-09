import type { SectorId } from '../model/ids';
import { agriModule } from './agri';
import { industryModule } from './industry';
import type { SectorModule } from './types';

export type { SectorModule } from './types';

/** Registered sectors. Tech arrives in lot 2.2. */
const REGISTRY: Partial<Record<SectorId, SectorModule>> = {
  industry: industryModule,
  agri: agriModule,
};

/** The module of a company's sector, if that sector produces anything. */
export function sectorModule(sector: SectorId | 'holding'): SectorModule | undefined {
  return sector === 'holding' ? undefined : REGISTRY[sector];
}
