import type { SectorId } from '../model/ids';
import { industryModule } from './industry';
import type { SectorModule } from './types';

export type { SectorModule } from './types';

/** Registered sectors. Agri and tech arrive in phase 2. */
const REGISTRY: Partial<Record<SectorId, SectorModule>> = {
  industry: industryModule,
};

/** The module of a company's sector, if that sector produces anything. */
export function sectorModule(sector: SectorId | 'holding'): SectorModule | undefined {
  return sector === 'holding' ? undefined : REGISTRY[sector];
}
