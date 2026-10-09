import { sum } from '../../core/math';
import type { Plan } from './plan';

/**
 * 7. Marketing (share of the expected revenue) and 8. finance: borrows when
 * the projected end-of-quarter cash falls below the buffer (or when the
 * plan's spending exceeds what validation would allow), repays term debt
 * with the cash above repayAboveQuarters of cash costs.
 */
export function marketingAndFinance(plan: Plan): void {
  const { obs, config, profile, company, line } = plan;
  const stock = company.inventory[line.id]?.qty ?? 0;
  plan.expectedSales = Math.min(plan.forecast, stock + plan.output);
  const revenue = plan.expectedSales * plan.price;
  const marketing = profile.marketingShareOfRevenue * revenue;
  if (marketing > 0) {
    plan.decisions.marketing[line.id] = marketing;
    plan.spend.discretionary += marketing;
  }
  for (const h of plan.decisions.hr) {
    plan.spend.discretionary += h.hire * h.wageOffer * config.labor.hiringCost;
    plan.spend.other +=
      (h.fire * config.labor.severanceQuarters + Math.max(0, h.hire - h.fire)) * h.wageOffer;
  }

  const { balance, pnl } = company.books.current;
  const cash = balance.cash;
  const wages = sum(Object.values(company.workforce).map((s) => s.headcount * s.wage));
  const terms = company.loans.filter((l) => l.kind === 'term');
  const installments = sum(
    terms.map((l) =>
      l.maturity - obs.turn <= 1 ? l.principal : l.principal / (l.maturity - obs.turn),
    ),
  );
  const overdraft = sum(
    company.loans.filter((l) => l.kind === 'overdraft').map((l) => l.principal),
  );
  const projected =
    cash +
    revenue -
    plan.spend.discretionary -
    plan.spend.capex -
    plan.spend.other -
    wages -
    installments -
    overdraft;
  const F = config.ai.finance;
  const buffer = F.cashBufferQuarters * plan.quarterlyCashCosts;
  // Validation caps discretionary spending at cash + borrowing − capex + a share of revenue.
  const allowed =
    cash - plan.spend.capex + config.finance.spendingOverdraftShareOfRevenue * pnl.revenue;
  const need = Math.max(
    buffer - projected,
    plan.spend.discretionary - allowed,
    plan.spend.capex - cash,
    0,
  );
  if (need > 0) {
    const borrow = Math.min(obs.self.borrowingCapacity, need);
    if (borrow > 0) plan.decisions.finance.borrow = borrow;
    return;
  }
  const termDebt = sum(terms.map((l) => l.principal));
  const excess = projected - F.repayAboveQuarters * plan.quarterlyCashCosts;
  const repay = Math.min(termDebt, excess, cash - plan.spend.discretionary - plan.spend.capex);
  if (repay > 0) plan.decisions.finance.repay = repay;
}
