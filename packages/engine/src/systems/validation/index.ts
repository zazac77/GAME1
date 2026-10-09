import { controlledCompanyIds } from '../../core/companies';
import type { System } from '../../core/system';
import type { CompanyDecisions, ValidationIssue } from '../../model/decisions';
import type { Id } from '../../model/ids';
import type { GameState } from '../../model/state';
import { normalizeDecisions } from './normalize';

export { emptyDecisions, normalizeDecisions } from './normalize';

/**
 * Keeps only the decisions of companies the actor controls, one per company.
 * Applied to the player's decisions before the turn starts.
 */
export function filterControlled(
  state: GameState,
  actorId: Id,
  decisions: readonly CompanyDecisions[],
): { kept: CompanyDecisions[]; issues: ValidationIssue[] } {
  const controlled = controlledCompanyIds(state, actorId);
  const seen = new Set<Id>();
  const kept: CompanyDecisions[] = [];
  const issues: ValidationIssue[] = [];
  for (const d of decisions) {
    const companyId = typeof d?.companyId === 'string' ? d.companyId : '';
    if (!controlled.has(companyId)) issues.push({ companyId, path: '', code: 'not_controlled' });
    else if (seen.has(companyId)) issues.push({ companyId, path: '', code: 'duplicate' });
    else {
      seen.add(companyId);
      kept.push(d);
    }
  }
  return { kept, issues };
}

/** What validation would change in the player's decisions (public API). */
export function validateDecisions(
  state: GameState,
  decisions: readonly CompanyDecisions[],
): ValidationIssue[] {
  const { kept, issues } = filterControlled(state, state.meta.playerActorId, decisions);
  for (const d of kept) {
    const company = state.companies[d.companyId];
    if (company) issues.push(...normalizeDecisions(state, company, d).issues);
  }
  return issues;
}

/** Step 1: every company ends up with normalized decisions (empty if none). */
export const validationSystem: System = {
  id: 'validation',
  run(ctx) {
    for (const companyId of Object.keys(ctx.draft.companies).sort()) {
      const company = ctx.draft.companies[companyId];
      if (!company) continue;
      const { decisions, issues } = normalizeDecisions(
        ctx.draft,
        company,
        ctx.decisions[companyId],
      );
      ctx.decisions[companyId] = decisions;
      ctx.issues.push(...issues);
    }
  },
};
