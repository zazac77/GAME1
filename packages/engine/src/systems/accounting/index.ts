import type { TurnContext } from '../../core/context';
import {
  fixedAssetValue,
  inventoryValue,
  operatingCompanies,
  operationalSites,
  totalDebt,
} from '../../core/companies';
import { newId } from '../../core/ids';
import { sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { Statements } from '../../model/finance';
import type { GameState } from '../../model/state';
import { rate, trailingAnnual } from '../finance/credit';

/** Storage of stored materials and finished goods; units above the warehouses cost more. */
export function storageCost(state: GameState, company: Company): number {
  const { config } = state;
  let units = 0;
  let cost = 0;
  for (const [itemId, lot] of Object.entries(company.inventory)) {
    if (lot.qty <= 0) continue;
    const commodity = config.commodities.markets[itemId];
    units += lot.qty;
    cost +=
      lot.qty *
      (commodity ? commodity.storageCostPerUnit : config.sectors.industry.finishedGoodsStorageCost);
  }
  const capacity = sum(operationalSites(company).map((s) => s.warehouseCapacity));
  const overflowShare = units > capacity && units > 0 ? (units - capacity) / units : 0;
  const multiplier = 1 + (config.commodities.overflowStorageMultiplier - 1) * overflowShare;
  return cost * multiplier * state.macro.priceLevel;
}

/** Straight-line depreciation of lines and buildings; returns the charge. */
export function depreciate(state: GameState, company: Company): number {
  const cfg = state.config.sectors.industry;
  let charge = 0;
  for (const site of Object.values(company.sites)) {
    if (site.status !== 'operational') continue;
    const landIndex = state.regions[site.regionId]?.landCostIndex ?? 1;
    const building = Math.min(
      site.buildingBookValue,
      (cfg.factory.buildCost * landIndex) / cfg.factory.depreciationQuarters,
    );
    site.buildingBookValue -= building;
    charge += building;
    for (const line of Object.values(site.lines)) {
      const d = Math.min(line.bookValue, cfg.line.buildCost / cfg.line.depreciationQuarters);
      line.bookValue -= d;
      charge += d;
    }
  }
  return charge;
}

/** Interest of the quarter on the loans outstanding after the start-of-quarter financing. */
export function interestCharge(state: GameState, company: Company): number {
  const { policyRate } = state.macro;
  const penalty = company.credit.covenantBreached ? state.config.finance.covenant.spreadPenalty : 0;
  return sum(
    company.loans.map(
      (l) =>
        (l.principal * Math.max(0, policyRate + l.spread + (l.kind === 'term' ? penalty : 0))) / 4,
    ),
  );
}

/** Pays the scheduled installments of term loans; returns the amount repaid. */
function payInstallments(company: Company, turn: number): number {
  let paid = 0;
  for (const loan of company.loans) {
    if (loan.kind !== 'term') continue;
    const left = loan.maturity - turn;
    const due = left <= 1 ? loan.principal : loan.principal / left;
    loan.principal -= due;
    paid += due;
  }
  company.loans = company.loans.filter((l) => l.principal > 1e-6);
  return paid;
}

/** Draws or repays the overdraft so that cash ends ≥ 0; returns the net drawing. */
function settleOverdraft(ctx: TurnContext, company: Company, cash: number): number {
  const { draft, config, turn } = ctx;
  let overdraft = company.loans.find((l) => l.kind === 'overdraft');
  const before = overdraft?.principal ?? 0;
  const after = cash < 0 ? before - cash : Math.max(0, before - cash);
  if (after > 0) {
    if (!overdraft) {
      overdraft = {
        id: newId(draft.meta, 'loan'),
        kind: 'overdraft',
        principal: 0,
        spread: config.finance.overdraftSpread,
        maturity: turn + 1,
      };
      company.loans.push(overdraft);
    }
    overdraft.principal = after;
    overdraft.maturity = turn + 1;
    if (before === 0) {
      ctx.log({
        kind: 'overdraft',
        severity: 'warning',
        companyId: company.id,
        data: { amount: after },
      });
    }
  } else {
    company.loans = company.loans.filter((l) => l.kind !== 'overdraft');
  }
  return after - before;
}

function goBankrupt(ctx: TurnContext, company: Company): void {
  const { draft, config } = ctx;
  company.status = 'bankrupt';
  // Liquidation: staff go back to their pools, contracts lapse.
  company.workforce = {};
  company.contracts = [];
  ctx.log({ kind: 'company_bankrupt', severity: 'critical', companyId: company.id });
  const player = draft.actors[draft.meta.playerActorId];
  if (
    player?.rootCompanyId === company.id &&
    draft.meta.mode === 'standard' &&
    config.victory.bankruptcyEndsGame
  ) {
    draft.meta.status = 'lost';
    ctx.log({ kind: 'game_lost', severity: 'critical', companyId: company.id });
  }
}

/**
 * Step 10: closes the quarter of every operating company. Income statement
 * (storage, depreciation, interest, tax with loss carryforward), debt
 * service, automatic overdraft, cash flow and balance sheet. Equity only
 * moves with the net income, so assets = liabilities + equity is a real
 * check of every flow booked during the turn. Then rating, covenant,
 * distress and bankruptcy.
 */
export const accountingSystem: System = {
  id: 'accounting',
  run(ctx) {
    const { draft, config, turn } = ctx;
    const F = config.finance;
    for (const company of operatingCompanies(draft)) {
      const ledger = ctx.ledger(company.id);
      const opening = company.books.current.balance;

      ledger.storage += storageCost(draft, company);
      const depreciation = depreciate(draft, company);
      const interest = interestCharge(draft, company);

      const ebitda =
        ledger.revenue -
        ledger.cogs -
        ledger.wages -
        ledger.marketing -
        ledger.rnd -
        ledger.storage -
        ledger.other;
      const ebit = ebitda - depreciation;
      const preTax = ebit - interest;
      let tax = 0;
      if (preTax > 0) {
        const used = Math.min(company.books.taxLossCarryforward, preTax);
        company.books.taxLossCarryforward -= used;
        tax = F.taxRate * (preTax - used);
      } else {
        company.books.taxLossCarryforward -= preTax;
      }
      const netIncome = preTax - tax;

      const installments = payInstallments(company, turn);
      const operating =
        ledger.revenue -
        ledger.purchases -
        ledger.wages -
        ledger.marketing -
        ledger.rnd -
        ledger.storage -
        ledger.other -
        interest -
        tax;
      const investing = ledger.disposals - ledger.capex;
      let financing = ledger.borrowed - ledger.repaid - installments;
      let cash = opening.cash + operating + investing + financing;
      // Lands exactly on 0 when the overdraft covers the shortfall (no float residue).
      const settled = Math.max(0, cash + settleOverdraft(ctx, company, cash));
      financing += settled - cash;
      cash = settled;

      const statements: Statements = {
        quarter: turn,
        pnl: {
          revenue: ledger.revenue,
          cogs: ledger.cogs,
          wages: ledger.wages,
          marketing: ledger.marketing,
          rnd: ledger.rnd,
          storage: ledger.storage,
          other: ledger.other,
          ebitda,
          depreciation,
          ebit,
          interest,
          tax,
          netIncome,
        },
        cashFlow: { operating, investing, financing, netChange: operating + investing + financing },
        balance: {
          cash,
          inventory: inventoryValue(company),
          fixedAssets: fixedAssetValue(company),
          financialAssets: 0,
          debt: totalDebt(company),
          equity: opening.equity + netIncome,
          minorityInterests: 0,
        },
      };
      company.books.current = statements;
      company.books.history.push(statements);
      const max = config.reporting.historyMaxLength;
      if (company.books.history.length > max) {
        company.books.history.splice(0, company.books.history.length - max);
      }

      // Rating and covenant on trailing (annualized) figures.
      const annual = trailingAnnual(company);
      const { balance } = statements;
      const credit = rate(config, balance.debt - balance.cash, annual.ebitda, annual.interest);
      if (credit.rating !== company.credit.rating) {
        ctx.log({
          kind: 'credit_rating',
          severity: 'info',
          companyId: company.id,
          data: { from: company.credit.rating, to: credit.rating },
        });
      }
      if (credit.covenantBreached && !company.credit.covenantBreached) {
        ctx.log({ kind: 'covenant_breached', severity: 'warning', companyId: company.id });
      }
      company.credit.rating = credit.rating;
      company.credit.covenantBreached = credit.covenantBreached;

      // Distress: negative equity while living on the overdraft.
      const onOverdraft = company.loans.some((l) => l.kind === 'overdraft');
      if (balance.equity < 0 && onOverdraft) {
        company.credit.distressQuarters += 1;
        if (company.status === 'active') {
          ctx.log({ kind: 'company_distressed', severity: 'critical', companyId: company.id });
        }
        company.status = 'distressed';
        if (company.credit.distressQuarters >= F.distressQuarters) goBankrupt(ctx, company);
      } else {
        company.credit.distressQuarters = 0;
        company.status = 'active';
      }
    }
  },
};
