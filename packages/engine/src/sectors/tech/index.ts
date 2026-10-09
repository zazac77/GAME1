import type { TurnContext } from '../../core/context';
import { operationalSites } from '../../core/companies';
import { clamp } from '../../core/math';
import type { Company } from '../../model/company';
import { sectorProductLine, techConfigOf } from '../config';
import type { SectorModule } from '../types';
import { assignedDevelopers, cloudPerUser, isOffice, reachableQuality, techTeam } from './team';

/**
 * Step 7 for a tech company: the product's quality (bugs) moves towards what
 * the seniors and the developers kept on maintenance allow; the offices cost
 * their upkeep. Subscriptions are sold and served at step 8.
 */
function produceTech(ctx: TurnContext, company: Company): void {
  const { draft: state, config } = ctx;
  const cfg = techConfigOf(config, company.sector);
  if (!cfg) return;
  const line = sectorProductLine(config, company);
  if (line) {
    const team = techTeam(config, cfg, company, assignedDevelopers(ctx.decisions[company.id]));
    const reachable = reachableQuality(cfg, team, line.users ?? 0, company.processLevel);
    line.quality = clamp(
      line.quality + cfg.quality.adjustSpeed * (reachable - line.quality),
      0,
      100,
    );
  }
  const offices = operationalSites(company).filter(isOffice).length;
  ctx.ledger(company.id).other += offices * cfg.office.upkeep * state.macro.priceLevel;
}

/**
 * Technology (SaaS subscriptions): a "unit" is a subscriber served for a
 * quarter, consuming cloud capacity (bought at consumption). No factory, no
 * stock.
 */
export const techModule: SectorModule = {
  id: 'tech',
  materialsPerUnit(state, company) {
    const cfg = techConfigOf(state.config, company.sector);
    return cfg ? { [cfg.cloudId]: cloudPerUser(cfg, company.processLevel) } : {};
  },
  plannedOutput(state, company) {
    return sectorProductLine(state.config, company)?.users ?? 0;
  },
  plannedInputs(state, company) {
    const cfg = techConfigOf(state.config, company.sector);
    const users = sectorProductLine(state.config, company)?.users ?? 0;
    return cfg ? { [cfg.cloudId]: users * cloudPerUser(cfg, company.processLevel) } : {};
  },
  produce: produceTech,
};
