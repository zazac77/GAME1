import type { PlantSectorConfig } from '../../config/schema';
import type { Company, ProductLine, RndType } from '../../model/company';

/** Current R&D level of a type: process for the company, product for the line. */
export const rndLevel = (company: Company, type: RndType, line: ProductLine | undefined): number =>
  type === 'process' ? company.processLevel : (line?.techLevel ?? 0);

/** Budget a new project needs, at the given price level. */
export const rndProjectCost = (
  cfg: PlantSectorConfig,
  type: RndType,
  level: number,
  priceLevel: number,
): number => cfg.rnd[type].baseCost * (1 + cfg.rnd.costGrowthPerLevel * level) * priceLevel;

/** Most a project can absorb in one quarter. */
export const rndMaxSpend = (cfg: PlantSectorConfig, cost: number, progress: number): number =>
  Math.max(0, Math.min(cfg.rnd.maxSpendShare * cost, (1 - progress) * cost));

/** Reachable quality points brought by the R&D levels. */
export const rndQualityBonus = (
  cfg: PlantSectorConfig,
  company: Company,
  line: ProductLine,
): number =>
  cfg.rnd.process.qualityPerLevel * company.processLevel +
  cfg.rnd.product.qualityPerLevel * (line.techLevel ?? 0);

/** Operator productivity multiplier brought by the R&D levels. */
export const rndProductivityFactor = (
  cfg: PlantSectorConfig,
  company: Company,
  line: ProductLine | undefined,
): number =>
  1 +
  cfg.rnd.process.productivityPerLevel * company.processLevel +
  cfg.rnd.product.productivityPerLevel * (line?.techLevel ?? 0);
