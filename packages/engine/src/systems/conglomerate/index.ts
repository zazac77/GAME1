import { groupHeadOf } from '../../core/group';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import { revalueHoldings } from '../stockmarket/holdings';
import { book } from './booking';
import { consolidate, consolidationScope } from './consolidation';
import { createHolding } from './holding';
import { cancelDeadLoans, settleTransfer, type GroupTrades } from './transfers';

export { canCreateHolding } from './holding';
export { consolidate, consolidationScope } from './consolidation';

/**
 * Step 12 (after the takeovers), on the accounts just closed: intra-group
 * loans with a company that no longer operates are written off; holding
 * companies requested by root companies are created; then the intra-group
 * transfers of every company (by id, in the order given): restructurings
 * (stakes sold at their value against an intra-group loan), dividends
 * declared by the parents, loans and repayments, cash pools, each within
 * the cash then available. The holdings are revalued (a dividend lowers the
 * price of a listed payer), and every group with a subsidiary gets its
 * consolidated accounts of the quarter, kept by its head.
 */
export const conglomerateSystem: System = {
  id: 'conglomerate',
  run(ctx) {
    const { draft, turn } = ctx;
    cancelDeadLoans(ctx);

    for (const actorId of Object.keys(draft.actors).sort()) {
      const actor = draft.actors[actorId];
      if (actor && ctx.decisions[actor.rootCompanyId]?.createHolding) createHolding(ctx, actor);
    }

    const trades: GroupTrades = {};
    for (const id of Object.keys(ctx.decisions).sort()) {
      for (const transfer of ctx.decisions[id]?.intraGroup ?? []) {
        settleTransfer(ctx, transfer, trades);
      }
    }

    for (const id of Object.keys(draft.companies).sort()) {
      const company = draft.companies[id] as Company;
      if (company.books.current.quarter !== turn) continue;
      const { carrying, result, groupResult } = revalueHoldings(draft, company, trades[id]);
      company.books.current.balance.financialAssets = carrying;
      book(company, turn, { financial: result, groupFinancial: groupResult });
    }

    const heads = new Set<string>();
    for (const actorId of Object.keys(draft.actors).sort()) {
      const headId = groupHeadOf(draft, actorId);
      const head = headId ? draft.companies[headId] : undefined;
      if (!head || consolidationScope(draft, head.id).length < 2) continue;
      const statements = consolidate(draft, head.id, turn);
      if (!statements) continue;
      heads.add(head.id);
      const history = (head.books.consolidated ??= []);
      history.push(statements);
      const max = draft.config.reporting.historyMaxLength;
      if (history.length > max) history.splice(0, history.length - max);
    }
    for (const company of Object.values(draft.companies)) {
      if (!heads.has(company.id) && company.books.consolidated) delete company.books.consolidated;
    }
  },
};
