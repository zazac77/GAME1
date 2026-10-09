import type { AgriConfig, GameConfig, PlantSectorConfig, TechConfig } from '../config/schema';
import type { Company, ProductLine } from '../model/company';
import type { Id, SectorId } from '../model/ids';

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

/** Tech configuration when the company is in technology (offices, subscriptions, frontier). */
export const techConfigOf = (
  config: GameConfig,
  sector: SectorId | 'holding',
): TechConfig | undefined => (sector === 'tech' ? config.sectors.tech : undefined);

/** Product market a sector sells on, if the sector is configured. */
export const productMarketIdOf = (
  config: GameConfig,
  sector: SectorId | 'holding',
): Id | undefined =>
  plantConfigOf(config, sector)?.productMarketId ?? techConfigOf(config, sector)?.productMarketId;

/** Resale discount on the book value of a sector's specific assets (1: worthless). */
export const assetResaleDiscountOf = (config: GameConfig, sector: SectorId | 'holding'): number =>
  plantConfigOf(config, sector)?.assetResaleDiscount ??
  techConfigOf(config, sector)?.assetResaleDiscount ??
  1;

/** The product line a company sells on its sector's market (one per company for now). */
export function sectorProductLine(config: GameConfig, company: Company): ProductLine | undefined {
  const marketId = productMarketIdOf(config, company.sector);
  if (marketId === undefined) return undefined;
  return Object.keys(company.productLines)
    .sort()
    .map((id) => company.productLines[id] as ProductLine)
    .find((l) => l.marketId === marketId);
}
