import type { PlantSectorConfig } from '../../config/schema';

// Investment costs are indexed on the price level; a factory also on the land cost of its region.

export const buildSiteCost = (cfg: PlantSectorConfig, landCostIndex: number, priceLevel: number) =>
  cfg.factory.buildCost * landCostIndex * priceLevel;

export const addLineCost = (cfg: PlantSectorConfig, priceLevel: number) =>
  cfg.line.buildCost * priceLevel;

export const modernizeLineCost = (cfg: PlantSectorConfig, priceLevel: number) =>
  cfg.line.modernizeCost * priceLevel;
