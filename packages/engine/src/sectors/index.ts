import type { SectorId } from '../model/ids';
import { agriModule } from './agri';
import { industryModule } from './industry';
import { techModule } from './tech';
import type { SectorModule } from './types';

export type { SectorModule } from './types';

/** Registered sectors. */
const REGISTRY: Partial<Record<SectorId, SectorModule>> = {
  industry: industryModule,
  agri: agriModule,
  tech: techModule,
};

/** The module of a company's sector, if that sector produces anything. */
export function sectorModule(sector: SectorId | 'holding'): SectorModule | undefined {
  return sector === 'holding' ? undefined : REGISTRY[sector];
}
