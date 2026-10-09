import { operatingCompanies } from '../../core/companies';
import { newId } from '../../core/ids';
import type { System } from '../../core/system';
import { currentSpread } from './credit';

/**
 * Step 3: new term loans and voluntary repayments, at the start of the
 * quarter (validation already bounded both). Dividends, share issues and
 * buybacks arrive in phase 2.
 */
export const financePreSystem: System = {
  id: 'financePre',
  run(ctx) {
    const { draft, config, turn } = ctx;
    for (const company of operatingCompanies(draft)) {
      const fin = ctx.decisions[company.id]?.finance;
      if (!fin) continue;
      const ledger = ctx.ledger(company.id);
      if (fin.borrow && fin.borrow > 0) {
        company.loans.push({
          id: newId(draft.meta, 'loan'),
          kind: 'term',
          principal: fin.borrow,
          spread: currentSpread(config, company),
          maturity: turn + config.finance.loanTermQuarters,
        });
        ledger.borrowed += fin.borrow;
      }
      let toRepay = fin.repay ?? 0;
      // Most expensive term loans first.
      const terms = company.loans
        .filter((l) => l.kind === 'term')
        .sort((a, b) => b.spread - a.spread || a.id.localeCompare(b.id));
      for (const loan of terms) {
        if (toRepay <= 0) break;
        const paid = Math.min(loan.principal, toRepay);
        loan.principal -= paid;
        toRepay -= paid;
        ledger.repaid += paid;
      }
      company.loans = company.loans.filter((l) => l.principal > 1e-6);
    }
  },
};
