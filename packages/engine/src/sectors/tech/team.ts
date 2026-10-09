import type { GameConfig, TechConfig } from '../../config/schema';
import { trainees } from '../../core/companies';
import { clamp, sum } from '../../core/math';
import type { Company, Site } from '../../model/company';
import type { CompanyDecisions } from '../../model/decisions';
import type { Id } from '../../model/ids';

// Pure helpers on the config and the company (the AI planner uses them too).

/** Staff of an occupation across the regions: trainees excluded, new hires at reduced productivity. */
export function productiveStaff(config: GameConfig, company: Company, occupationId: Id): number {
  const ramp = 1 - config.labor.rampUpProductivity;
  return sum(
    Object.values(company.workforce)
      .filter((s) => s.occupationId === occupationId)
      .map((s) => Math.max(0, s.headcount - trainees(s) - ramp * s.rampingUp)),
  );
}

/** Average wage of an occupation's staff (0 without staff). */
export function averageWage(company: Company, occupationId: Id): number {
  const groups = Object.values(company.workforce).filter((s) => s.occupationId === occupationId);
  const headcount = sum(groups.map((s) => s.headcount));
  return headcount > 0 ? sum(groups.map((s) => s.headcount * s.wage)) / headcount : 0;
}

/** The producing staff of a SaaS company this quarter. */
export interface TechTeam {
  developers: number;
  /** Developers assigned to R&D projects (within `developers`). */
  rndDevelopers: number;
  /** Developers left to maintain the product. */
  maintainers: number;
  seniors: number;
  support: number;
  productManagers: number;
}

/** Developers the decisions assign to R&D projects. */
export const assignedDevelopers = (decisions: CompanyDecisions | undefined): number =>
  sum((decisions?.rnd ?? []).map((r) => r.developers ?? 0));

export function techTeam(
  config: GameConfig,
  cfg: TechConfig,
  company: Company,
  rndDevelopers: number,
): TechTeam {
  const developers = productiveStaff(config, company, cfg.developerOccupationId);
  const rnd = clamp(rndDevelopers, 0, developers);
  return {
    developers,
    rndDevelopers: rnd,
    maintainers: developers - rnd,
    seniors: productiveStaff(config, company, cfg.seniorOccupationId),
    support: productiveStaff(config, company, cfg.supportOccupationId),
    productManagers: productiveStaff(config, company, cfg.productManagerOccupationId),
  };
}

/** Seniors relative to their target ratio to developers. */
export function seniorCoverage(cfg: TechConfig, team: TechTeam): number {
  if (team.developers > 0) return team.seniors / (cfg.seniorRatio * team.developers);
  return team.seniors > 0 ? cfg.quality.maxSeniorRatio : 0;
}

/** Share of the subscribers the developers off R&D can maintain (0..1). */
export const maintenanceCoverage = (cfg: TechConfig, team: TechTeam, users: number): number =>
  users > 0 ? Math.min(1, (team.maintainers * cfg.usersPerDeveloper) / users) : 1;

/** Share of the subscribers the support agents can serve (0..1). */
export const supportCoverage = (cfg: TechConfig, team: TechTeam, users: number): number =>
  users > 0 ? Math.min(1, (team.support * cfg.usersPerSupport) / users) : 1;

/** Product managers relative to their target ratio to developers. */
export const productManagerCoverage = (cfg: TechConfig, team: TechTeam): number =>
  team.developers > 0
    ? team.productManagers / (cfg.productManagerRatio * team.developers)
    : team.productManagers > 0
      ? 1
      : 0;

/** Developer-quarters one developer assigned to R&D brings (seniors speed it up). */
export const developerEfficiency = (cfg: TechConfig, team: TechTeam): number =>
  1 + cfg.rnd.seniorBonus * Math.min(1, seniorCoverage(cfg, team));

/**
 * Quality the product moves towards: seniors (fewer bugs), maintenance
 * coverage of the subscribers and the platform level.
 */
export function reachableQuality(
  cfg: TechConfig,
  team: TechTeam,
  users: number,
  processLevel: number,
): number {
  const q = cfg.quality;
  return clamp(
    q.base +
      q.seniorWeight * Math.min(q.maxSeniorRatio, seniorCoverage(cfg, team)) -
      q.maintenanceWeight * (1 - maintenanceCoverage(cfg, team, users)) +
      cfg.rnd.process.qualityPerLevel * processLevel,
    0,
    100,
  );
}

/** Cloud units per billed subscriber, after the platform savings. */
export const cloudPerUser = (cfg: TechConfig, processLevel: number): number =>
  cfg.cloudPerUser * Math.max(0, 1 - cfg.rnd.process.cloudSavingPerLevel * processLevel);

/**
 * Quarterly churn: price against the average offer, lag behind the
 * technology frontier, quality (bugs) and support coverage.
 */
export function churnRate(
  cfg: TechConfig,
  offer: { price: number; quality: number; techGap: number; supportCoverage: number },
  averagePrice: number,
): number {
  const S = cfg.subscription;
  const relative = averagePrice > 0 && offer.price > 0 ? offer.price / averagePrice : 1;
  const factor =
    relative ** S.priceSensitivity *
    (1 + S.techGapSensitivity * Math.max(0, offer.techGap)) *
    Math.max(0, 1 + (S.qualitySensitivity * (50 - offer.quality)) / 50) *
    (1 + S.supportSensitivity * (1 - offer.supportCoverage));
  return clamp(S.baseChurn * factor, S.minChurn, S.maxChurn);
}

// ---- offices --------------------------------------------------------------------

export const isOffice = (site: Site): boolean => site.kind === 'office';

/** Fit-out of a new office, at the given price level. */
export const officeCost = (cfg: TechConfig, landCostIndex: number, priceLevel: number): number =>
  cfg.office.buildCost * landCostIndex * priceLevel;

/** Seats of the offices of each region (offices being fitted out included). */
export function seatsByRegion(company: Company): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const site of Object.values(company.sites)) {
    if (isOffice(site)) out[site.regionId] = (out[site.regionId] ?? 0) + (site.seats ?? 0);
  }
  return out;
}

/** Headcount of each region (every occupation, trainees included). */
export function headcountByRegion(company: Company): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const staff of Object.values(company.workforce)) {
    out[staff.regionId] = (out[staff.regionId] ?? 0) + staff.headcount;
  }
  return out;
}
