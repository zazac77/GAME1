import type { TechConfig } from '../../config/schema';
import type { TurnContext } from '../../core/context';
import { newId } from '../../core/ids';
import { applyModifiers } from '../../core/modifiers';
import type { Company, RndProject, RndType } from '../../model/company';
import type { ProductMarket } from '../../model/markets';
import { sectorProductLine, techConfigOf } from '../config';
import {
  assignedDevelopers,
  averageWage,
  developerEfficiency,
  productManagerCoverage,
  techTeam,
} from './team';

/** Developer-quarters a new project needs (platform projects grow with the level). */
export const techProjectEffort = (cfg: TechConfig, type: RndType, processLevel: number): number =>
  type === 'product'
    ? cfg.rnd.product.effort
    : cfg.rnd.process.effort * (1 + cfg.rnd.effortGrowthPerLevel * processLevel);

/** Most developer-quarters a project absorbs this quarter. */
export const maxEffortThisQuarter = (cfg: TechConfig, effort: number, progress: number): number =>
  Math.max(0, Math.min(cfg.rnd.maxEffortShare * effort, (1 - progress) * effort));

/** Most developers a project can use this quarter, at the given developer efficiency. */
export const maxDevelopersFor = (
  cfg: TechConfig,
  effort: number,
  progress: number,
  efficiency: number,
): number =>
  Math.max(
    0,
    Math.ceil(maxEffortThisQuarter(cfg, effort, progress) / Math.max(1e-9, efficiency) - 1e-9),
  );

/** Whether a new project of this type can start (the platform level is capped). */
export const canStartTechProject = (
  cfg: TechConfig,
  type: RndType,
  processLevel: number,
): boolean => type === 'product' || processLevel < cfg.rnd.maxLevel;

/**
 * The technology frontier of a tech market moves on: advancePerQuarter plus
 * the tech.frontier modifiers (disruptive innovation).
 */
export function advanceFrontier(ctx: TurnContext, market: ProductMarket): void {
  const cfg = ctx.config.sectors.tech;
  if (!cfg || market.techFrontier === undefined) return;
  const step = applyModifiers(
    ctx.draft.modifiers,
    'tech.frontier',
    cfg.frontier.advancePerQuarter,
    [{ kind: 'market', id: market.id }],
  );
  market.techFrontier += Math.max(0, step);
}

function start(ctx: TurnContext, cfg: TechConfig, company: Company): void {
  const line = sectorProductLine(ctx.config, company);
  for (const order of ctx.decisions[company.id]?.rnd ?? []) {
    if ((order.developers ?? 0) <= 0) continue;
    if (company.rnd.some((p) => p.type === order.type)) continue;
    if (order.type === 'product' && !line) continue;
    if (!canStartTechProject(cfg, order.type, company.processLevel)) continue;
    const effort = techProjectEffort(cfg, order.type, company.processLevel);
    const project: RndProject = {
      id: newId(ctx.draft.meta, 'rnd'),
      type: order.type,
      progress: 0,
      spent: 0,
      effort,
      cost: effort * averageWage(company, cfg.developerOccupationId),
      startedAt: ctx.turn,
    };
    if (order.type === 'product' && line) project.productLineId = line.id;
    company.rnd.push(project);
    ctx.log({
      kind: 'rnd_started',
      severity: 'info',
      companyId: company.id,
      data: { projectId: project.id, type: project.type },
    });
  }
}

/**
 * Developers work on their projects: developers × efficiency × noise
 * developer-quarters, within what the project absorbs this quarter; the wages
 * of the developers used move from wages to R&D in the books.
 */
function advance(ctx: TurnContext, cfg: TechConfig, company: Company): void {
  const decisions = ctx.decisions[company.id];
  const team = techTeam(ctx.config, cfg, company, assignedDevelopers(decisions));
  const efficiency = developerEfficiency(cfg, team);
  const wage = averageWage(company, cfg.developerOccupationId);
  const ledger = ctx.ledger(company.id);
  let available = team.rndDevelopers;
  for (const order of decisions?.rnd ?? []) {
    const project = company.rnd.find((p) => p.type === order.type);
    const effort = project?.effort ?? 0;
    if (!project || effort <= 0) continue;
    const developers = Math.min(order.developers ?? 0, available);
    if (developers <= 0) continue;
    // Uncertain pace: the noise is on the developer-quarters, so the last quarter
    // of a project always completes when it is staffed for the remaining effort.
    const pace = efficiency * (1 + cfg.rnd.progressNoise * (2 * ctx.rng.next() - 1));
    const done = Math.min(developers * pace, maxEffortThisQuarter(cfg, effort, project.progress));
    if (done <= 0) continue;
    const working = Math.min(developers, done / pace);
    available -= working;
    project.progress = Math.min(1, project.progress + done / effort);
    const cost = working * wage;
    project.spent += cost;
    ledger.wages -= cost;
    ledger.rnd += cost;
  }
  for (const project of [...company.rnd]) {
    if (project.progress >= 1 - 1e-9) complete(ctx, cfg, company, project, team);
  }
}

function complete(
  ctx: TurnContext,
  cfg: TechConfig,
  company: Company,
  project: RndProject,
  team: ReturnType<typeof techTeam>,
): void {
  let level: number;
  if (project.type === 'process') {
    company.processLevel = Math.min(cfg.rnd.maxLevel, company.processLevel + 1);
    level = company.processLevel;
  } else {
    const line = project.productLineId ? company.productLines[project.productLineId] : undefined;
    const frontier = line ? (ctx.draft.productMarkets[line.marketId]?.techFrontier ?? 0) : 0;
    const outcome = 1 + cfg.rnd.outcomeNoise * (2 * ctx.rng.next() - 1);
    const pm = 1 + cfg.rnd.productManagerBonus * Math.min(1, productManagerCoverage(cfg, team));
    if (line) {
      const current = line.techLevel ?? 0;
      const gain =
        cfg.rnd.product.releaseGain * outcome * pm +
        cfg.rnd.product.imitation * Math.max(0, frontier - current);
      line.techLevel = Math.max(current, Math.min(frontier + cfg.frontier.maxLead, current + gain));
    }
    level = line?.techLevel ?? 0;
  }
  company.rnd = company.rnd.filter((p) => p.id !== project.id);
  ctx.log({
    kind: 'rnd_completed',
    severity: 'info',
    companyId: company.id,
    data: { projectId: project.id, type: project.type, level, spent: project.spent },
  });
}

/**
 * Step 9 for a tech company: new projects start, the platform level fades,
 * the assigned developers move the projects forward. A release raises the
 * product's tech level by an uncertain amount plus a share of its lag
 * (imitation), never beyond frontier + maxLead; a platform project adds a level.
 */
export function runTechRnd(ctx: TurnContext, company: Company): void {
  const cfg = techConfigOf(ctx.config, company.sector);
  if (!cfg) return;
  start(ctx, cfg, company);
  company.processLevel = Math.max(0, company.processLevel - cfg.rnd.obsolescencePerQuarter);
  advance(ctx, cfg, company);
}
