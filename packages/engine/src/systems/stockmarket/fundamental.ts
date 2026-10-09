import { sum } from '../../core/math';
import { multiplesValue } from '../../core/valuation';
import type { Company } from '../../model/company';
import type { Statements } from '../../model/finance';
import type { Quarter } from '../../model/ids';
import type { GameState } from '../../model/state';
import { assetResaleDiscountOf } from '../../sectors/config';

/**
 * Statements the market knows: the closed quarters up to `lastClosed − lag`
 * (listed companies publish with stockMarket.publicationLagQuarters of delay).
 */
export function publishedStatements(
  state: GameState,
  company: Company,
  lastClosed: Quarter,
): Statements[] {
  const through = lastClosed - state.config.stockMarket.publicationLagQuarters;
  return company.books.history.filter((s) => s.quarter <= through);
}

/**
 * Fundamental value per share from published accounts:
 * VE = multiples value of the last 12 months (core/valuation.ts);
 * F = max(VE − net debt + financial assets, liquidation value) / shares at
 * the close of the latest published quarter (equity transactions since then
 * show in the price, not yet in the accounts). Undefined until a first
 * quarter is published.
 */
export function fundamentalValue(
  state: GameState,
  company: Company,
  published: readonly Statements[],
): number | undefined {
  const { config, macro } = state;
  const SM = config.stockMarket;
  const f = SM.fundamental;
  const last = published.slice(-4);
  const latest = published.at(-1);
  if (last.length === 0 || !latest) return undefined;
  const scale = 4 / last.length;
  const ebitda = sum(last.map((s) => s.pnl.ebitda)) * scale;
  const revenue = sum(last.map((s) => s.pnl.revenue)) * scale;
  const previous = published.slice(-8, -4);
  const previousRevenue = sum(previous.map((s) => s.pnl.revenue));
  const growth = previous.length === 4 && previousRevenue > 0 ? revenue / previousRevenue - 1 : 0;
  const ev = multiplesValue(config, macro.policyRate, company.sector, { revenue, ebitda }, growth);

  const b = latest.balance;
  const equity = ev - (b.debt - b.cash) + b.financialAssets;
  const liquidation =
    b.cash +
    b.inventory * f.inventoryLiquidationShare +
    b.fixedAssets * (1 - assetResaleDiscountOf(config, company.sector)) +
    b.financialAssets -
    b.debt;
  const shares = latest.shares > 0 ? latest.shares : company.sharesOutstanding;
  return Math.max(SM.minPrice, Math.max(equity, liquidation) / shares);
}
