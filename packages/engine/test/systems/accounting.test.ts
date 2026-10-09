import { describe, expect, it } from 'vitest';
import type { Company, GameState } from '../../src';
import { fixedAssetValue } from '../../src/core/companies';
import { sum } from '../../src/core/math';
import { emptyDecisions } from '../../src/systems/validation';
import { mainProductLine } from '../../src/sectors/industry';
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

const quarter = (state: GameState) => resolveAll(state, steadyAll(state));

describe('accounting', () => {
  it('closes balanced statements: assets = liabilities + equity, cash moves with the flows', () => {
    const state = newGame(12);
    const { state: next } = quarter(state);
    for (const c of Object.values(next.companies)) {
      const prev = state.companies[c.id]?.books.current;
      const { pnl, cashFlow, balance } = c.books.current;
      expect(Math.abs(balanceGap(c))).toBeLessThan(1e-6 * balance.equity);
      expect(balance.cash - (prev?.balance.cash ?? 0)).toBeCloseTo(cashFlow.netChange, 4);
      expect(cashFlow.netChange).toBeCloseTo(
        cashFlow.operating + cashFlow.investing + cashFlow.financing,
        4,
      );
      expect(balance.equity - (prev?.balance.equity ?? 0)).toBeCloseTo(pnl.netIncome, 4);
      expect(pnl.ebitda).toBeCloseTo(
        pnl.revenue - pnl.cogs - pnl.wages - pnl.marketing - pnl.rnd - pnl.storage - pnl.other,
        4,
      );
      expect(pnl.netIncome).toBeCloseTo(pnl.ebitda - pnl.depreciation - pnl.interest - pnl.tax, 4);
      expect(c.books.history.at(-1)).toEqual(c.books.current);
      expect(c.books.current.quarter).toBe(0);
    }
  });

  it('depreciates sites and lines straight-line', () => {
    const state = newGame(12);
    const id = playerCompanyId(state);
    const before = fixedAssetValue(state.companies[id] as Company);
    const { state: next } = quarter(state);
    const c = next.companies[id] as Company;
    const cfg = state.config.sectors.industry;
    const region = state.regions[c.hqRegionId];
    const expected =
      5 * (cfg.line.buildCost / cfg.line.depreciationQuarters) +
      (cfg.factory.buildCost * (region?.landCostIndex ?? 1)) / cfg.factory.depreciationQuarters;
    expect(c.books.current.pnl.depreciation).toBeCloseTo(expected, 6);
    expect(c.books.current.balance.fixedAssets).toBeCloseTo(before - expected, 6);
  });

  it('taxes profits after using carried-forward losses', () => {
    const state = newGame(12);
    const id = playerCompanyId(state);
    const c = state.companies[id] as Company;
    c.books.taxLossCarryforward = 1e12;
    const { state: next } = quarter(state);
    const after = next.companies[id] as Company;
    const pnl = after.books.current.pnl;
    expect(pnl.tax).toBe(0);
    // A profit uses the carryforward, a loss adds to it: both move it by −preTax.
    const preTax = pnl.ebit - pnl.interest;
    expect(after.books.taxLossCarryforward).toBeCloseTo(1e12 - preTax, 0);

    const fresh = newGame(12);
    const { state: taxed } = quarter(fresh);
    for (const co of Object.values(taxed.companies)) {
      const p = co.books.current.pnl;
      const base = p.ebit - p.interest;
      if (base > 0) expect(p.tax).toBeCloseTo(0.25 * base, 4);
      else {
        expect(p.tax).toBe(0);
        expect(co.books.taxLossCarryforward).toBeCloseTo(-base, 4);
      }
    }
  });

  it('pays interest on loans and the scheduled installments of term debt', () => {
    const state = newGame(12);
    const id = playerCompanyId(state);
    const loan = state.companies[id]?.loans[0];
    if (!loan) throw new Error('no loan');
    const { state: next } = quarter(state);
    const c = next.companies[id] as Company;
    const rate = next.macro.policyRate + loan.spread;
    expect(c.books.current.pnl.interest).toBeCloseTo((loan.principal * rate) / 4, 4);
    const term = c.loans.find((l) => l.id === loan.id);
    expect(term?.principal).toBeCloseTo(loan.principal * (1 - 1 / loan.maturity), 4);
    expect(c.books.current.balance.debt).toBeCloseTo(sum(c.loans.map((l) => l.principal)), 6);
  });

  it('books storage, more expensive above the warehouse capacity', () => {
    const state = newGame(12);
    const id = playerCompanyId(state);
    const crowded = structuredClone(state);
    const c = crowded.companies[id] as Company;
    const line = mainProductLine(crowded, c);
    if (!line) throw new Error('no line');
    c.inventory[line.id] = { qty: 200_000, avgCost: 100 }; // far above 60 000
    const noSales = emptyDecisions(id);
    noSales.pricing[line.id] = { price: line.price * 5 };
    const r = resolveAll(crowded, [noSales]);
    const storage = r.state.companies[id]?.books.current.pnl.storage ?? 0;
    const fg = r.state.companies[id]?.inventory[line.id]?.qty ?? 0;
    expect(storage).toBeGreaterThan(
      fg * state.config.sectors.industry.finishedGoodsStorageCost * 1.5,
    );
  });
});
