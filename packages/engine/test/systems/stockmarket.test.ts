import { describe, expect, it } from 'vitest';
import type { Company, CompanyDecisions, GameState } from '../../src';
import { sum } from '../../src/core/math';
import { fundamentalValue, publishedStatements } from '../../src/systems/stockmarket';
import { emptyDecisions, normalizeDecisions } from '../../src/systems/validation';
import { newGame, playSteady, playerCompanyId, resolveAll, steadyAll } from '../helpers';

const setup = () => {
  const state = playSteady(newGame(5, { scenario: { initialJitter: 0 } }), 6);
  const id = playerCompanyId(state);
  const target = Object.keys(state.companies).find((c) => c !== id) ?? '';
  return { state, id, target };
};

/** Steady decisions for everyone, plus stock orders for the player. */
const withOrders = (state: GameState, id: string, orders: CompanyDecisions['stockOrders']) =>
  steadyAll(state).map((d) => (d.companyId === id ? { ...d, stockOrders: orders } : d));

const held = (s: GameState, target: string, holder: string) =>
  s.stock.registry[target]?.[holder] ?? 0;

describe('fundamental value', () => {
  it('only uses published quarters and grows with EBITDA, falls with rates', () => {
    const { state, target } = setup();
    const company = state.companies[target] as Company;
    const lastClosed = state.meta.turn - 1;
    const published = publishedStatements(state, company, lastClosed);
    expect(published.at(-1)?.quarter).toBe(
      lastClosed - state.config.stockMarket.publicationLagQuarters,
    );
    expect(fundamentalValue(state, company, [])).toBeUndefined();

    const base = fundamentalValue(state, company, published) ?? 0;
    const richer = structuredClone(published);
    for (const s of richer) {
      s.pnl.ebitda *= 1.5;
      s.pnl.revenue *= 1.01;
    }
    expect(fundamentalValue(state, company, richer) ?? 0).toBeGreaterThan(base);
    const tight = structuredClone(state);
    tight.macro.policyRate += 0.03;
    expect(fundamentalValue(tight, company, published) ?? 0).toBeLessThan(base);
  });

  it('never falls below the liquidation value', () => {
    const { state, target } = setup();
    const company = state.companies[target] as Company;
    const published = structuredClone(publishedStatements(state, company, state.meta.turn - 1));
    for (const s of published) {
      s.pnl.ebitda = -1e7;
      s.pnl.revenue = 1;
    }
    const b = published.at(-1)?.balance;
    const cfg = state.config;
    const liquidation =
      ((b?.cash ?? 0) +
        (b?.inventory ?? 0) * cfg.stockMarket.fundamental.inventoryLiquidationShare +
        (b?.fixedAssets ?? 0) * (1 - cfg.sectors.industry.assetResaleDiscount) -
        (b?.debt ?? 0)) /
      company.sharesOutstanding;
    expect(fundamentalValue(state, company, published)).toBeCloseTo(
      Math.max(cfg.stockMarket.minPrice, liquidation),
      9,
    );
  });
});

describe('stock market', () => {
  it('executes a buy order at the new price: registry, cash, financial assets, impact', () => {
    const { state, id, target } = setup();
    const shares = 50_000;
    const calm = resolveAll(state, withOrders(state, id, [])).state;
    const { state: next, report } = resolveAll(
      state,
      withOrders(state, id, [{ targetId: target, side: 'buy', shares }]),
    );
    const price = next.stock.quotes[target]?.price ?? 0;
    expect(held(next, target, id)).toBe(shares);
    expect(next.stock.registry[target]?.public).toBe(
      (state.stock.registry[target]?.public ?? 0) - shares,
    );
    // Net buying pushes the price up (same seed, same noise).
    expect(price).toBeGreaterThan(calm.stock.quotes[target]?.price ?? 0);
    const books = next.companies[id]?.books.current;
    expect(books?.balance.financialAssets).toBeCloseTo(shares * price, 6);
    const calmCash = calm.companies[id]?.books.current.balance.cash ?? 0;
    expect(books?.balance.cash).toBeCloseTo(calmCash - shares * price, 4);
    expect(books?.pnl.financial).toBeCloseTo(0, 6); // bought at the closing price
    expect(report.events.some((e) => e.kind === 'stock_trade')).toBe(true);
    for (const [companyId, register] of Object.entries(next.stock.registry)) {
      expect(sum(Object.values(register))).toBe(next.companies[companyId]?.sharesOutstanding);
    }
  });

  it('revalues holdings at fair value through the financial result, then sells', () => {
    const { state, id, target } = setup();
    const s1 = resolveAll(
      state,
      withOrders(state, id, [{ targetId: target, side: 'buy', shares: 40_000 }]),
    ).state;
    const p1 = s1.stock.quotes[target]?.price ?? 0;
    const s2 = resolveAll(s1, withOrders(s1, id, [])).state;
    const p2 = s2.stock.quotes[target]?.price ?? 0;
    const b2 = s2.companies[id]?.books.current;
    expect(b2?.pnl.financial).toBeCloseTo(40_000 * (p2 - p1), 4);
    expect(b2?.balance.financialAssets).toBeCloseTo(40_000 * p2, 4);
    const s3 = resolveAll(
      s2,
      withOrders(s2, id, [{ targetId: target, side: 'sell', shares: 40_000 }]),
    ).state;
    expect(held(s3, target, id)).toBe(0);
    expect(s3.companies[id]?.books.current.balance.financialAssets).toBe(0);
  });

  it('caps orders by liquidity, minority stake, holdings and cash', () => {
    const { state, id, target } = setup();
    const company = state.companies[id] as Company;
    const float = state.stock.registry[target]?.public ?? 0;
    const d = emptyDecisions(id);
    d.stockOrders = [
      { targetId: target, side: 'buy', shares: 1e9 },
      { targetId: id, side: 'buy', shares: 10 }, // own shares: buyback, phase 2
    ];
    company.books.current.balance.cash = 1e12;
    const { decisions, issues } = normalizeDecisions(state, company, d);
    const max = Math.floor(state.config.stockMarket.maxFloatPerQuarter * float);
    expect(decisions.stockOrders).toEqual([{ targetId: target, side: 'buy', shares: max }]);
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual([
      'stockOrders[0].shares:clamped',
      'stockOrders[1]:invalid_value',
    ]);
    const sell = emptyDecisions(id);
    sell.stockOrders = [{ targetId: target, side: 'sell', shares: 10 }];
    expect(normalizeDecisions(state, company, sell).decisions.stockOrders).toEqual([]);
    company.books.current.balance.cash = 1000;
    const poor = normalizeDecisions(state, company, d).decisions.stockOrders[0];
    expect(poor?.shares).toBe(Math.floor(1000 / (state.stock.quotes[target]?.price ?? 1)));
  });

  it('skips a buy order whose limit is below the price', () => {
    const { state, id, target } = setup();
    const next = resolveAll(
      state,
      withOrders(state, id, [{ targetId: target, side: 'buy', shares: 10_000, limitPrice: 0.01 }]),
    ).state;
    expect(held(next, target, id)).toBe(0);
  });

  it('chains a capitalization-weighted index and delists bankrupt companies', () => {
    const { state, target } = setup();
    const next = resolveAll(state, steadyAll(state)).state;
    const listed = Object.keys(state.companies).filter((c) => state.companies[c]?.listed);
    const cap = (s: GameState) =>
      sum(
        listed.map(
          (c) => (s.stock.quotes[c]?.price ?? 0) * (s.companies[c]?.sharesOutstanding ?? 0),
        ),
      );
    expect(next.stock.index.value).toBeCloseTo(
      (state.stock.index.value * cap(next)) / cap(state),
      6,
    );
    expect(next.stock.index.history.at(-1)).toBe(next.stock.index.value);

    const broke = structuredClone(state);
    const c = broke.companies[target] as Company;
    c.status = 'bankrupt';
    const after = resolveAll(broke, steadyAll(broke)).state;
    expect(after.companies[target]?.listed).toBe(false);
    expect(after.stock.quotes[target]?.price).toBe(state.config.stockMarket.minPrice);
  });

  it('publishes results with the lag and moves the consensus', () => {
    const { state, target } = setup();
    const next = resolveAll(state, steadyAll(state)).state;
    const quote = next.stock.quotes[target];
    expect(quote?.publishedQuarter).toBe(
      state.meta.turn - state.config.stockMarket.publicationLagQuarters,
    );
    expect(quote?.consensus).not.toBe(state.stock.quotes[target]?.consensus);
  });
});
