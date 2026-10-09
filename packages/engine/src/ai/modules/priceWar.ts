import type { Id } from '../../model/ids';
import type { Plan } from './plan';
import { lastEbitdaMargin } from './rivals';

/**
 * Price war. Each planning, the war discount fades by discount × depth /
 * durationQuarters (depth: profile.priceWarDepth) and the rivals' shelf
 * prices are compared with the last planning. A rival cutting by more than
 * priceCutTrigger while the own share falls by more than shareLossTrigger is
 * an attack: profile.brandDefense raises the marketing this quarter, and
 * outside the cooldown the planner ripostes with probability aggressiveness +
 * grudgeAggression × grudge against the cutters (one draw per planning, used
 * or not): discount × depth. During a war, a rival cutting again escalates it
 * (+escalationStep × depth, up to maxDiscount × depth; the same draw), and
 * joins it. Below truceMargin of EBITDA margin the war stops at once (truce)
 * and none starts. Ripostes, escalations and truces are public news;
 * ripostes and escalations add grudgeGain against the cutters. Returns the
 * discount on the target price, with the predatory discount of an
 * opportunist whose prey (rivals in difficulty) sell in its market.
 */
export function priceWar(plan: Plan): number {
  const { obs, config, profile, memory, market, line, rng } = plan;
  const W = config.ai.priceWar;
  const depth = profile.priceWarDepth;
  const roll = rng.next();
  const war = memory.priceWar;
  if (war) war.discount = Math.max(0, war.discount - (W.discount * depth) / W.durationQuarters);

  const cutters = new Set<Id>();
  const prices: Record<Id, number> = {};
  for (const c of obs.competitors) {
    if (c.status === 'bankrupt' || c.status === 'absorbed') continue;
    for (const p of c.products) {
      if (p.marketId !== market.id) continue;
      prices[p.lineId] = p.price;
      const before = memory.rivalPrices[p.lineId];
      if (before !== undefined && p.price < before * (1 - W.priceCutTrigger)) {
        cutters.add(c.companyId);
      }
    }
  }
  memory.rivalPrices = prices;
  const ownShare = market.lastResult.shares[line.id];
  const lostShare =
    ownShare !== undefined &&
    memory.lastShare >= 0 &&
    memory.lastShare - ownShare > W.shareLossTrigger;
  if (ownShare !== undefined) memory.lastShare = ownShare;
  const attacked = cutters.size > 0 && lostShare;
  if (attacked) plan.tactics.marketingBoost += profile.brandDefense;

  const margin = lastEbitdaMargin(plan);
  const bleeding = margin !== undefined && margin < W.truceMargin;
  const chance = (ids: readonly Id[]) =>
    Math.min(
      1,
      profile.aggressiveness +
        W.grudgeAggression * Math.max(0, ...ids.map((id) => memory.rivals[id]?.grudge ?? 0)),
    );
  const hit = (ids: readonly Id[], data?: Record<string, number>) => {
    for (const id of ids) {
      const rival = (memory.rivals[id] ??= { grudge: 0, weakQuarters: 0 });
      rival.grudge = Math.min(1, rival.grudge + W.grudgeGain);
      plan.signals.push(
        data ? { kind: 'ai_price_war', rivalId: id, data } : { kind: 'ai_price_war', rivalId: id },
      );
    }
  };

  const cutting = [...cutters].sort();
  const cooled =
    memory.lastRetaliationAt === undefined ||
    obs.turn - memory.lastRetaliationAt >= W.cooldownQuarters;
  if (war && war.discount > 0) {
    const max = W.maxDiscount * depth;
    const again = cutting.filter((id) => war.rivalIds.includes(id) || attacked);
    if (bleeding) {
      for (const id of war.rivalIds) plan.signals.push({ kind: 'ai_price_truce', rivalId: id });
      delete memory.priceWar;
    } else if (again.length > 0 && war.discount < max - 1e-9 && roll < chance(again)) {
      war.discount = Math.min(max, war.discount + W.escalationStep * depth);
      war.escalations += 1;
      war.rivalIds = [...new Set([...war.rivalIds, ...again])].sort();
      hit(again, { escalation: war.escalations });
    }
  } else if (attacked && !bleeding && cooled && roll < chance(cutting)) {
    memory.priceWar = {
      rivalIds: cutting,
      discount: W.discount * depth,
      startedAt: obs.turn,
      escalations: 0,
    };
    memory.lastRetaliationAt = obs.turn;
    hit(cutting);
  }
  if (memory.priceWar && memory.priceWar.discount <= 1e-9) delete memory.priceWar;

  const discount = memory.priceWar?.discount ?? 0;
  const predatory =
    plan.tactics.prey.length > 0 && !bleeding
      ? profile.opportunism * config.ai.opportunism.predatoryDiscount
      : 0;
  return 1 - (1 - discount) * (1 - predatory);
}
