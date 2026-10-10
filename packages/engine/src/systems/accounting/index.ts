import type { TurnContext } from '../../core/context';
import {
  fixedAssetValue,
  inventoryValue,
  isOperating,
  operatingCompanies,
  operationalSites,
  totalDebt,
} from '../../core/companies';
import { controlledBy } from '../../core/control';
import { groupDebt, groupLoansGranted } from '../../core/group';
import { newId } from '../../core/ids';
import { sum } from '../../core/math';
import type { System } from '../../core/system';
import type { Company } from '../../model/company';
import type { Statements } from '../../model/finance';
import type { GameState } from '../../model/state';
import { plantConfigOf } from '../../sectors/config';
import { rate, trailingAnnual } from '../finance/credit';

/** Storage of stored materials and finished goods; units above the warehouses cost more. */
export function storageCost(state: GameState, company: Company): number {
  const { config } = state;
  const finishedGoodsCost = plantConfigOf(config, company.sector)?.finishedGoodsStorageCost ?? 0;
  let units = 0;
  let cost = 0;
  for (const [itemId, lot] of Object.entries(company.inventory)) {
    if (lot.qty <= 0) continue;
    const commodity = config.commodities.markets[itemId];
    units += lot.qty;
    cost += lot.qty * (commodity ? commodity.storageCostPerUnit : finishedGoodsCost);
  }
  const capacity = sum(operationalSites(company).map((s) => s.warehouseCapacity));
  const overflowShare = units > capacity && units > 0 ? (units - capacity) / units : 0;
  const multiplier = 1 + (config.commodities.overflowStorageMultiplier - 1) * overflowShare;
  return cost * multiplier * state.macro.priceLevel;
}

/**
 * Straight-line depreciation of the assets in service (buildings of
 * operational sites, lines not under construction); returns the charge.
 */
export function depreciate(company: Company): number {
  let charge = 0;
  for (const site of Object.values(company.sites)) {
    if (site.status !== 'operational') continue;
    // Farmland (landValue) is not depreciated.
    const building = Math.max(
      0,
      Math.min(site.buildingBookValue - (site.landValue ?? 0), site.buildingDepreciationPerQuarter),
    );
    site.buildingBookValue -= building;
    charge += building;
    for (const line of Object.values(site.lines)) {
      if (line.status === 'under_construction') continue;
      const d = Math.min(line.bookValue, line.depreciationPerQuarter);
      line.bookValue -= d;
      charge += d;
    }
  }
  return charge;
}

/** Bank interest of the quarter on the loans outstanding after the start-of-quarter financing. */
export function interestCharge(state: GameState, company: Company): number {
  const { policyRate } = state.macro;
  const penalty = company.credit.covenantBreached ? state.config.finance.covenant.spreadPenalty : 0;
  return sum(
    company.loans.map((l) =>
      l.kind === 'group'
        ? 0
        : (l.principal * Math.max(0, policyRate + l.spread + (l.kind === 'term' ? penalty : 0))) /
          4,
    ),
  );
}

/** Interest of the quarter on an intra-group loan (paid by the borrower to the lender). */
export const groupLoanInterest = (state: GameState, principal: number, spread: number): number =>
  (principal * Math.max(0, state.macro.policyRate + spread)) / 4;

/**
 * Net intra-group interest of a company this quarter: paid on what it owes,
 * less what it receives on what it lent (to operating companies).
 */
export function netGroupInterest(state: GameState, company: Company): number {
  let net = 0;
  for (const id of Object.keys(state.companies).sort()) {
    const other = state.companies[id] as Company;
    if (!isOperating(other)) continue;
    for (const loan of other.loans) {
      if (loan.kind !== 'group') continue;
      const lender = state.companies[loan.lenderId ?? ''];
      if (!lender || !isOperating(lender)) continue;
      const interest = groupLoanInterest(state, loan.principal, loan.spread);
      if (other.id === company.id) net += interest;
      if (lender.id === company.id) net -= interest;
    }
  }
  return net;
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
  // Liquidation: staff go back to their pools, contracts lapse, subscribers leave.
  company.workforce = {};
  company.contracts = [];
  for (const line of Object.values(company.productLines)) {
    if (line.users !== undefined) line.users = 0;
  }
  ctx.log({ kind: 'company_bankrupt', severity: 'critical', companyId: company.id });
  const player = draft.actors[draft.meta.playerActorId];
  const root = draft.companies[player?.rootCompanyId ?? ''];
  // The player loses with its root company, or with the last operating company under its holding.
  const lost =
    root?.id === company.id ||
    (root?.sector === 'holding' &&
      company.sector !== 'holding' &&
      !controlledBy(draft, player?.id ?? '').some((id) => {
        const c = draft.companies[id];
        return c !== undefined && c.sector !== 'holding' && isOperating(c);
      }));
  if (lost && draft.meta.mode === 'standard' && config.victory.bankruptcyEndsGame) {
    draft.meta.status = 'lost';
    ctx.log({ kind: 'game_lost', severity: 'critical', companyId: company.id });
  }
}

/**
 * Step 10: closes the quarter of every operating company. Income statement
 * (storage, depreciation, interest, tax with loss carryforward), debt
 * service, automatic overdraft, cash flow and balance sheet. Equity only
 * moves with the net income and the equity transactions (issues, dividends,
 * buybacks), so assets = liabilities + equity is a real check of every flow
 * booked during the turn. Then rating, covenant,
 * distress and bankruptcy.
 */
export const accountingSystem: System = {
  id: 'accounting',
  run(ctx) {
    const { draft, config, turn } = ctx;
    const F = config.finance;
    const companies = operatingCompanies(draft);
    // Intra-group interest, on the loans outstanding before any company closes.
    for (const company of companies) {
      ctx.ledger(company.id).groupInterest += netGroupInterest(draft, company);
    }
    for (const company of companies) {
      const ledger = ctx.ledger(company.id);
      const opening = company.books.current.balance;

      ledger.storage += storageCost(draft, company);
      // Book value lost on disposals is charged with depreciation.
      const depreciation = depreciate(company) + ledger.writeOffs;
      const interest = interestCharge(draft, company) + ledger.groupInterest;

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
      // Dividends received are untaxed (participation exemption).
      const netIncome = preTax - tax + ledger.dividendsReceived;

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
      const investing = ledger.disposals - ledger.capex + ledger.dividendsReceived;
      let financing =
        ledger.borrowed -
        ledger.repaid -
        installments +
        ledger.equityIssued -
        ledger.dividendsPaid -
        ledger.buybacks;
      let cash = opening.cash + operating + investing + financing;
      // Lands exactly on 0 when the overdraft covers the shortfall (no float residue).
      const settled = Math.max(0, cash + settleOverdraft(ctx, company, cash));
      financing += settled - cash;
      cash = settled;

      const statements: Statements = {
        quarter: turn,
        shares: company.sharesOutstanding,
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
          financial: ledger.dividendsReceived, // + fair value of financial assets: stock market step
          groupFinancial: ledger.groupDividends,
          tax,
          netIncome,
        },
        cashFlow: {
          operating,
          investing,
          financing,
          netChange: operating + investing + financing,
          groupInvesting: ledger.groupDividends,
        },
        balance: {
          cash,
          inventory: inventoryValue(company),
          fixedAssets: fixedAssetValue(company),
          financialAssets: opening.financialAssets, // revalued by the stock market step
          groupLoans: groupLoansGranted(draft, company.id),
          debt: totalDebt(company),
          // Equity moves with the net income and the equity transactions only.
          equity:
            opening.equity +
            netIncome +
            ledger.equityIssued -
            ledger.dividendsPaid -
            ledger.buybacks,
          minorityInterests: 0,
        },
      };
      company.books.current = statements;
      company.books.history.push(statements);
      const max = config.reporting.historyMaxLength;
      if (company.books.history.length > max) {
        company.books.history.splice(0, company.books.history.length - max);
      }

      // Rating and covenant on trailing (annualized) figures; the bank ignores intra-group debt.
      const annual = trailingAnnual(company);
      const { balance } = statements;
      const credit = rate(
        config,
        balance.debt - groupDebt(company) - balance.cash,
        annual.ebitda,
        annual.interest,
      );
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
