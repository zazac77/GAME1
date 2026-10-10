import type { Company } from '../model/company';
import type { Loan } from '../model/finance';
import type { Id, Money } from '../model/ids';
import type { GameState } from '../model/state';
import { controlledBy } from './control';
import { sum } from './math';

/** Intra-group loans a company owes (one entry per lender and loan). */
export const groupLoansOwed = (company: Company): Loan[] =>
  company.loans.filter((l) => l.kind === 'group');

/** Intra-group debt of a company (included in its debt, not seen by the bank). */
export const groupDebt = (company: Company): Money =>
  sum(groupLoansOwed(company).map((l) => l.principal));

/** Outstanding intra-group loans granted by a company, over every borrower. */
export function groupLoansGranted(state: GameState, lenderId: Id): Money {
  let total = 0;
  for (const id of Object.keys(state.companies).sort()) {
    for (const loan of state.companies[id]?.loans ?? []) {
      if (loan.kind === 'group' && loan.lenderId === lenderId) total += loan.principal;
    }
  }
  return total;
}

/** What `borrower` owes `lender` in intra-group loans. */
export const owedTo = (borrower: Company, lenderId: Id): Money =>
  sum(groupLoansOwed(borrower).map((l) => (l.lenderId === lenderId ? l.principal : 0)));

/**
 * Head of the actor's group: its root company, if the actor controls it
 * (undefined when the root has been taken over by someone else).
 */
export function groupHeadOf(state: GameState, actorId: Id): Id | undefined {
  const root = state.actors[actorId]?.rootCompanyId;
  if (root === undefined) return undefined;
  return controlledBy(state, actorId).includes(root) ? root : undefined;
}

/**
 * Share of each member the head's shareholders own through the group:
 * e(head) = 1, e(s) = Σ over members m of (shares of s held by m / shares of
 * s) × e(m). Solved by iteration (safe with cross-holdings).
 */
export function effectiveShares(
  state: GameState,
  headId: Id,
  members: readonly Id[],
): Record<Id, number> {
  const e: Record<Id, number> = {};
  for (const id of members) e[id] = id === headId ? 1 : 0;
  for (let round = 0; round < 100; round++) {
    let change = 0;
    for (const id of members) {
      if (id === headId) continue;
      const register = state.stock.registry[id] ?? {};
      const shares = state.companies[id]?.sharesOutstanding ?? 0;
      let next = 0;
      if (shares > 0) {
        for (const m of members) {
          if (m !== id) next += ((register[m] ?? 0) / shares) * (e[m] ?? 0);
        }
      }
      change = Math.max(change, Math.abs(next - (e[id] ?? 0)));
      e[id] = next;
    }
    if (change < 1e-12) break;
  }
  return e;
}

/**
 * The company that stands for the actor's business in summaries: its root
 * company, or under a holding the operating company of its group with the
 * largest revenue last quarter (then the lowest id).
 */
export function mainCompanyOf(state: GameState, actorId: Id): Id | undefined {
  const root = state.actors[actorId]?.rootCompanyId;
  if (root === undefined || state.companies[root]?.sector !== 'holding') return root;
  let best: Company | undefined;
  for (const id of controlledBy(state, actorId)) {
    const c = state.companies[id];
    if (!c || c.sector === 'holding' || (c.status !== 'active' && c.status !== 'distressed')) {
      continue;
    }
    if (!best || c.books.current.pnl.revenue > best.books.current.pnl.revenue) best = c;
  }
  return best?.id ?? root;
}
