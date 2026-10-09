import type { AgriConfig, GameConfig, PlantSectorConfig } from '../config/schema';
import type { SectorId } from '../model/ids';

/** Configuration of a plant sector (factories with lines), if the sector has one. */
export function plantConfigOf(
  config: GameConfig,
  sector: SectorId | 'holding',
): PlantSectorConfig | undefined {
  switch (sector) {
    case 'industry':
      return config.sectors.industry;
    case 'agri':
      return config.sectors.agri;
    default:
      return undefined;
  }
}

/** Configuration of a plant sector; throws for a sector without plants. */
export function plantConfig(config: GameConfig, sector: SectorId | 'holding'): PlantSectorConfig {
  const cfg = plantConfigOf(config, sector);
  if (!cfg) throw new Error(`Sector ${sector} has no plant configuration`);
  return cfg;
}

/** Agri configuration when the company is in agrifood (farms, weather, listing). */
export const agriConfigOf = (
  config: GameConfig,
  sector: SectorId | 'holding',
): AgriConfig | undefined => (sector === 'agri' ? config.sectors.agri : undefined);
