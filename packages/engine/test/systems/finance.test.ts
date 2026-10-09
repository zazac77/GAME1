import { describe, expect, it } from 'vitest';
import type { Company } from '../../src';
import { sum } from '../../src/core/math';
import { emptyDecisions } from '../../src/systems/validation';
import { newGame, playerCompanyId, resolveAll, steadyAll } from '../helpers';

const balanceGap = (c: Company) => {
  const b = c.books.current.balance;
  return (
    b.cash +
    b.inventory +
    b.fixedAssets +
    b.financialAssets -
    (b.debt + b.equity + b.minorityInterests)
  );
};

describe('debt, overdraft and bankruptcy', () => {
  it('borrows at the start of the quarter and repays voluntarily', () => {
    const state = newGame(12);
    const id = playerCompanyId(state);
    const d = emptyDecisions(id);
    d.finance.borrow = 500_000;
    const { state: next, ctx } = resolveAll(state, [d]);
    const c = next.companies[id] as Company;
    expect(c.loans.filter((l) => l.kind === 'term')).toHaveLength(2);
    expect(ctx.ledger(id).borrowed).toBe(500_000);
    expect(c.books.current.cashFlow.financing).toBeLessThan(500_000); // minus installments

    const r = emptyDecisions(id);
    r.finance.repay = 1_000_000;
    const debt = sum(c.loans.map((l) => l.principal));
    const after = resolveAll(next, [r]).state.companies[id] as Company;
    expect(sum(after.loans.map((l) => l.principal))).toBeLessThan(debt - 1_000_000);
  });

  it('draws an overdraft when cash runs out and repays it when cash comes back', () => {
    const state = newGame(12);
    const id = playerCompanyId(state);
    const c = state.companies[id] as Company;
    // Little cash (equity follows) and nothing to sell or produce.
    c.books.current.balance.cash = 100_000;
    c.books.current.balance.equity -= 5_900_000;
    c.inventory = {};
    c.books.current.balance.equity -= c.books.current.balance.inventory;
    c.books.current.balance.inventory = 0;
    const { state: next, report } = resolveAll(state, []);
    const after = next.companies[id] as Company;
    const overdraft = after.loans.find((l) => l.kind === 'overdraft');
    expect(after.books.current.balance.cash).toBe(0);
    expect(overdraft?.principal).toBeGreaterThan(0);
    expect(overdraft?.spread).toBe(state.config.finance.overdraftSpread);
    expect(report.events.map((e) => e.kind)).toContain('overdraft');
    expect(Math.abs(balanceGap(after))).toBeLessThan(1e-3);

    // Cash injected back (as if from sales): the overdraft is repaid first.
    after.books.current.balance.cash = 50_000_000;
    after.books.current.balance.equity += 50_000_000;
    const back = resolveAll(next, steadyAll(next)).state.companies[id] as Company;
    expect(back.loans.find((l) => l.kind === 'overdraft')).toBeUndefined();
  });

  it('rates the company and flags a covenant breach', () => {
    const state = newGame(12);
    const id = playerCompanyId(state);
    const c = state.companies[id] as Company;
    c.books.current.balance.cash = 0;
    c.books.current.balance.equity -= 6_000_000;
    // Losses: nothing to sell, nothing produced.
    c.inventory = {};
    c.books.current.balance.equity -= c.books.current.balance.inventory;
    c.books.current.balance.inventory = 0;
    const { state: next, report } = resolveAll(state, []);
    const after = next.companies[id] as Company;
    expect(after.credit.rating).toBe('CCC');
    expect(after.credit.covenantBreached).toBe(true);
    expect(report.events.map((e) => e.kind)).toContain('covenant_breached');
    const d = emptyDecisions(id);
    d.finance.borrow = 1_000_000;
    expect(resolveAll(next, [d]).report.issues.map((i) => i.code)).toContain('clamped');
  });

  const ruin = (mode: 'standard' | 'sandbox') => {
    const state = newGame(12, undefined, { mode });
    const id = playerCompanyId(state);
    const c = state.companies[id] as Company;
    c.books.current.balance.cash = 0;
    c.books.current.balance.equity = -30_000_000;
    c.inventory = {};
    let s = state;
    const kinds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = resolveAll(s, []);
      s = r.state;
      kinds.push(...r.report.events.filter((e) => e.companyId === id).map((e) => e.kind));
    }
    return { s, id, kinds };
  };

  it('goes bankrupt after distressQuarters of negative equity on overdraft: the player loses', () => {
    const { s, id, kinds } = ruin('standard');
    const c = s.companies[id] as Company;
    expect(c.status).toBe('bankrupt');
    expect(c.credit.distressQuarters).toBe(3);
    expect(kinds).toEqual(
      expect.arrayContaining(['company_distressed', 'company_bankrupt', 'game_lost']),
    );
    expect(s.meta.status).toBe('lost');
    // Staff go back to the labor market.
    expect(c.workforce).toEqual({});
  });

  it('keeps a sandbox game running after a bankruptcy, the company frozen', () => {
    const { s, id } = ruin('sandbox');
    expect(s.meta.status).toBe('running');
    const frozen = s.companies[id] as Company;
    expect(frozen.status).toBe('bankrupt');
    const next = resolveAll(s, steadyAll(s)).state;
    expect(next.companies[id]?.books).toEqual(frozen.books);
    const line = Object.keys(frozen.productLines)[0] ?? '';
    expect(next.productMarkets.mkt_appliances?.lastResult.shares[line]).toBeUndefined();
  });
});
