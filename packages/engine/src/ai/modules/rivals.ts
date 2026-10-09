import type { GameConfig } from '../../config/schema';
import { clamp } from '../../core/math';
import type { CompetitorView, RivalMemory } from '../../model/ai';
import type { Id } from '../../model/ids';
import type { Plan } from './plan';

/** EBITDA margin of the last closed quarter (undefined before the first sales). */
export function lastEbitdaMargin(plan: Plan): number | undefined {
  const { pnl } = plan.company.books.current;
  return pnl.revenue > 0 ? pnl.ebitda / pnl.revenue : undefined;
}

/**
 * A rival in difficulty, from public facts only: distressed, a junk credit
 * rating, or net losses in its last lossQuarters published quarters.
 */
export function looksWeak(c: CompetitorView, O: GameConfig['ai']['opportunism']): boolean {
  const last = c.published.slice(-O.lossQuarters);
  const losses = last.length >= O.lossQuarters && last.every((s) => s.pnl.netIncome < 0);
  return c.status === 'distressed' || O.weakRatings.includes(c.creditRating) || losses;
}

/**
 * 0. Rival watch (first module): grudges fade; each operating rival's product
 * (quality, tech level) and health are remembered. Rivals weak for
 * watchQuarters in a row go on the watchlist of an opportunistic profile;
 * those selling in the own market become its prey (public news when the
 * offensive starts). A rival whose product leaps ahead (a jump beyond
 * qualityJumpTrigger or techJumpTrigger that overtakes the own product)
 * triggers a counter-launch with probability profile.counterLaunch (one
 * draw per planning, used or not), outside the cooldown: for
 * durationQuarters, quality aimed just above the rival's (bounded), product
 * R&D and marketing raised.
 */
export function watchRivals(plan: Plan): void {
  const { obs, config, profile, memory, market, line, rng } = plan;
  const C = config.ai.counterLaunch;
  const O = config.ai.opportunism;
  const decay = config.ai.priceWar.grudgeDecay;
  const roll = rng.next();

  const rivals: Record<Id, RivalMemory> = {};
  let leap: { rivalId: Id; jump: number } | undefined;
  for (const c of obs.competitors) {
    if (c.status !== 'active' && c.status !== 'distressed') continue;
    const before = memory.rivals[c.companyId];
    const grudge = (before?.grudge ?? 0) * (1 - decay);
    const rival: RivalMemory = {
      grudge: grudge > 1e-3 ? grudge : 0,
      weakQuarters: looksWeak(c, O) ? (before?.weakQuarters ?? 0) + 1 : 0,
    };
    if (before?.lastOutbidAt !== undefined) rival.lastOutbidAt = before.lastOutbidAt;
    const p = c.products.find((x) => x.marketId === market.id);
    if (p) {
      rival.quality = p.quality;
      if (p.techLevel !== undefined) rival.techLevel = p.techLevel;
      const dq = before?.quality === undefined ? 0 : p.quality - before.quality;
      const dt =
        before?.techLevel === undefined || p.techLevel === undefined
          ? 0
          : p.techLevel - before.techLevel;
      const byQuality = dq > C.qualityJumpTrigger && p.quality > line.quality;
      const byTech = dt > C.techJumpTrigger && (p.techLevel ?? 0) > (line.techLevel ?? 0);
      // Jumps compared in units of their trigger.
      const jump = Math.max(
        byQuality ? dq / Math.max(1e-9, C.qualityJumpTrigger) : 0,
        byTech ? dt / Math.max(1e-9, C.techJumpTrigger) : 0,
      );
      if (jump > 0 && (!leap || jump > leap.jump)) leap = { rivalId: c.companyId, jump };
    }
    rivals[c.companyId] = rival;
  }
  memory.rivals = rivals;

  // Opportunism: rivals in difficulty under watch, prey when they sell in the own market.
  const watched = new Set(memory.watchlist);
  memory.watchlist =
    profile.opportunism > 0
      ? Object.keys(rivals)
          .filter((id) => (rivals[id]?.weakQuarters ?? 0) >= O.watchQuarters)
          .sort()
      : [];
  const sellers = new Set(
    obs.competitors
      .filter((c) => c.products.some((p) => p.marketId === market.id))
      .map((c) => c.companyId),
  );
  plan.tactics.prey = memory.watchlist.filter((id) => sellers.has(id));
  for (const id of plan.tactics.prey) {
    if (!watched.has(id)) plan.signals.push({ kind: 'ai_targets_rival', rivalId: id });
  }

  // Counter-launch against a rival whose product leapt ahead.
  const current = memory.counterLaunch;
  if (current && (obs.turn > current.until || !rivals[current.rivalId])) {
    delete memory.counterLaunch;
  }
  const cooled =
    memory.lastCounterLaunchAt === undefined ||
    obs.turn - memory.lastCounterLaunchAt >= C.cooldownQuarters;
  if (!memory.counterLaunch && leap && cooled && roll < profile.counterLaunch) {
    memory.counterLaunch = { rivalId: leap.rivalId, until: obs.turn + C.durationQuarters - 1 };
    memory.lastCounterLaunchAt = obs.turn;
    plan.signals.push({ kind: 'ai_counter_launch', rivalId: leap.rivalId });
  }
  const active = memory.counterLaunch;
  if (active) {
    plan.tactics.rndBoost += C.rndBoost;
    plan.tactics.marketingBoost += C.marketingBoost;
    const rivalQuality = rivals[active.rivalId]?.quality ?? 0;
    plan.tactics.qualityTarget = clamp(
      rivalQuality + C.qualityMargin,
      profile.qualityTarget,
      Math.min(100, profile.qualityTarget + C.maxQualityBoost),
    );
  }
}
