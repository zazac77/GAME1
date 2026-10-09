import { describe, expect, it } from 'vitest';
import type { Company } from '../../src';
import { sum } from '../../src/core/math';
import { emptyDecisions, normalizeDecisions } from '../../src/systems/validation';
import { LOW_DEBT, newGame, playerCompanyId, resolveAll, steadyAll } from '../helpers';

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
    const state = newGame(12, LOW_DEBT);
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
    c.books.current.balance.equity -= c.books.current.balance.cash - 100_000;
    c.books.current.balance.cash = 100_000;
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

describe('equity transactions (stock market v2)', () => {
  const setup = () => {
    const state = newGame(21, LOW_DEBT);
    const id = playerCompanyId(state);
    return { state, id, company: state.companies[id] as Company };
  };

  it('pays dividends pro rata: companies holding shares book theirs, the price drops', () => {
    const { state, id, company } = setup();
    // An AI company holds 100 000 shares of the player.
    const holderId = Object.keys(state.companies).find((c) => c !== id) ?? '';
    const register = state.stock.registry[id] ?? {};
    const price = state.stock.quotes[id]?.price ?? 0;
    register.public = (register.public ?? 0) - 100_000;
    register[holderId] = 100_000;
    const hb = (state.companies[holderId] as Company).books.current.balance;
    hb.financialAssets += 100_000 * price;
    hb.equity += 100_000 * price;

    const d = emptyDecisions(id);
    d.finance.dividend = 1_000_000;
    const N = company.sharesOutstanding;
    const mid = resolveAll(state, [d], { until: 'financePre' });
    expect(mid.state.stock.quotes[id]?.price).toBeCloseTo(price - 1_000_000 / N, 9);
    expect(mid.ctx.ledger(holderId).dividendsReceived).toBeCloseTo((1_000_000 * 100_000) / N, 6);

    const { state: next, ctx } = resolveAll(state, [d]);
    const c = next.companies[id] as Company;
    expect(ctx.ledger(id).dividendsPaid).toBe(1_000_000);
    const opening = company.books.current.balance.equity;
    expect(c.books.current.balance.equity).toBeCloseTo(
      opening + c.books.current.pnl.netIncome - 1_000_000,
      3,
    );
    const holder = next.companies[holderId] as Company;
    expect(holder.books.current.pnl.financial).not.toBe(0);
    for (const x of [c, holder]) expect(Math.abs(balanceGap(x))).toBeLessThan(1e-3);
    expect(next.log.some((e) => e.kind === 'dividend_paid' && e.companyId === id)).toBe(true);
  });

  it('forbids dividends beyond the cash or while distressed', () => {
    const { state, id, company } = setup();
    const d = { ...emptyDecisions(id), finance: { dividend: 1e12 } };
    const { decisions } = normalizeDecisions(state, company, d);
    expect(decisions.finance.dividend).toBeCloseTo(
      Math.min(company.books.current.balance.cash, company.books.current.balance.equity),
      3,
    );
    company.status = 'distressed';
    const refused = normalizeDecisions(state, company, d);
    expect(refused.decisions.finance.dividend).toBeUndefined();
    expect(refused.issues.map((i) => i.code)).toContain('invalid_state');
  });

  it('issues new shares at a discount, never so many that the founder loses control', () => {
    const { state, id, company } = setup();
    const N = company.sharesOutstanding;
    const { decisions } = normalizeDecisions(state, company, {
      ...emptyDecisions(id),
      finance: { issueShares: N },
    });
    // The founder holds 60 %: below 0.6 / 0.5 − 1 = 20 % of new shares.
    expect(decisions.finance.issueShares).toBe(0.2 * N - 1);
    const d = { ...emptyDecisions(id), finance: { issueShares: 100_000 } };
    const ref = state.stock.quotes[id]?.referencePrice ?? 0;
    const { state: next, ctx } = resolveAll(state, [d]);
    const SM = state.config.stockMarket.capital;
    expect(ctx.ledger(id).equityIssued).toBeCloseTo(
      100_000 * ref * (1 - SM.issueDiscount) * (1 - SM.issueFeeShare),
      3,
    );
    const c = next.companies[id] as Company;
    expect(c.sharesOutstanding).toBe(N + 100_000);
    expect(next.stock.registry[id]?.public).toBe((state.stock.registry[id]?.public ?? 0) + 100_000);
    expect(c.books.current.shares).toBe(N + 100_000);
    expect(Math.abs(balanceGap(c))).toBeLessThan(1e-3);
  });

  it('buys back shares from the float and cancels them; not with an issue', () => {
    const { state, id, company } = setup();
    const N = company.sharesOutstanding;
    const float = state.stock.registry[id]?.public ?? 0;
    const { decisions } = normalizeDecisions(state, company, {
      ...emptyDecisions(id),
      finance: { buyback: N },
    });
    // At most 10 % of the float in a quarter (below 5 % of the capital here).
    expect(decisions.finance.buyback).toBe(Math.floor(0.1 * float));
    const both = normalizeDecisions(state, company, {
      ...emptyDecisions(id),
      finance: { issueShares: 1000, buyback: 1000 },
    });
    expect(both.decisions.finance.buyback).toBeUndefined();
    expect(both.issues.map((i) => i.code)).toContain('duplicate');

    const { state: next, ctx } = resolveAll(state, [
      { ...emptyDecisions(id), finance: { buyback: 50_000 } },
    ]);
    const c = next.companies[id] as Company;
    expect(c.sharesOutstanding).toBe(N - 50_000);
    expect(next.stock.registry[id]?.public).toBe(float - 50_000);
    expect(ctx.ledger(id).buybacks).toBeGreaterThan(0);
    expect(Math.abs(balanceGap(c))).toBeLessThan(1e-3);
  });
});
