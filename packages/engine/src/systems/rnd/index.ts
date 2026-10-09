import type { TurnContext } from '../../core/context';
import { operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import type { System } from '../../core/system';
import type { Company, RndProject } from '../../model/company';
import { plantConfigOf, techConfigOf } from '../../sectors/config';
import { mainProductLine } from '../../sectors/plant';
import { rndLevel, rndMaxSpend, rndProjectCost } from '../../sectors/plant/rnd';
import { advanceFrontier, runTechRnd } from '../../sectors/tech/rnd';

/** Levels fade as the rivals catch up. */
function obsolescence(ctx: TurnContext, company: Company): void {
  const decay = plantConfigOf(ctx.config, company.sector)?.rnd.obsolescencePerQuarter ?? 0;
  company.processLevel = Math.max(0, company.processLevel - decay);
  for (const line of Object.values(company.productLines)) {
    if (line.techLevel !== undefined) line.techLevel = Math.max(0, line.techLevel - decay);
  }
}

/** Starts the projects funded for the first time, at the start-of-quarter levels and prices. */
function start(ctx: TurnContext, company: Company): void {
  const { draft, config, turn } = ctx;
  const cfg = plantConfigOf(config, company.sector);
  if (!cfg) return;
  const line = mainProductLine(draft, company);
  for (const order of ctx.decisions[company.id]?.rnd ?? []) {
    if (company.rnd.some((p) => p.type === order.type)) continue;
    if (order.type === 'product' && !line) continue;
    const level = rndLevel(company, order.type, line);
    if (level >= cfg.rnd.maxLevel) continue;
    const project: RndProject = {
      id: newId(draft.meta, 'rnd'),
      type: order.type,
      progress: 0,
      spent: 0,
      cost: rndProjectCost(cfg, order.type, level, ctx.openingPriceLevel),
      startedAt: turn,
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

/** Spends the quarter's budgets, moves the projects forward and completes them. */
function advance(ctx: TurnContext, company: Company): void {
  const { config, rng } = ctx;
  const cfg = plantConfigOf(config, company.sector);
  if (!cfg) return;
  const ledger = ctx.ledger(company.id);
  for (const order of ctx.decisions[company.id]?.rnd ?? []) {
    const project = company.rnd.find((p) => p.type === order.type);
    if (!project || project.cost <= 0) continue;
    const budget = Math.min(order.budget, rndMaxSpend(cfg, project.cost, project.progress));
    if (budget <= 0) continue;
    const efficiency = 1 + cfg.rnd.progressNoise * (2 * rng.next() - 1);
    project.progress = Math.min(1, project.progress + (budget / project.cost) * efficiency);
    project.spent += budget;
    ledger.rnd += budget;
  }
  for (const project of [...company.rnd]) {
    if (project.progress >= 1 - 1e-9) complete(ctx, company, project);
  }
}

function complete(ctx: TurnContext, company: Company, project: RndProject): void {
  const R = plantConfigOf(ctx.config, company.sector)?.rnd;
  if (!R) return;
  let level: number;
  if (project.type === 'process') {
    company.processLevel = Math.min(R.maxLevel, company.processLevel + 1);
    level = company.processLevel;
  } else {
    const line = project.productLineId ? company.productLines[project.productLineId] : undefined;
    if (line) line.techLevel = Math.min(R.maxLevel, (line.techLevel ?? 0) + 1);
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
 * Step 9: the technology frontier of the tech markets moves on; new projects
 * start (costed at the start-of-quarter level, as validation quoted them),
 * the R&D levels fade (obsolescence), then the quarter's budgets (an
 * operating expense) move the projects forward with some uncertainty. A
 * completed project adds one level, effective from the next quarter
 * (productivity and reachable quality, sectors/plant/rnd.ts). Tech companies
 * staff their projects with developers instead (sectors/tech/rnd.ts).
 */
export const rndSystem: System = {
  id: 'rnd',
  run(ctx) {
    for (const marketId of Object.keys(ctx.draft.productMarkets).sort()) {
      const market = ctx.draft.productMarkets[marketId];
      if (market) advanceFrontier(ctx, market);
    }
    for (const company of operatingCompanies(ctx.draft)) {
      if (techConfigOf(ctx.config, company.sector)) {
        runTechRnd(ctx, company);
        continue;
      }
      start(ctx, company);
      obsolescence(ctx, company);
      advance(ctx, company);
    }
  },
};
