import type { TurnContext } from '../../core/context';
import { isOperating } from '../../core/companies';
import { declaredLevels, groupStakes } from '../../core/disclosure';
import type { HolderId, Id } from '../../model/ids';
import type { ActivistCampaign } from '../../model/stock';

/**
 * Disclosure (end of step 12): a holder group whose stake in a listed company
 * crossed a threshold of stockMarket.disclosureThresholds since its last
 * declaration, up or down, declares it (public news); declarations follow the
 * registry (stock.declared).
 */
export function announceStakes(ctx: TurnContext): void {
  const { draft } = ctx;
  const before = draft.stock.declared;
  const after = declaredLevels(draft);
  const cache: Record<Id, HolderId> = {};
  for (const targetId of Object.keys(after).sort()) {
    const was = before[targetId] ?? {};
    const now = after[targetId] ?? {};
    const groups = [...new Set([...Object.keys(was), ...Object.keys(now)])].sort();
    let stakes: Record<HolderId, number> | undefined;
    for (const holderId of groups) {
      const previous = was[holderId] ?? 0;
      const level = now[holderId] ?? 0;
      if (previous === level) continue;
      stakes ??= groupStakes(draft, targetId, cache);
      ctx.log({
        kind: 'stake_threshold',
        severity: level > previous ? 'warning' : 'info',
        companyId: targetId,
        data: { holderId, level, previous, stake: stakes[holderId] ?? 0 },
      });
    }
  }
  draft.stock.declared = after;
}

/**
 * Activist campaigns (end of step 12): the fund campaigns in every listed
 * company of which it holds at least campaignStake (public news): for a
 * payout when the company has net cash in its last accounts, else for its
 * sale. A campaign ends with the stake.
 */
export function updateCampaigns(ctx: TurnContext): void {
  const { draft, turn } = ctx;
  const A = draft.config.stockMarket.activist;
  const kept: ActivistCampaign[] = [];
  for (const actor of Object.values(draft.actors).filter((a) => a.kind === 'fund')) {
    const fundId = actor.rootCompanyId;
    for (const targetId of Object.keys(draft.stock.registry).sort()) {
      const target = draft.companies[targetId];
      const held = draft.stock.registry[targetId]?.[fundId] ?? 0;
      if (!target?.listed || !isOperating(target) || target.id === fundId) continue;
      if (held < A.campaignStake * target.sharesOutstanding) continue;
      const running = draft.stock.campaigns.find(
        (c) => c.fundId === fundId && c.targetId === targetId,
      );
      if (running) {
        kept.push(running);
        continue;
      }
      const b = target.books.current.balance;
      const campaign: ActivistCampaign = {
        fundId,
        targetId,
        demand: b.cash > b.debt ? 'payout' : 'sale',
        since: turn,
      };
      kept.push(campaign);
      ctx.log({
        kind: 'activist_campaign',
        severity: 'warning',
        companyId: targetId,
        data: { fundId, demand: campaign.demand },
      });
    }
  }
  draft.stock.campaigns = kept;
}
