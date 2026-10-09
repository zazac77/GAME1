import { newAiMemory } from '../../ai/memory';
import { observe } from '../../ai/observation';
import { planDecisions } from '../../ai/planner';
import { isOperating } from '../../core/companies';
import type { System } from '../../core/system';

/**
 * Step 0: every actor with an AI profile whose company received no decisions
 * plans them from Observation(S_t), so all decisions rest on the state at
 * the start of the quarter (simultaneous resolution). The player's actor has
 * a profile only on autopilot (sim-cli).
 */
export const aiSystem: System = {
  id: 'ai',
  run(ctx) {
    const { draft } = ctx;
    for (const actorId of Object.keys(draft.actors).sort()) {
      const actor = draft.actors[actorId];
      const company = actor ? draft.companies[actor.rootCompanyId] : undefined;
      if (!actor?.profileId || !company || !isOperating(company)) continue;
      if (ctx.decisions[company.id]) continue;
      const memory = draft.aiMemory[actorId] ?? newAiMemory();
      const plan = planDecisions(observe(draft, actorId), memory, ctx.rng);
      ctx.decisions[company.id] = plan.decisions;
      draft.aiMemory[actorId] = plan.memory;
      for (const signal of plan.signals) {
        ctx.log({
          kind: signal.kind,
          severity: signal.kind === 'ai_price_truce' ? 'info' : 'warning',
          companyId: company.id,
          data: { rivalId: signal.rivalId, ...signal.data },
        });
      }
    }
  },
};
