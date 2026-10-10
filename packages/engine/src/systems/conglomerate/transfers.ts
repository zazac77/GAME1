import type { TurnContext } from '../../core/context';
import { isOperating } from '../../core/companies';
import { controlledBy, sameGroup } from '../../core/control';
import { newId } from '../../core/ids';
import type { Company } from '../../model/company';
import type { IntraGroupTransfer } from '../../model/decisions';
import type { Id, Money } from '../../model/ids';
import { maxDividend } from '../finance/equity';
import { shareValue, type StakeTrades } from '../stockmarket/holdings';
import { book, closedStatements } from './booking';

/** Stakes traded during the step, by company then by target. */
export type GroupTrades = Record<Id, Record<Id, StakeTrades>>;

const tradeOf = (trades: GroupTrades, companyId: Id, targetId: Id): StakeTrades =>
  ((trades[companyId] ??= {})[targetId] ??= { bought: 0, sold: 0 });

/** Cash a company has left in this step (its closing cash). */
export const cashOf = (company: Company, turn: number): Money =>
  Math.max(0, closedStatements(company, turn)?.balance.cash ?? 0);

/** Whether a company can take part in a transfer this step (operating and closed this turn). */
const live = (company: Company | undefined, turn: number): company is Company =>
  company !== undefined && isOperating(company) && closedStatements(company, turn) !== undefined;

/**
 * Intra-group loan of `amount` from `from` to `to`: repays first what `from`
 * owes `to`, then lends the rest (one loan per lender and borrower). With
 * cash, the amount is bounded by the lender's cash; without (the price of a
 * stake), only the claims move.
 */
export function lend(
  ctx: TurnContext,
  from: Company,
  to: Company,
  amount: Money,
  withCash = true,
): { repaid: Money; lent: Money } {
  const { draft, config, turn } = ctx;
  const total = Math.max(0, withCash ? Math.min(amount, cashOf(from, turn)) : amount);
  if (total <= 0) return { repaid: 0, lent: 0 };
  let repaid = 0;
  for (const loan of from.loans) {
    if (loan.kind !== 'group' || loan.lenderId !== to.id || repaid >= total) continue;
    const paid = Math.min(loan.principal, total - repaid);
    loan.principal -= paid;
    repaid += paid;
  }
  from.loans = from.loans.filter((l) => l.kind !== 'group' || l.principal > 1e-6);
  const lent = total - repaid;
  if (lent > 0) {
    const loan = to.loans.find((l) => l.kind === 'group' && l.lenderId === from.id);
    if (loan) loan.principal += lent;
    else {
      to.loans.push({
        id: newId(draft.meta, 'loan'),
        kind: 'group',
        principal: lent,
        spread: config.conglomerate.groupLoanSpread,
        maturity: turn,
        lenderId: from.id,
      });
    }
  }
  const cash = withCash ? total : 0;
  book(from, turn, {
    cash: -cash,
    debt: -repaid,
    groupLoans: lent,
    financing: withCash ? -repaid : 0,
    investing: withCash ? -lent : 0,
    groupInvesting: withCash ? -lent : 0,
  });
  book(to, turn, {
    cash,
    debt: lent,
    groupLoans: -repaid,
    financing: withCash ? lent : 0,
    investing: withCash ? repaid : 0,
    groupInvesting: withCash ? repaid : 0,
  });
  return { repaid, lent };
}

/**
 * Dividend of `payer` declared by its parent: within its closing cash and
 * equity (none while distressed or in breach of covenant), paid pro rata to
 * the registry; companies of the group book it as an intra-group financial
 * result. A listed payer's price drops by the dividend per share.
 */
function payDividend(ctx: TurnContext, payer: Company, amount: Money): void {
  const { draft, turn } = ctx;
  const SM = draft.config.stockMarket;
  if (payer.status === 'distressed' || payer.credit.covenantBreached) return;
  const N = payer.sharesOutstanding;
  const D = Math.min(amount, maxDividend(payer), cashOf(payer, turn));
  if (D <= 0 || N <= 0) return;
  book(payer, turn, { cash: -D, equity: -D, financing: -D });
  const register = draft.stock.registry[payer.id] ?? {};
  for (const holderId of Object.keys(register).sort()) {
    const holder = draft.companies[holderId];
    const received = (D * (register[holderId] ?? 0)) / N;
    if (!live(holder, turn) || received <= 0) continue;
    const inGroup = sameGroup(draft, payer.id, holderId);
    book(holder, turn, {
      cash: received,
      financial: received,
      groupFinancial: inGroup ? received : 0,
      investing: received,
      groupInvesting: inGroup ? received : 0,
    });
  }
  const quote = draft.stock.quotes[payer.id];
  if (quote && payer.listed) {
    const perShare = D / N;
    quote.price = Math.max(SM.minPrice, quote.price - perShare);
    quote.referencePrice = quote.price;
    if (quote.history.length > 0) quote.history[quote.history.length - 1] = quote.price;
  }
  ctx.log({
    kind: 'dividend_paid',
    severity: 'info',
    companyId: payer.id,
    data: { amount: D, perShare: D / N, group: true },
  });
}

/**
 * Restructuring: `from` sells shares of `target` to `to` at their value,
 * paid by an intra-group loan (to owes from). Never to a company the target
 * controls (the chain of control would loop).
 */
function transferStake(
  ctx: TurnContext,
  from: Company,
  to: Company,
  target: Company,
  wanted: number | undefined,
  trades: GroupTrades,
): void {
  const { draft } = ctx;
  if (to.id === target.id || controlledBy(draft, target.id).includes(to.id)) return;
  const register = draft.stock.registry[target.id] ?? {};
  const held = register[from.id] ?? 0;
  const shares = Math.min(held, wanted ?? held);
  if (shares <= 0) return;
  const value = shares * shareValue(draft, target);
  const next = Object.fromEntries(Object.entries(register).filter(([h]) => h !== from.id));
  if (held > shares) next[from.id] = held - shares;
  next[to.id] = (next[to.id] ?? 0) + shares;
  draft.stock.registry[target.id] = next;
  lend(ctx, from, to, value, false);
  tradeOf(trades, from.id, target.id).sold += value;
  tradeOf(trades, to.id, target.id).bought += value;
  ctx.log({
    kind: 'stake_transferred',
    severity: 'info',
    companyId: from.id,
    data: { toId: to.id, targetId: target.id, shares, value },
  });
}

/** Settles one intra-group transfer (validated at the start of the quarter). */
export function settleTransfer(
  ctx: TurnContext,
  transfer: IntraGroupTransfer,
  trades: GroupTrades,
): void {
  const { draft, turn } = ctx;
  const from = draft.companies[transfer.fromId];
  const to = draft.companies[transfer.toId];
  if (!live(from, turn) || !live(to, turn)) return;
  switch (transfer.kind) {
    case 'dividend':
      if (sameGroup(draft, from.id, to.id)) payDividend(ctx, from, transfer.amount);
      return;
    case 'loan': {
      // Outside the group, only what is owed can be repaid.
      const owed = from.loans
        .filter((l) => l.kind === 'group' && l.lenderId === to.id)
        .reduce((s, l) => s + l.principal, 0);
      const amount = sameGroup(draft, from.id, to.id)
        ? transfer.amount
        : Math.min(transfer.amount, owed);
      const done = lend(ctx, from, to, amount);
      if (done.repaid + done.lent > 0) logLoan(ctx, from.id, to.id, done);
      return;
    }
    case 'cash_pool': {
      if (!sameGroup(draft, from.id, to.id)) return;
      const excess = cashOf(from, turn) - Math.max(0, transfer.amount);
      const done =
        excess > 0
          ? lend(ctx, from, to, excess)
          : lend(ctx, to, from, Math.min(-excess, cashOf(to, turn)));
      if (done.repaid + done.lent > 0) {
        if (excess > 0) logLoan(ctx, from.id, to.id, done, true);
        else logLoan(ctx, to.id, from.id, done, true);
      }
      return;
    }
    case 'stake': {
      const target = draft.companies[transfer.targetId];
      if (!target || !sameGroup(draft, from.id, to.id) || !sameGroup(draft, from.id, target.id)) {
        return;
      }
      transferStake(ctx, from, to, target, transfer.shares, trades);
      return;
    }
  }
}

function logLoan(
  ctx: TurnContext,
  fromId: Id,
  toId: Id,
  done: { repaid: Money; lent: Money },
  pool = false,
): void {
  ctx.log({
    kind: 'group_loan',
    severity: 'info',
    companyId: fromId,
    data: { toId, repaid: done.repaid, lent: done.lent, pool },
  });
}

/**
 * Intra-group loans with a party that no longer operates are cancelled: the
 * lender writes its claim off, a surviving borrower is released from its
 * debt (both as intra-group financial results).
 */
export function cancelDeadLoans(ctx: TurnContext): void {
  const { draft, turn } = ctx;
  for (const id of Object.keys(draft.companies).sort()) {
    const borrower = draft.companies[id] as Company;
    for (const loan of borrower.loans) {
      if (loan.kind !== 'group') continue;
      const lender = draft.companies[loan.lenderId ?? ''];
      if (isOperating(borrower) && lender && isOperating(lender)) continue;
      const p = loan.principal;
      if (lender) {
        book(lender, turn, { groupLoans: -p, financial: -p, groupFinancial: -p });
      }
      book(borrower, turn, { debt: -p, financial: p, groupFinancial: p });
      loan.principal = 0;
      ctx.log({
        kind: 'group_loan_written_off',
        severity: 'warning',
        companyId: lender?.id ?? borrower.id,
        data: { borrowerId: borrower.id, amount: p },
      });
    }
    borrower.loans = borrower.loans.filter((l) => l.kind !== 'group' || l.principal > 0);
  }
}
