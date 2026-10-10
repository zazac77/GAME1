import { isOperating } from '../../core/companies';
import { newId } from '../../core/ids';
import { sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { LaborPoolKey } from '../../model/ids';
import type { IntelReport } from '../../model/victory';

/** What an operation finds on the target at the start of the quarter. */
export function intelOn(company: Company, report: Pick<IntelReport, 'id' | 'turn' | 'spyId'>) {
  const out: IntelReport = {
    ...report,
    targetId: company.id,
    cash: company.books.current.balance.cash,
    debt: sum(company.loans.map((l) => l.principal)),
    workforce: Object.keys(company.workforce)
      .sort()
      .map((key) => {
        const staff = company.workforce[key as LaborPoolKey];
        return {
          key: key as LaborPoolKey,
          headcount: staff?.headcount ?? 0,
          wage: staff?.wage ?? 0,
        };
      }),
    inventory: Object.fromEntries(
      Object.keys(company.inventory)
        .sort()
        .map((id) => [id, company.inventory[id]?.qty ?? 0]),
    ),
    lines: Object.keys(company.productLines)
      .sort()
      .map((lineId) => {
        const l = company.productLines[lineId] as Company['productLines'][string];
        const line: IntelReport['lines'][number] = {
          lineId,
          price: l.price,
          quality: l.quality,
          qualityTarget: l.qualityTarget,
        };
        if (l.techLevel !== undefined) line.techLevel = l.techLevel;
        return line;
      }),
    rnd: company.rnd.map((p) => ({ type: p.type, progress: p.progress, spent: p.spent })),
  };
  const last = company.books.history.at(-1);
  if (last) out.statements = structuredClone(last);
  return out;
}

/**
 * Step 3 (after the due diligences): every espionage operation ordered is
 * paid (cost × opening price level). It succeeds with successProbability: a
 * report on the target's private figures (last closed statements, cash,
 * debt, staff and wages, stocks, product lines, R&D), kept in state.intel for
 * the spy. Whatever the result, the target finds out with
 * detectionProbability: public news, a fine, the spy's brand hit for a few
 * quarters, and the grudge of the target's AI management.
 */
export const espionageSystem: System = {
  id: 'espionage',
  run(ctx) {
    const { draft, config, rng, turn } = ctx;
    const E = config.espionage;
    if (!E.enabled) return;
    for (const spyId of Object.keys(ctx.decisions).sort()) {
      const spy = draft.companies[spyId];
      if (!spy || !isOperating(spy)) continue;
      for (const op of ctx.decisions[spyId]?.espionage ?? []) {
        const target = draft.companies[op.targetId];
        if (!target || !isOperating(target)) continue;
        ctx.ledger(spyId).other += E.cost * ctx.openingPriceLevel;
        const success = rng.chance(E.successProbability);
        const detected = rng.chance(E.detectionProbability);
        if (success) {
          const report = intelOn(target, { id: newId(draft.meta, 'intel'), turn, spyId });
          const reports = (draft.intel[spyId] ??= []);
          reports.push(report);
          if (reports.length > E.reportsKept) reports.splice(0, reports.length - E.reportsKept);
        }
        ctx.log({
          kind: success ? 'espionage_success' : 'espionage_failed',
          severity: 'info',
          companyId: spyId,
          data: { targetId: target.id },
        });
        if (!detected) continue;
        ctx.ledger(spyId).other += E.fine * ctx.openingPriceLevel;
        if (E.brandPenalty > 0) {
          draft.modifiers.push({
            id: newId(draft.meta, 'mod'),
            sourceId: 'espionage',
            target: { kind: 'company', id: spyId },
            key: 'company.brand',
            op: 'add',
            value: -E.brandPenalty / E.brandPenaltyQuarters,
            remaining: E.brandPenaltyQuarters,
            decay: 0,
          });
        }
        const memory = draft.aiMemory[target.id];
        if (memory) {
          const rival = (memory.rivals[spyId] ??= { grudge: 0, weakQuarters: 0 });
          rival.grudge = Math.min(1, rival.grudge + E.grudge);
        }
        ctx.log({
          kind: 'espionage_detected',
          severity: 'warning',
          companyId: spyId,
          data: { targetId: target.id, fine: E.fine * ctx.openingPriceLevel },
        });
      }
    }
  },
};
