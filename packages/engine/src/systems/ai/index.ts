import { newAiMemory } from '../../ai/memory';
import { observe } from '../../ai/observation';
import { planDecisions } from '../../ai/planner';
import { operatingCompanies } from '../../core/companies';
import { controllingActor, managementProfile } from '../../core/control';
import type { System } from '../../core/system';

/**
 * Step 0: every operating company that received no decisions is run by its
 * management in place (core/control.ts managementProfile: its founder's AI
 * profile, the profile of a bought listing, or the delegated management of
 * a subsidiary), planned from Observation(S_t), so all decisions rest on the
 * state at the start of the quarter (simultaneous resolution). The player's
 * root company is planned only on autopilot (sim-cli); the player's
 * subsidiaries run on their management unless the player decides for them.
 * The memory of each planner is kept by company.
 */
export const aiSystem: System = {
  id: 'ai',
  run(ctx) {
    const { draft } = ctx;
    for (const company of operatingCompanies(draft)) {
      if (ctx.decisions[company.id]) continue;
      if (!managementProfile(draft, company)) continue;
      // A company nobody controls observes for its founder (or for nobody).
      const actorId =
        controllingActor(draft, company.id) ??
        Object.values(draft.actors).find((a) => a.rootCompanyId === company.id)?.id ??
        '';
      const memory = draft.aiMemory[company.id] ?? newAiMemory();
      const plan = planDecisions(observe(draft, actorId, company.id), memory, ctx.rng);
      ctx.decisions[company.id] = plan.decisions;
      draft.aiMemory[company.id] = plan.memory;
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
