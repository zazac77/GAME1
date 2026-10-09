import { clamp, sum } from '../../core/math';
import type { Plan } from './plan';
import { rnd } from './rnd';

/**
 * 7. Marketing and R&D (shares of the expected revenue, raised by brand
 * defense and counter-launches) and 8. finance (then a cash-squeeze fit,
 * see fitBudget): borrows when
 * the projected end-of-quarter cash falls below the buffer (or when the
 * plan's spending exceeds what validation would allow), repays term debt
 * with the cash above repayAboveQuarters of cash costs.
 */
export function marketingAndFinance(plan: Plan): void {
  const { obs, config, profile, company, line } = plan;
  const stock = company.inventory[line.id]?.qty ?? 0;
  plan.expectedSales = Math.min(plan.forecast, stock + plan.output);
  const revenue = plan.expectedSales * plan.price;
  const marketing = profile.marketingShareOfRevenue * revenue * (1 + plan.tactics.marketingBoost);
  if (marketing > 0) {
    plan.decisions.marketing[line.id] = marketing;
    plan.spend.discretionary += marketing;
  }
  rnd(plan, revenue);
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
  const spending = sum(Object.values(discretionarySpending(plan)));
  const need = Math.max(buffer - projected, spending - allowed, plan.spend.capex - cash, 0);
  if (need > 0) {
    const borrow = Math.min(obs.self.borrowingCapacity, need);
    if (borrow > 0) plan.decisions.finance.borrow = borrow;
  } else {
    const termDebt = sum(terms.map((l) => l.principal));
    const excess = projected - F.repayAboveQuarters * plan.quarterlyCashCosts;
    const repay = Math.min(termDebt, excess, cash - spending - plan.spend.capex);
    if (repay > 0) plan.decisions.finance.repay = repay;
  }
  fitBudget(plan, allowed);
}

/**
 * Discretionary spending as validation counts it: `soft` (marketing, listing
 * fees, R&D budgets) and `hard` (every spot purchase, hiring and training costs).
 */
function discretionarySpending(plan: Plan): { soft: number; hard: number } {
  const { obs, config, decisions: d } = plan;
  const spot = sum(
    d.purchasing.spot.map(
      (o) =>
        o.qty *
        (obs.commodities[o.commodityId]?.spotPrice ?? 0) *
        (1 + config.commodities.spotPremium),
    ),
  );
  const hiring = sum(
    d.hr.map(
      (h) =>
        h.hire * h.wageOffer * config.labor.hiringCost +
        (h.train?.count ?? 0) * config.labor.training.costPerPerson,
    ),
  );
  return {
    soft:
      sum(Object.values(d.marketing)) +
      sum(Object.values(d.listing)) +
      sum(d.rnd.map((r) => r.budget)),
    hard: spot + hiring,
  };
}

/**
 * Cash squeeze: when the plan spends more than validation will allow (no more
 * credit), marketing, listing fees and R&D are cut first, then spot purchases
 * and hires, rather than everything in proportion.
 */
function fitBudget(plan: Plan, allowed: number): void {
  const d = plan.decisions;
  const room = Math.max(0, allowed + (d.finance.borrow ?? 0) - (d.finance.repay ?? 0)) * (1 - 1e-6);
  const { soft, hard } = discretionarySpending(plan);
  if (soft + hard <= room) return;
  const keep = soft > 0 ? clamp((room - hard) / soft, 0, 1) : 0;
  for (const id of Object.keys(d.marketing)) d.marketing[id] = (d.marketing[id] ?? 0) * keep;
  for (const id of Object.keys(d.listing)) d.listing[id] = (d.listing[id] ?? 0) * keep;
  for (const r of d.rnd) r.budget *= keep;
  d.rnd = d.rnd.filter((r) => r.budget > 0 || (r.developers ?? 0) > 0);
  if (hard <= room) return;
  const f = hard > 0 ? room / hard : 0;
  for (const o of d.purchasing.spot) o.qty *= f;
  d.purchasing.spot = d.purchasing.spot.filter((o) => o.qty > 0);
  for (const h of d.hr) {
    h.hire = Math.floor(h.hire * f);
    if (h.train) {
      const count = Math.floor(h.train.count * f);
      if (count > 0) h.train.count = count;
      else delete h.train;
    }
  }
}
